import { composeLocalCs, gAtLocalC } from './maps';
const CSS_SIZE = 600;
const PADDING = 48;
const GRID_COLOR = '#e5e7eb';
const AXIS_COLOR = '#94a3b8';
const IDENTITY_COLOR = '#cbd5e1';
const SINGLE_GRAPH_COLOR = '#2563eb';
const COMPOSITION_COLOR = '#b45309';
const POINT_COLOR = '#dc2626';
const TEXT_COLOR = '#334155';
const GRAPH_FLATNESS_PX = 0.75;
const MAX_GRAPH_DEPTH = 14;
const MIN_GRAPH_SPAN = 1 / 4096;
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
export function createRegionRenderer(canvas) {
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('2D canvas not supported');
    }
    const ctx = context;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CSS_SIZE * dpr;
    canvas.height = CSS_SIZE * dpr;
    canvas.style.width = CSS_SIZE + 'px';
    canvas.style.height = CSS_SIZE + 'px';
    ctx.scale(dpr, dpr);
    const plotSize = CSS_SIZE - 2 * PADDING;
    let mode = 'single';
    let singleParameter = 0.5;
    let localCs = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let startValue = 0.25;
    function toCanvas(x, y) {
        return {
            x: PADDING + clamp01(x) * plotSize,
            y: CSS_SIZE - PADDING - clamp01(y) * plotSize,
        };
    }
    function distanceToSegment(point, start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) {
            return Math.hypot(point.x - start.x, point.y - start.y);
        }
        const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / len2));
        const projX = start.x + t * dx;
        const projY = start.y + t * dy;
        return Math.hypot(point.x - projX, point.y - projY);
    }
    function drawFrame() {
        ctx.clearRect(0, 0, CSS_SIZE, CSS_SIZE);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, CSS_SIZE, CSS_SIZE);
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = '13px monospace';
        ctx.fillText('0', PADDING - 10, CSS_SIZE - PADDING + 18);
        ctx.fillText('1', CSS_SIZE - PADDING - 4, CSS_SIZE - PADDING + 18);
        ctx.fillText('1', PADDING - 18, PADDING + 4);
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        for (const tick of [0.25, 0.5, 0.75]) {
            const vertical = toCanvas(tick, 0);
            ctx.beginPath();
            ctx.moveTo(vertical.x, PADDING);
            ctx.lineTo(vertical.x, CSS_SIZE - PADDING);
            ctx.stroke();
            const horizontal = toCanvas(0, tick);
            ctx.beginPath();
            ctx.moveTo(PADDING, horizontal.y);
            ctx.lineTo(CSS_SIZE - PADDING, horizontal.y);
            ctx.stroke();
        }
        ctx.strokeStyle = AXIS_COLOR;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(PADDING, PADDING, plotSize, plotSize);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = IDENTITY_COLOR;
        ctx.beginPath();
        const p0 = toCanvas(0, 0);
        const p1 = toCanvas(1, 1);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    function evaluate(x) {
        if (mode === 'single') {
            return gAtLocalC(singleParameter, x);
        }
        return composeLocalCs(localCs, x);
    }
    function sampleGraphPoints() {
        const start = { x: 0, y: evaluate(0) };
        const end = { x: 1, y: evaluate(1) };
        const output = [start];
        function subdivide(left, right, depth) {
            const span = right.x - left.x;
            if (depth >= MAX_GRAPH_DEPTH || span <= MIN_GRAPH_SPAN) {
                output.push(right);
                return;
            }
            const leftCanvas = toCanvas(left.x, left.y);
            const rightCanvas = toCanvas(right.x, right.y);
            const testFractions = [0.25, 0.5, 0.75];
            let worstDeviation = 0;
            let splitPoint = null;
            for (const fraction of testFractions) {
                const x = left.x + span * fraction;
                const point = { x, y: evaluate(x) };
                const canvasPoint = toCanvas(point.x, point.y);
                const deviation = distanceToSegment(canvasPoint, leftCanvas, rightCanvas);
                if (deviation > worstDeviation) {
                    worstDeviation = deviation;
                    splitPoint = point;
                }
            }
            if (worstDeviation <= GRAPH_FLATNESS_PX || splitPoint === null) {
                output.push(right);
                return;
            }
            subdivide(left, splitPoint, depth + 1);
            subdivide(splitPoint, right, depth + 1);
        }
        subdivide(start, end, 0);
        return output;
    }
    function drawGraph() {
        const points = sampleGraphPoints();
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const point = toCanvas(points[i].x, points[i].y);
            if (i === 0) {
                ctx.moveTo(point.x, point.y);
            }
            else {
                ctx.lineTo(point.x, point.y);
            }
        }
        ctx.strokeStyle = mode === 'single' ? SINGLE_GRAPH_COLOR : COMPOSITION_COLOR;
        ctx.lineWidth = 2.5;
        ctx.stroke();
    }
    function drawMarker() {
        const x = clamp01(startValue);
        const y = evaluate(x);
        const point = toCanvas(x, y);
        const axisPoint = toCanvas(x, 0);
        ctx.strokeStyle = POINT_COLOR;
        ctx.fillStyle = POINT_COLOR;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(axisPoint.x, axisPoint.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = '13px monospace';
        const label = mode === 'single'
            ? `(${x.toFixed(3)}, g_c(x) = ${y.toFixed(3)})`
            : `(${x.toFixed(3)}, G(x) = ${y.toFixed(3)})`;
        ctx.fillText(label, PADDING, 24);
    }
    function drawLabels() {
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = '13px monospace';
        ctx.fillText('x', CSS_SIZE - PADDING + 10, CSS_SIZE - PADDING + 4);
        ctx.fillText('y', PADDING - 4, PADDING - 12);
        const title = mode === 'single'
            ? 'g_c'
            : 'G = g_c5 o ... o g_c0';
        ctx.fillText(title, PADDING, CSS_SIZE - 16);
    }
    return {
        render() {
            drawFrame();
            drawGraph();
            drawMarker();
            drawLabels();
        },
        setMode(nextMode) {
            mode = nextMode;
        },
        setSingleParameter(value) {
            singleParameter = clamp01(value);
        },
        setLocalCs(nextLocalCs) {
            localCs = nextLocalCs.map(clamp01);
        },
        setStartValue(value) {
            startValue = clamp01(value);
        },
    };
}
