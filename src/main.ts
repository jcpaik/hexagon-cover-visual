import './style.css';
import type { ShapeMode, TriangleState } from './types';
import { config, mathToCanvas } from './coords';
import { drawHexagon, HEXAGON_VERTICES } from './hexagon';
import {
  computeChainValuesForLocalCs,
  getAdmissibleOrderedSource,
  isCustomAdmissibleOrderedSourceActive,
  resetAdmissibleOrderedSource,
  setAdmissibleOrderedSource,
} from './maps';
import { drawControlPoint, drawShape, getInnerGammas } from './triangle';
import { setupInteraction } from './interaction';
import { createRegionRenderer, type GraphMode } from './region';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// HiDPI support for 2D canvas
const dpr = window.devicePixelRatio || 1;
canvas.width = config.canvasSize * dpr;
canvas.height = config.canvasSize * dpr;
canvas.style.width = config.canvasSize + 'px';
canvas.style.height = config.canvasSize + 'px';
ctx.scale(dpr, dpr);

// Graph canvas (right side)
const regionCanvas = document.getElementById('region-canvas') as HTMLCanvasElement;
const regionRenderer = createRegionRenderer(regionCanvas);
const shapeTitle = document.getElementById('shape-title') as HTMLDivElement;
const gammaValues = document.getElementById('gamma-values') as HTMLDivElement;
const localCBounds = document.getElementById('local-c-bounds') as HTMLDivElement;
const localCValues = document.getElementById('local-c-values') as HTMLDivElement;
const localCSliderContainer = document.getElementById('ci-sliders') as HTMLDivElement;
const cSlider = document.getElementById('c-slider') as HTMLInputElement;
const cValueLabel = document.getElementById('c-value') as HTMLSpanElement;
const sliderRow = document.getElementById('slider-row') as HTMLDivElement;
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-button'));
const shapeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.shape-button'));
const admissibleEditor = document.getElementById('admissible-editor') as HTMLTextAreaElement;
const admissibleStatus = document.getElementById('admissible-status') as HTMLDivElement;
const admissibleResetButton = document.getElementById('admissible-reset') as HTMLButtonElement;

const triangleState: TriangleState = {
  position: { x: 0, y: 0 },
  angle: 0,
  controlPoint: { x: 0, y: 0 },
};
let startValue = 0.25;
let graphMode: GraphMode = 'single';
let shapeMode: ShapeMode = 'triangle';
let currentGammas = Array(6).fill(0);
let manualLocalCs = Array(6).fill(1);

const localCSliderInputs: HTMLInputElement[] = [];
const localCSliderValueLabels: HTMLSpanElement[] = [];
const localCSliderMaxLabels: HTMLSpanElement[] = [];
let admissibleEditorTimer: number | null = null;

function formatTuple(values: number[]): string {
  return `(${values.map((value) => value.toFixed(3)).join(', ')})`;
}

function drawMarker(ctx2d: CanvasRenderingContext2D, x: number, y: number, fill: string, stroke?: string): void {
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

function radialPoint(index: number, radius: number): { x: number; y: number } {
  const vertex = HEXAGON_VERTICES[index];
  return {
    x: vertex.x * radius,
    y: vertex.y * radius,
  };
}

function localCPoint(index: number, localC: number): { x: number; y: number } {
  return radialPoint(index, 1 - localC);
}

function edgePoint(index: number, value: number): { x: number; y: number } {
  const current = HEXAGON_VERTICES[index];
  const previous = HEXAGON_VERTICES[(index + 5) % 6];
  return {
    x: current.x + value * (previous.x - current.x),
    y: current.y + value * (previous.y - current.y),
  };
}

function drawPropagationMarkers(ctx2d: CanvasRenderingContext2D, chain: number[]): void {
  for (let i = 0; i < 6; i++) {
    const point = edgePoint(i, chain[i]);
    drawMarker(ctx2d, point.x, point.y, i === 0 ? '#ea580c' : '#0f172a');
  }

  const finalPoint = edgePoint(0, chain[6]);
  drawMarker(ctx2d, finalPoint.x, finalPoint.y, '#fff', '#dc2626');
}

function getLocalCMaxima(gammas: number[]): number[] {
  return gammas.map((gamma) => Math.max(0, 1 - gamma));
}

function clampToLocalCMax(value: number, maxValue: number): number {
  return Math.max(0, Math.min(maxValue, value));
}

function updateLocalCSliders(maxima: number[]): void {
  for (let i = 0; i < 6; i++) {
    const slider = localCSliderInputs[i];
    slider.max = maxima[i].toFixed(6);
    slider.value = clampToLocalCMax(manualLocalCs[i], maxima[i]).toFixed(6);
    localCSliderValueLabels[i].textContent = `value ${manualLocalCs[i].toFixed(3)}`;
    localCSliderMaxLabels[i].textContent = `max ${maxima[i].toFixed(3)}`;
  }
}

function drawLocalCControls(
  ctx2d: CanvasRenderingContext2D,
  gammas: number[],
  currentLocalCs: number[],
): void {
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
    } else {
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

function syncModeButtons(): void {
  if (shapeMode === 'triangle') {
    shapeTitle.textContent = 'C-triangle';
  } else if (shapeMode === 'circle') {
    shapeTitle.textContent = 'C-circle';
  } else {
    shapeTitle.textContent = 'c_i controls';
  }
  for (const button of shapeButtons) {
    button.classList.toggle('is-active', button.dataset.shapeMode === shapeMode);
  }
  for (const button of modeButtons) {
    button.classList.toggle('is-active', button.dataset.mode === graphMode);
  }
  localCSliderContainer.hidden = shapeMode !== 'local-c';
  sliderRow.classList.toggle('is-disabled', graphMode !== 'single');
  cSlider.disabled = graphMode !== 'single';
}

function setAdmissibleStatus(text: string, isError = false): void {
  admissibleStatus.textContent = text;
  admissibleStatus.style.color = isError ? '#b91c1c' : '#475569';
}

function syncAdmissibleEditorStatus(): void {
  setAdmissibleStatus(
    isCustomAdmissibleOrderedSourceActive()
      ? 'Custom ordered predicate active.'
      : 'Default ordered predicate active.',
  );
}

function applyAdmissibleEditorSource(): void {
  const result = setAdmissibleOrderedSource(admissibleEditor.value);
  if (!result.ok) {
    setAdmissibleStatus(`Compile error: ${result.error}`, true);
    return;
  }

  syncAdmissibleEditorStatus();
  render();
}

function initializeLocalCSliders(): void {
  for (let i = 0; i < 6; i++) {
    const row = document.createElement('div');
    row.className = 'ci-slider-row';

    const head = document.createElement('div');
    head.className = 'ci-slider-head';

    const name = document.createElement('span');
    name.textContent = `c${i}`;

    const value = document.createElement('span');
    const max = document.createElement('span');
    value.textContent = 'value 0.000';
    max.textContent = 'max 0.000';
    head.append(name, value, max);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `ci-slider-${i}`;
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.001';
    slider.value = '0';
    slider.addEventListener('input', () => {
      const maxValue = getLocalCMaxima(currentGammas)[i];
      const next = clampToLocalCMax(parseFloat(slider.value), maxValue);
      manualLocalCs[i] = next;
      render();
    });

    localCSliderInputs.push(slider);
    localCSliderValueLabels.push(value);
    localCSliderMaxLabels.push(max);

    row.append(head, slider);
    localCSliderContainer.append(row);
  }
}

function render(): void {
  let gammas: number[];
  let maxima: number[];
  let localCs: number[];

  if (shapeMode === 'local-c') {
    gammas = Array(6).fill(0);
    maxima = Array(6).fill(1);
    manualLocalCs = manualLocalCs.map((value) => clampToLocalCMax(value, 1));
    localCs = manualLocalCs.slice();
  } else {
    gammas = getInnerGammas(triangleState, shapeMode);
    maxima = getLocalCMaxima(gammas);
    localCs = maxima;
  }
  currentGammas = gammas.slice();

  ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
  drawHexagon(ctx);
  drawShape(ctx, triangleState, shapeMode);
  if (shapeMode === 'triangle') {
    drawControlPoint(ctx, triangleState);
  }

  const chain = computeChainValuesForLocalCs(localCs, startValue);
  if (shapeMode === 'local-c') {
    gammaValues.textContent = 'manual c_i mode';
    localCBounds.textContent = `max c = ${formatTuple(maxima)}`;
    localCValues.textContent = `c = ${formatTuple(localCs)}`;
    updateLocalCSliders(maxima);
    drawLocalCControls(ctx, gammas, localCs);
  } else {
    gammaValues.textContent = `γ = ${formatTuple(gammas)}`;
    localCBounds.textContent = `1 - γ = ${formatTuple(maxima)}`;
    localCValues.textContent = `c = ${formatTuple(localCs)}`;
  }
  drawPropagationMarkers(ctx, chain);

  regionRenderer.setMode(graphMode);
  regionRenderer.setSingleParameter(parseFloat(cSlider.value));
  regionRenderer.setLocalCs(localCs);
  regionRenderer.setStartValue(startValue);
  regionRenderer.render();
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

initializeLocalCSliders();

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

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode as GraphMode | undefined;
    if (!mode) return;
    graphMode = mode;
    syncModeButtons();
    render();
  });
}

for (const button of shapeButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.shapeMode as ShapeMode | undefined;
    if (!mode) return;
    shapeMode = mode;
    syncModeButtons();
    render();
  });
}

setupInteraction(
  canvas,
  triangleState,
  () => shapeMode,
  () => currentGammas,
  () => manualLocalCs,
  (index, value) => {
    const maxima = getLocalCMaxima(currentGammas);
    manualLocalCs[index] = clampToLocalCMax(value, maxima[index]);
  },
  render,
  (value) => {
    startValue = value;
  },
);
syncModeButtons();
render();
