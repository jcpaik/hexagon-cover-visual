import { composeGammas, gAtLocalC } from './maps';

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

export type GraphMode = 'single' | 'composition';

export interface RegionRenderer {
  render(): void;
  setMode(mode: GraphMode): void;
  setSingleParameter(value: number): void;
  setGammas(gammas: number[]): void;
  setStartValue(value: number): void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface GraphPoint {
  x: number;
  y: number;
}

export function createRegionRenderer(canvas: HTMLCanvasElement): RegionRenderer {
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
  let mode: GraphMode = 'single';
  let singleParameter = 0.5;
  let gammas = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  let startValue = 0.25;

  function toCanvas(x: number, y: number): { x: number; y: number } {
    return {
      x: PADDING + clamp01(x) * plotSize,
      y: CSS_SIZE - PADDING - clamp01(y) * plotSize,
    };
  }

  function distanceToSegment(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): number {
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

  function drawFrame(): void {
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

  function evaluate(x: number): number {
    if (mode === 'single') {
      return gAtLocalC(singleParameter, x);
    }
    return composeGammas(gammas, x);
  }

  function sampleGraphPoints(): GraphPoint[] {
    const start: GraphPoint = { x: 0, y: evaluate(0) };
    const end: GraphPoint = { x: 1, y: evaluate(1) };
    const output: GraphPoint[] = [start];

    function subdivide(left: GraphPoint, right: GraphPoint, depth: number): void {
      const span = right.x - left.x;
      if (depth >= MAX_GRAPH_DEPTH || span <= MIN_GRAPH_SPAN) {
        output.push(right);
        return;
      }

      const leftCanvas = toCanvas(left.x, left.y);
      const rightCanvas = toCanvas(right.x, right.y);
      const testFractions = [0.25, 0.5, 0.75];
      let worstDeviation = 0;
      let splitPoint: GraphPoint | null = null;

      for (const fraction of testFractions) {
        const x = left.x + span * fraction;
        const point: GraphPoint = { x, y: evaluate(x) };
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

  function drawGraph(): void {
    const points = sampleGraphPoints();
    ctx.beginPath();

    for (let i = 0; i < points.length; i++) {
      const point = toCanvas(points[i].x, points[i].y);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }

    ctx.strokeStyle = mode === 'single' ? SINGLE_GRAPH_COLOR : COMPOSITION_COLOR;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function drawMarker(): void {
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

  function drawLabels(): void {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '13px monospace';
    ctx.fillText('x', CSS_SIZE - PADDING + 10, CSS_SIZE - PADDING + 4);
    ctx.fillText('y', PADDING - 4, PADDING - 12);

    const title = mode === 'single'
      ? 'g_c'
      : 'G = g_(1-gamma5) o ... o g_(1-gamma0)';
    ctx.fillText(title, PADDING, CSS_SIZE - 16);
  }

  return {
    render(): void {
      drawFrame();
      drawGraph();
      drawMarker();
      drawLabels();
    },
    setMode(nextMode: GraphMode): void {
      mode = nextMode;
    },
    setSingleParameter(value: number): void {
      singleParameter = clamp01(value);
    },
    setGammas(nextGammas: number[]): void {
      gammas = nextGammas.map(clamp01);
    },
    setStartValue(value: number): void {
      startValue = clamp01(value);
    },
  };
}
