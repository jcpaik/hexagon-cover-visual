import type { Point, TriangleState } from './types';
import { mathToCanvas } from './coords';

const CIRCUMRADIUS = 1 / Math.sqrt(3);
const LIGHT_BLUE = '#89CFF0';

export function getVertices(state: TriangleState): [Point, Point, Point] {
  const { position, angle } = state;
  const verts: Point[] = [];
  for (let k = 0; k < 3; k++) {
    const a = angle + Math.PI / 2 + k * (2 * Math.PI / 3);
    verts.push({
      x: position.x + CIRCUMRADIUS * Math.cos(a),
      y: position.y + CIRCUMRADIUS * Math.sin(a),
    });
  }
  return verts as [Point, Point, Point];
}

/** Valid centroid positions such that the origin stays inside the triangle. */
export function getValidRegion(angle: number): [Point, Point, Point] {
  const verts: Point[] = [];
  for (let k = 0; k < 3; k++) {
    const a = angle + Math.PI / 2 + k * (2 * Math.PI / 3);
    verts.push({
      x: -CIRCUMRADIUS * Math.cos(a),
      y: -CIRCUMRADIUS * Math.sin(a),
    });
  }
  return verts as [Point, Point, Point];
}

export function drawTriangle(ctx: CanvasRenderingContext2D, state: TriangleState): void {
  const verts = getVertices(state).map(mathToCanvas);

  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  ctx.lineTo(verts[1].x, verts[1].y);
  ctx.lineTo(verts[2].x, verts[2].y);
  ctx.closePath();
  ctx.strokeStyle = LIGHT_BLUE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawControlPoint(ctx: CanvasRenderingContext2D, state: TriangleState): void {
  const cp = mathToCanvas(state.controlPoint);
  const radius = 4;

  ctx.beginPath();
  ctx.arc(cp.x, cp.y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = LIGHT_BLUE;
  ctx.fill();
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  ctx.stroke();
}
