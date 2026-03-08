import './style.css';
import { config, mathToCanvas, setCanvasSize } from './coords';
import { drawHexagon, HEXAGON_VERTICES } from './hexagon';
import { computeChainValuesForLocalCs, getAdmissibleOrderedSource, isCustomAdmissibleOrderedSourceActive, resetAdmissibleOrderedSource, setAdmissibleOrderedSource, } from './maps';
import { drawControlPoint, drawShape, getInnerGammas } from './triangle';
import { setupInteraction } from './interaction';
import { createRegionRenderer } from './region';
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const MAX_CANVAS_SIZE = 600;
// Graph canvas (right side)
const regionCanvas = document.getElementById('region-canvas');
const regionRenderer = createRegionRenderer(regionCanvas);
const shapeTitle = document.getElementById('shape-title');
const gammaValues = document.getElementById('gamma-values');
const localCBounds = document.getElementById('local-c-bounds');
const localCValues = document.getElementById('local-c-values');
const cSlider = document.getElementById('c-slider');
const cValueLabel = document.getElementById('c-value');
const sliderRow = document.getElementById('slider-row');
const modeButtons = Array.from(document.querySelectorAll('.mode-button'));
const shapeButtons = Array.from(document.querySelectorAll('.shape-button'));
const admissibleEditor = document.getElementById('admissible-editor');
const admissibleStatus = document.getElementById('admissible-status');
const admissibleResetButton = document.getElementById('admissible-reset');
const controllerState = document.getElementById('controller-state');
const controllerStateStatus = document.getElementById('controller-state-status');
const controllerStateCopyButton = document.getElementById('controller-state-copy');
const controllerStateLoadButton = document.getElementById('controller-state-load');
const triangleState = {
    position: { x: 0, y: 0 },
    angle: 0,
    controlPoint: { x: 0, y: 0 },
};
let startValue = 0.25;
let graphMode = 'composition';
let shapeMode = 'triangle';
let currentGammas = Array(6).fill(0);
let manualLocalCs = Array(6).fill(0.5);
let admissibleEditorTimer = null;
let hoveredHalfDiagonalIndex = null;
let selectedHalfDiagonalIndices = [];
function getResponsiveCanvasSize(target) {
    const rect = target.getBoundingClientRect();
    return Math.max(1, Math.min(MAX_CANVAS_SIZE, Math.round(rect.width)));
}
function resizeHiDPICanvas(target, context, cssSize) {
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.round(cssSize * dpr);
    target.height = Math.round(cssSize * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function syncCanvasSizes() {
    const mainCanvasSize = getResponsiveCanvasSize(canvas);
    setCanvasSize(mainCanvasSize);
    resizeHiDPICanvas(canvas, ctx, mainCanvasSize);
    regionRenderer.resize(getResponsiveCanvasSize(regionCanvas));
}
function formatTuple(values) {
    return `(${values.map((value) => value.toFixed(3)).join(', ')})`;
}
function drawMarker(ctx2d, x, y, fill, stroke) {
    const point = mathToCanvas({ x, y });
    ctx2d.beginPath();
    ctx2d.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx2d.fillStyle = fill;
    ctx2d.fill();
    if (stroke) {
        ctx2d.strokeStyle = stroke;
        ctx2d.lineWidth = 2;
        ctx2d.stroke();
    }
}
function radialPoint(index, radius) {
    const vertex = HEXAGON_VERTICES[index];
    return {
        x: vertex.x * radius,
        y: vertex.y * radius,
    };
}
function localCPoint(index, localC) {
    return radialPoint(index, 1 - localC);
}
function edgePoint(index, value) {
    const current = HEXAGON_VERTICES[index];
    const previous = HEXAGON_VERTICES[(index + 5) % 6];
    return {
        x: current.x + value * (previous.x - current.x),
        y: current.y + value * (previous.y - current.y),
    };
}
function drawPropagationMarkers(ctx2d, chain) {
    for (let i = 0; i < 6; i++) {
        const point = edgePoint(i, chain[i]);
        drawMarker(ctx2d, point.x, point.y, i === 0 ? '#ea580c' : '#0f172a');
    }
    const finalPoint = edgePoint(0, chain[6]);
    drawMarker(ctx2d, finalPoint.x, finalPoint.y, '#fff', '#dc2626');
}
function getLocalCMaxima(gammas) {
    return gammas.map((gamma) => Math.max(0, 1 - gamma));
}
function clampToLocalCMax(value, maxValue) {
    return Math.max(0, Math.min(maxValue, value));
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function isPoint(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value;
    return typeof candidate.x === 'number' && Number.isFinite(candidate.x)
        && typeof candidate.y === 'number' && Number.isFinite(candidate.y);
}
function isShapeMode(value) {
    return value === 'triangle' || value === 'local-c' || value === 'circle';
}
function isGraphMode(value) {
    return value === 'composition' || value === 'single' || value === 'pair';
}
function formatControllerSnapshot(snapshot) {
    return JSON.stringify(snapshot, null, 2);
}
function setControllerStateStatus(text, isError = false) {
    controllerStateStatus.textContent = text;
    controllerStateStatus.style.color = isError ? '#b91c1c' : '#475569';
}
function getControllerSnapshot() {
    return {
        version: 1,
        shapeMode,
        graphMode,
        startValue: clamp01(startValue),
        singleParameter: clamp01(parseFloat(cSlider.value)),
        triangleState: {
            position: { ...triangleState.position },
            angle: triangleState.angle,
            controlPoint: { ...triangleState.controlPoint },
        },
        manualLocalCs: manualLocalCs.map(clamp01),
        selectedHalfDiagonalIndices: selectedHalfDiagonalIndices.slice(),
        admissibleSource: admissibleEditor.value,
    };
}
function syncControllerSnapshot() {
    controllerState.value = formatControllerSnapshot(getControllerSnapshot());
    setControllerStateStatus('Snapshot updates automatically.');
}
function parseControllerSnapshot(raw) {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) {
        throw new Error('Unsupported snapshot version.');
    }
    if (!isShapeMode(parsed.shapeMode)) {
        throw new Error('Invalid shapeMode.');
    }
    if (!isGraphMode(parsed.graphMode)) {
        throw new Error('Invalid graphMode.');
    }
    if (typeof parsed.startValue !== 'number' || !Number.isFinite(parsed.startValue)) {
        throw new Error('Invalid startValue.');
    }
    if (typeof parsed.singleParameter !== 'number' || !Number.isFinite(parsed.singleParameter)) {
        throw new Error('Invalid singleParameter.');
    }
    if (typeof parsed.triangleState !== 'object' || parsed.triangleState === null) {
        throw new Error('Invalid triangleState.');
    }
    if (!isPoint(parsed.triangleState.position) || !isPoint(parsed.triangleState.controlPoint)) {
        throw new Error('Invalid triangleState points.');
    }
    if (typeof parsed.triangleState.angle !== 'number' || !Number.isFinite(parsed.triangleState.angle)) {
        throw new Error('Invalid triangleState angle.');
    }
    if (!Array.isArray(parsed.manualLocalCs) || parsed.manualLocalCs.length !== 6) {
        throw new Error('manualLocalCs must be an array of length 6.');
    }
    if (!parsed.manualLocalCs.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('manualLocalCs must contain only finite numbers.');
    }
    if (!Array.isArray(parsed.selectedHalfDiagonalIndices)) {
        throw new Error('selectedHalfDiagonalIndices must be an array.');
    }
    if (!parsed.selectedHalfDiagonalIndices.every((value) => Number.isInteger(value) && value >= 0 && value < 6)) {
        throw new Error('selectedHalfDiagonalIndices must contain integers from 0 to 5.');
    }
    if (typeof parsed.admissibleSource !== 'string') {
        throw new Error('Invalid admissibleSource.');
    }
    return {
        version: 1,
        shapeMode: parsed.shapeMode,
        graphMode: parsed.graphMode,
        startValue: clamp01(parsed.startValue),
        singleParameter: clamp01(parsed.singleParameter),
        triangleState: {
            position: { ...parsed.triangleState.position },
            angle: parsed.triangleState.angle,
            controlPoint: { ...parsed.triangleState.controlPoint },
        },
        manualLocalCs: parsed.manualLocalCs.map(clamp01),
        selectedHalfDiagonalIndices: Array.from(new Set(parsed.selectedHalfDiagonalIndices)),
        admissibleSource: parsed.admissibleSource,
    };
}
function loadControllerSnapshot(raw) {
    const snapshot = parseControllerSnapshot(raw);
    const admissibleResult = setAdmissibleOrderedSource(snapshot.admissibleSource);
    if (!admissibleResult.ok) {
        throw new Error(`Admissible source compile error: ${admissibleResult.error}`);
    }
    shapeMode = snapshot.shapeMode;
    graphMode = snapshot.graphMode;
    startValue = snapshot.startValue;
    cSlider.value = snapshot.singleParameter.toFixed(2);
    cValueLabel.textContent = snapshot.singleParameter.toFixed(2);
    triangleState.position = { ...snapshot.triangleState.position };
    triangleState.angle = snapshot.triangleState.angle;
    triangleState.controlPoint = { ...snapshot.triangleState.controlPoint };
    manualLocalCs = snapshot.manualLocalCs.slice();
    selectedHalfDiagonalIndices = snapshot.selectedHalfDiagonalIndices.slice();
    hoveredHalfDiagonalIndex = null;
    admissibleEditor.value = snapshot.admissibleSource;
    syncAdmissibleEditorStatus();
    syncModeButtons();
    render();
    syncControllerSnapshot();
    setControllerStateStatus('Snapshot loaded.');
}
function drawLocalCControls(ctx2d, gammas, currentLocalCs) {
    const handles = currentLocalCs.map((value, index) => localCPoint(index, value));
    ctx2d.save();
    ctx2d.strokeStyle = '#fef3c7';
    ctx2d.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        const start = mathToCanvas(radialPoint(i, gammas[i]));
        const end = mathToCanvas(HEXAGON_VERTICES[i]);
        ctx2d.beginPath();
        ctx2d.moveTo(start.x, start.y);
        ctx2d.lineTo(end.x, end.y);
        ctx2d.stroke();
    }
    ctx2d.beginPath();
    handles.forEach((point, index) => {
        const canvasPoint = mathToCanvas(point);
        if (index === 0) {
            ctx2d.moveTo(canvasPoint.x, canvasPoint.y);
        }
        else {
            ctx2d.lineTo(canvasPoint.x, canvasPoint.y);
        }
    });
    ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(254, 240, 138, 0.18)';
    ctx2d.strokeStyle = '#fde68a';
    ctx2d.lineWidth = 1.5;
    ctx2d.fill();
    ctx2d.stroke();
    for (const point of handles) {
        const canvasPoint = mathToCanvas(point);
        ctx2d.beginPath();
        ctx2d.arc(canvasPoint.x, canvasPoint.y, 6, 0, 2 * Math.PI);
        ctx2d.fillStyle = '#facc15';
        ctx2d.fill();
        ctx2d.strokeStyle = '#a16207';
        ctx2d.lineWidth = 1.5;
        ctx2d.stroke();
    }
    ctx2d.restore();
}
function drawHoveredHalfDiagonal(ctx2d, index) {
    if (index === null) {
        return;
    }
    ctx2d.save();
    const start = mathToCanvas({ x: 0, y: 0 });
    const end = mathToCanvas(HEXAGON_VERTICES[index]);
    ctx2d.strokeStyle = '#facc15';
    ctx2d.lineWidth = 4;
    ctx2d.beginPath();
    ctx2d.moveTo(start.x, start.y);
    ctx2d.lineTo(end.x, end.y);
    ctx2d.stroke();
    ctx2d.restore();
}
function drawSelectedHalfDiagonals(ctx2d, indices) {
    if (indices.length === 0) {
        return;
    }
    ctx2d.save();
    ctx2d.strokeStyle = '#f59e0b';
    ctx2d.lineWidth = 3;
    for (const index of indices) {
        const start = mathToCanvas({ x: 0, y: 0 });
        const end = mathToCanvas(HEXAGON_VERTICES[index]);
        ctx2d.beginPath();
        ctx2d.moveTo(start.x, start.y);
        ctx2d.lineTo(end.x, end.y);
        ctx2d.stroke();
    }
    ctx2d.restore();
}
function toggleSelectedHalfDiagonal(index) {
    const existingIndex = selectedHalfDiagonalIndices.indexOf(index);
    if (existingIndex >= 0) {
        selectedHalfDiagonalIndices = selectedHalfDiagonalIndices.filter((value) => value !== index);
        return;
    }
    selectedHalfDiagonalIndices = [...selectedHalfDiagonalIndices, index];
}
function syncModeButtons() {
    if (shapeMode === 'triangle') {
        shapeTitle.textContent = 'C-triangle';
    }
    else if (shapeMode === 'circle') {
        shapeTitle.textContent = 'C-circle';
    }
    else {
        shapeTitle.textContent = 'c_i controls';
    }
    for (const button of shapeButtons) {
        button.classList.toggle('is-active', button.dataset.shapeMode === shapeMode);
    }
    for (const button of modeButtons) {
        button.classList.toggle('is-active', button.dataset.mode === graphMode);
    }
    sliderRow.hidden = graphMode !== 'single';
    cSlider.disabled = graphMode !== 'single';
}
function setAdmissibleStatus(text, isError = false) {
    admissibleStatus.textContent = text;
    admissibleStatus.style.color = isError ? '#b91c1c' : '#475569';
}
function syncAdmissibleEditorStatus() {
    setAdmissibleStatus(isCustomAdmissibleOrderedSourceActive()
        ? 'Custom ordered predicate active.'
        : 'Default ordered predicate active.');
}
function applyAdmissibleEditorSource() {
    const result = setAdmissibleOrderedSource(admissibleEditor.value);
    if (!result.ok) {
        setAdmissibleStatus(`Compile error: ${result.error}`, true);
        return;
    }
    syncAdmissibleEditorStatus();
    render();
}
function render() {
    let gammas;
    let maxima;
    let localCs;
    if (shapeMode === 'local-c') {
        gammas = Array(6).fill(0);
        maxima = Array(6).fill(1);
        manualLocalCs = manualLocalCs.map((value) => clampToLocalCMax(value, 1));
        localCs = manualLocalCs.slice();
    }
    else {
        gammas = getInnerGammas(triangleState, shapeMode);
        maxima = getLocalCMaxima(gammas);
        localCs = maxima;
    }
    currentGammas = gammas.slice();
    ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(ctx);
    drawSelectedHalfDiagonals(ctx, selectedHalfDiagonalIndices);
    drawHoveredHalfDiagonal(ctx, hoveredHalfDiagonalIndex);
    drawShape(ctx, triangleState, shapeMode);
    if (shapeMode === 'triangle') {
        drawControlPoint(ctx, triangleState);
    }
    const chain = computeChainValuesForLocalCs(localCs, startValue);
    if (shapeMode === 'local-c') {
        gammaValues.textContent = 'manual c_i mode';
        localCBounds.textContent = `max c = ${formatTuple(maxima)}`;
        localCValues.textContent = `c = ${formatTuple(localCs)}`;
        drawLocalCControls(ctx, gammas, localCs);
    }
    else {
        gammaValues.textContent = `γ = ${formatTuple(gammas)}`;
        localCBounds.textContent = `1 - γ = ${formatTuple(maxima)}`;
        localCValues.textContent = `c = ${formatTuple(localCs)}`;
    }
    drawPropagationMarkers(ctx, chain);
    regionRenderer.setMode(graphMode);
    regionRenderer.setSingleParameter(parseFloat(cSlider.value));
    regionRenderer.setLocalCs(localCs);
    regionRenderer.setSelectedLocalCs(selectedHalfDiagonalIndices.map((index) => localCs[index] ?? 0));
    regionRenderer.setStartValue(startValue);
    regionRenderer.setHoverLocalC(hoveredHalfDiagonalIndex === null ? null : localCs[hoveredHalfDiagonalIndex] ?? null);
    regionRenderer.render();
    syncControllerSnapshot();
}
// Slider for c parameter
cSlider.addEventListener('input', () => {
    const c = parseFloat(cSlider.value);
    cValueLabel.textContent = c.toFixed(2);
    render();
});
cValueLabel.textContent = parseFloat(cSlider.value).toFixed(2);
admissibleEditor.value = getAdmissibleOrderedSource();
syncAdmissibleEditorStatus();
admissibleEditor.addEventListener('input', () => {
    if (admissibleEditorTimer !== null) {
        window.clearTimeout(admissibleEditorTimer);
    }
    admissibleEditorTimer = window.setTimeout(() => {
        applyAdmissibleEditorSource();
    }, 250);
});
admissibleResetButton.addEventListener('click', () => {
    if (admissibleEditorTimer !== null) {
        window.clearTimeout(admissibleEditorTimer);
        admissibleEditorTimer = null;
    }
    resetAdmissibleOrderedSource();
    admissibleEditor.value = getAdmissibleOrderedSource();
    syncAdmissibleEditorStatus();
    render();
});
controllerStateCopyButton.addEventListener('click', async () => {
    syncControllerSnapshot();
    try {
        await navigator.clipboard.writeText(controllerState.value);
        setControllerStateStatus('Snapshot copied.');
    }
    catch {
        controllerState.select();
        setControllerStateStatus('Clipboard unavailable. JSON selected for manual copy.');
    }
});
controllerStateLoadButton.addEventListener('click', () => {
    try {
        loadControllerSnapshot(controllerState.value);
    }
    catch (error) {
        setControllerStateStatus(error instanceof Error ? error.message : 'Failed to load snapshot.', true);
    }
});
for (const button of modeButtons) {
    button.addEventListener('click', () => {
        const mode = button.dataset.mode;
        if (!mode)
            return;
        graphMode = mode;
        syncModeButtons();
        render();
    });
}
for (const button of shapeButtons) {
    button.addEventListener('click', () => {
        const mode = button.dataset.shapeMode;
        if (!mode)
            return;
        shapeMode = mode;
        syncModeButtons();
        render();
    });
}
setupInteraction(canvas, triangleState, () => shapeMode, () => currentGammas, () => manualLocalCs, (index, value) => {
    const maxima = getLocalCMaxima(currentGammas);
    manualLocalCs[index] = clampToLocalCMax(value, maxima[index]);
}, render, (value) => {
    startValue = value;
}, (index) => {
    if (hoveredHalfDiagonalIndex === index) {
        return;
    }
    hoveredHalfDiagonalIndex = index;
    render();
}, (index) => {
    toggleSelectedHalfDiagonal(index);
    render();
});
window.addEventListener('resize', () => {
    syncCanvasSizes();
    render();
});
syncCanvasSizes();
syncModeButtons();
render();
