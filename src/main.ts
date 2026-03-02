import './style.css';
import type { TriangleState } from './types';
import { config } from './coords';
import { drawHexagon } from './hexagon';
import { drawTriangle, drawControlPoint } from './triangle';
import { setupInteraction } from './interaction';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// HiDPI support
const dpr = window.devicePixelRatio || 1;
canvas.width = config.canvasSize * dpr;
canvas.height = config.canvasSize * dpr;
canvas.style.width = config.canvasSize + 'px';
canvas.style.height = config.canvasSize + 'px';
ctx.scale(dpr, dpr);

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
}

setupInteraction(canvas, triangleState, render);
render();
