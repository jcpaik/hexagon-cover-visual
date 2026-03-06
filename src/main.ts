import './style.css';
import type { TriangleState } from './types';
import { config } from './coords';
import { drawHexagon } from './hexagon';
import { drawTriangle, drawControlPoint } from './triangle';
import { setupInteraction } from './interaction';
import { createRegionRenderer } from './region';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// HiDPI support for 2D canvas
const dpr = window.devicePixelRatio || 1;
canvas.width = config.canvasSize * dpr;
canvas.height = config.canvasSize * dpr;
canvas.style.width = config.canvasSize + 'px';
canvas.style.height = config.canvasSize + 'px';
ctx.scale(dpr, dpr);

// WebGL region canvas (right side)
const regionCanvas = document.getElementById('region-canvas') as HTMLCanvasElement;
const regionRenderer = createRegionRenderer(regionCanvas);

const triangleState: TriangleState = {
  position: { x: 0, y: 0 },
  angle: 0,
  controlPoint: { x: 0, y: 0 },
};

function render(): void {
  ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
  drawHexagon(ctx);
  drawTriangle(ctx, triangleState);
  drawControlPoint(ctx, triangleState);

  regionRenderer.render();
}

// Slider for c parameter
const cSlider = document.getElementById('c-slider') as HTMLInputElement;
const cValueLabel = document.getElementById('c-value') as HTMLSpanElement;
cSlider.addEventListener('input', () => {
  const c = parseFloat(cSlider.value);
  cValueLabel.textContent = c.toFixed(2);
  regionRenderer.setC(c);
  regionRenderer.render();
});

setupInteraction(canvas, triangleState, render);
render();
