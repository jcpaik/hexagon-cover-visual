import { convexHull } from '../convexHull';
import { mathToCanvas, scaleToCanvas } from '../coords';
import type { CoverTriangle } from '../cover';
import type { Point } from '../types';

interface WitnessConstruction {
  points: readonly { id: string; symbol?: string; label: string; point: Point | null; enabled: boolean }[];
  triangle: CoverTriangle | null;
  circles?: readonly { id: string; center: Point }[];
  diskRadius?: number | null;
}

interface WitnessRenderOptions {
  showHull?: boolean;
  showDisk?: boolean;
  showTriangle?: boolean;
  fillTriangle?: boolean;
}

export function drawWitnessConstruction(
  ctx: CanvasRenderingContext2D,
  construction: WitnessConstruction,
  options: WitnessRenderOptions = {},
): void {
  ctx.save();
  if (options.showDisk && construction.diskRadius !== undefined && construction.diskRadius !== null) {
    const origin = mathToCanvas({ x: 0, y: 0 });
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, scaleToCanvas(construction.diskRadius), 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  for (const circle of construction.circles ?? []) {
    const center = mathToCanvas(circle.center);
    ctx.beginPath();
    ctx.arc(center.x, center.y, scaleToCanvas(1), 0, 2 * Math.PI);
    ctx.strokeStyle = circle.id === 'C2' ? '#f59e0b' : '#8b5cf6';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '12px monospace';
    ctx.fillText(circle.id, center.x + 7, center.y - 7);
  }
  const enabled = construction.points.flatMap((item) => item.enabled && item.point ? [item.point] : []);
  const hull = convexHull(enabled).map(mathToCanvas);
  if (options.showHull !== false && hull.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(hull[0].x, hull[0].y);
    for (const point of hull.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  if (construction.triangle && options.showTriangle !== false) {
    const vertices = construction.triangle.vertices.map(mathToCanvas);
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (const point of vertices.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.strokeStyle = construction.triangle.color;
    ctx.lineWidth = 2;
    if (options.fillTriangle) { ctx.fillStyle = `${construction.triangle.color}29`; ctx.fill(); }
    ctx.stroke();
  }
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const item of construction.points) {
    if (!item.point) continue;
    const point = mathToCanvas(item.point);
    const supports = item.enabled && construction.triangle?.normals.some((normal, index) =>
      Math.abs(normal.x * item.point!.x + normal.y * item.point!.y - construction.triangle!.lambdas[index]) < 1e-6,
    );
    ctx.beginPath();
    ctx.arc(point.x, point.y, supports ? 6.4 : 5.2, 0, 2 * Math.PI);
    ctx.fillStyle = !item.enabled ? '#f1f5f9' : supports ? '#dbeafe' : '#fef3c7';
    ctx.strokeStyle = !item.enabled ? '#94a3b8' : supports ? '#2563eb' : '#92400e';
    ctx.lineWidth = supports ? 2.5 : 1.8;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = !item.enabled ? '#94a3b8' : supports ? '#1d4ed8' : '#78350f';
    ctx.fillText(item.symbol ?? item.id, point.x + 7, point.y - 8);
  }
  ctx.restore();
}
