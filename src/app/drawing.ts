import { mathToCanvas, scaleToCanvas } from '../coords';
import { type CoverSegmentReport, type CoverTriangle } from '../cover';
import { lotusComponents } from '../freeGeometry';
import type { FreeSegment, FreeValidationSegment } from '../freeTypes';
import { HEXAGON_VERTICES } from '../hexagon';
import type { Point } from '../types';

export function drawMarker(ctx2d: CanvasRenderingContext2D, x: number, y: number, fill: string, stroke?: string): void {
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

export function segmentPoint(start: Point, end: Point, value: number): Point {
  return {
    x: start.x + value * (end.x - start.x),
    y: start.y + value * (end.y - start.y),
  };
}

export function drawCoverTriangleOverlay(ctx2d: CanvasRenderingContext2D, triangles: CoverTriangle[]): void {
  ctx2d.save();
  for (const triangle of triangles) {
    const vertices = triangle.vertices.map(mathToCanvas);
    ctx2d.beginPath();
    ctx2d.moveTo(vertices[0].x, vertices[0].y);
    ctx2d.lineTo(vertices[1].x, vertices[1].y);
    ctx2d.lineTo(vertices[2].x, vertices[2].y);
    ctx2d.closePath();
    ctx2d.fillStyle = `${triangle.color}29`;
    ctx2d.strokeStyle = triangle.color;
    ctx2d.lineWidth = 2;
    ctx2d.fill();
    ctx2d.stroke();

    const label = mathToCanvas(triangle.center);
    ctx2d.fillStyle = triangle.side >= 1 - 1e-9 ? '#b91c1c' : triangle.color;
    ctx2d.font = '13px monospace';
    ctx2d.fillText(triangle.name, label.x + 6, label.y - 6);
  }
  ctx2d.restore();
}

export function drawCoverageGaps(ctx2d: CanvasRenderingContext2D, segments: Array<CoverSegmentReport | FreeValidationSegment>): void {
  ctx2d.save();
  ctx2d.strokeStyle = '#dc2626';
  ctx2d.lineWidth = 5;
  ctx2d.lineCap = 'round';

  for (const segment of segments) {
    if ('arc' in segment && segment.arc) {
      for (const [gapStart, gapEnd] of segment.gaps) {
        drawArcInterval(ctx2d, segment.arc, gapStart, gapEnd);
      }
      continue;
    }
    const start = segment.kind === 'edge'
      ? HEXAGON_VERTICES[segment.index]
      : segment.kind === 'diag'
        ? { x: 0, y: 0 }
        : lotusComponents().find((component) => component.label === ('label' in segment ? segment.label : undefined))?.start ?? { x: 0, y: 0 };
    const end = segment.kind === 'edge'
      ? HEXAGON_VERTICES[(segment.index + 1) % 6]
      : segment.kind === 'diag'
        ? HEXAGON_VERTICES[segment.index]
        : lotusComponents().find((component) => component.label === ('label' in segment ? segment.label : undefined))?.end ?? { x: 0, y: 0 };

    for (const [gapStart, gapEnd] of segment.gaps) {
      const canvasStart = mathToCanvas(segmentPoint(start, end, gapStart));
      const canvasEnd = mathToCanvas(segmentPoint(start, end, gapEnd));
      ctx2d.beginPath();
      ctx2d.moveTo(canvasStart.x, canvasStart.y);
      ctx2d.lineTo(canvasEnd.x, canvasEnd.y);
      ctx2d.stroke();
    }
  }

  ctx2d.restore();
}

export function drawArcInterval(
  ctx2d: CanvasRenderingContext2D,
  arc: NonNullable<FreeSegment['arc']>,
  startT: number,
  endT: number,
): void {
  const center = mathToCanvas(arc.center);
  const startAngle = -(arc.startAngle + arc.sweep * startT);
  const endAngle = -(arc.startAngle + arc.sweep * endT);
  ctx2d.beginPath();
  ctx2d.arc(center.x, center.y, scaleToCanvas(arc.radius), startAngle, endAngle, arc.sweep > 0);
  ctx2d.stroke();
}
