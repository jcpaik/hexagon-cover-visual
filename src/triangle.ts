import type { Point, ShapeMode, TriangleState } from './types';
import { mathToCanvas, scaleToCanvas } from './coords';
import { rayCircleExitDistance, rayPolygonExitDistance } from './geometry';
import { HEXAGON_VERTICES } from './hexagon';

export const CIRCUMRADIUS = 1 / Math.sqrt(3);
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

export function drawCircle(ctx: CanvasRenderingContext2D, state: TriangleState): void {
  const center = mathToCanvas(state.position);

  ctx.beginPath();
  ctx.arc(center.x, center.y, scaleToCanvas(CIRCUMRADIUS), 0, 2 * Math.PI);
  ctx.strokeStyle = LIGHT_BLUE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  state: TriangleState,
  shapeMode: ShapeMode,
): void {
  if (shapeMode === 'local-c') {
    return;
  }

  if (shapeMode === 'circle') {
    drawCircle(ctx, state);
    return;
  }

  drawTriangle(ctx, state);
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

export function getInnerGammas(state: TriangleState, shapeMode: ShapeMode): number[] {
  if (shapeMode === 'local-c') {
    return HEXAGON_VERTICES.map(() => 0);
  }

  const verts = shapeMode === 'triangle' ? getVertices(state) : null;
  const origin = { x: 0, y: 0 };

  return HEXAGON_VERTICES.map((vertex) => {
    const distance = shapeMode === 'circle'
      ? rayCircleExitDistance(origin, vertex, state.position, CIRCUMRADIUS)
      : rayPolygonExitDistance(origin, vertex, verts!);
    return distance ?? 0;
  });
}
