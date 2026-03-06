import './style.css';
import type { TriangleState } from './types';
import { config, mathToCanvas } from './coords';
import { drawHexagon, HEXAGON_VERTICES } from './hexagon';
import { computeChainValuesForLocalCs } from './maps';
import { drawTriangle, drawControlPoint, getInnerGammas } from './triangle';
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
const gammaValues = document.getElementById('gamma-values') as HTMLDivElement;
const localCValues = document.getElementById('local-c-values') as HTMLDivElement;
const cSlider = document.getElementById('c-slider') as HTMLInputElement;
const cValueLabel = document.getElementById('c-value') as HTMLSpanElement;
const sliderRow = document.getElementById('slider-row') as HTMLDivElement;
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-button'));
const localCButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.local-c-button'));

const triangleState: TriangleState = {
  position: { x: 0, y: 0 },
  angle: 0,
  controlPoint: { x: 0, y: 0 },
};
let startValue = 0.25;
let graphMode: GraphMode = 'single';
type LocalCMode = 'complement' | 'capped';
let localCMode: LocalCMode = 'complement';

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

function syncModeButtons(): void {
  for (const button of modeButtons) {
    button.classList.toggle('is-active', button.dataset.mode === graphMode);
  }
  for (const button of localCButtons) {
    button.classList.toggle('is-active', button.dataset.localCMode === localCMode);
  }
  sliderRow.classList.toggle('is-disabled', graphMode !== 'single');
  cSlider.disabled = graphMode !== 'single';
}

function computeLocalCs(gammas: number[]): number[] {
  if (localCMode === 'capped') {
    return gammas.map((gamma) => Math.min(0.5, 1 - gamma));
  }
  return gammas.map((gamma) => 1 - gamma);
}

function localCLabel(): string {
  return localCMode === 'capped'
    ? 'c = min(1/2, 1 - γ)'
    : 'c = 1 - γ';
}

function render(): void {
  ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
  drawHexagon(ctx);
  drawTriangle(ctx, triangleState);
  drawControlPoint(ctx, triangleState);

  const gammas = getInnerGammas(triangleState);
  const localCs = computeLocalCs(gammas);
  const chain = computeChainValuesForLocalCs(localCs, startValue);
  gammaValues.textContent = `γ = ${formatTuple(gammas)}`;
  localCValues.textContent = `${localCLabel()} = ${formatTuple(localCs)}`;
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

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode as GraphMode | undefined;
    if (!mode) return;
    graphMode = mode;
    syncModeButtons();
    render();
  });
}

for (const button of localCButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.localCMode as LocalCMode | undefined;
    if (!mode) return;
    localCMode = mode;
    syncModeButtons();
    render();
  });
}

setupInteraction(canvas, triangleState, render, (value) => {
  startValue = value;
});
syncModeButtons();
render();
