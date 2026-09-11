import { drawArcInterval, drawCoverageGaps } from '../../app/drawing';
import { config, mathToCanvas } from '../../coords';
import { cUnionBoundaryPoints, type CUnionModel } from '../../cUnion';
import {
  benzenePoint,
  colorForTriangle,
  getSegmentByRef,
  isFreeLabelSuspended,
  lotusComponents,
  midpoint,
  sameSegmentRef,
  targetTLabel,
  targetTPoint,
  triangleVertices,
} from '../../freeGeometry';
import type { FreeState, FreeValidationResult } from '../../freeTypes';
import { drawHexagonLines, HEXAGON_VERTICES } from '../../hexagon';
import { buildSymmetricPointTargets } from '../../symmetricPoints';
import type { Point } from '../../types';

interface Dependencies {
  readonly freeState: FreeState;
  readonly cUnionModel: CUnionModel | null;
}

export function createFreeRenderer(deps: Dependencies) {
  function drawSymmetricPoints(ctx2d: CanvasRenderingContext2D, failureLabels: Set<string>): void {
    const targets = buildSymmetricPointTargets(deps.freeState.pointSeeds);
    if (targets.length === 0) {
      return;
    }

    ctx2d.save();
    for (const target of targets) {
      const point = mathToCanvas(target.point);
      ctx2d.beginPath();
      ctx2d.arc(point.x, point.y, 4.5, 0, 2 * Math.PI);
      ctx2d.fillStyle = failureLabels.has(target.label) ? '#dc2626' : '#2563eb';
      ctx2d.fill();
      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    }

    for (const seed of deps.freeState.pointSeeds) {
      const point = mathToCanvas(seed.point);
      ctx2d.beginPath();
      ctx2d.arc(point.x, point.y, 8, 0, 2 * Math.PI);
      ctx2d.strokeStyle = seed.id === deps.freeState.selectedPointSeedId ? '#f59e0b' : '#0f172a';
      ctx2d.lineWidth = seed.id === deps.freeState.selectedPointSeedId ? 2.5 : 1.5;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawLotusTarget(ctx2d: CanvasRenderingContext2D): void {
    ctx2d.save();
    ctx2d.strokeStyle = '#0f766e';
    ctx2d.lineWidth = 3;
    ctx2d.lineCap = 'round';
    for (const component of lotusComponents()) {
      if (component.arc) {
        drawArcInterval(ctx2d, component.arc, 0, 1);
      } else {
        const start = mathToCanvas(component.start);
        const end = mathToCanvas(component.end);
        ctx2d.beginPath();
        ctx2d.moveTo(start.x, start.y);
        ctx2d.lineTo(end.x, end.y);
        ctx2d.stroke();
      }
    }
    ctx2d.restore();
  }

  function traceCanvasPolygon(ctx2d: CanvasRenderingContext2D, points: readonly Point[]): void {
    if (points.length === 0) return;
    const first = mathToCanvas(points[0]);
    ctx2d.moveTo(first.x, first.y);
    for (let i = 1;i < points.length;i++) {
      const point = mathToCanvas(points[i]);
      ctx2d.lineTo(point.x, point.y);
    }
    ctx2d.closePath();
  }

  function drawCUnionMode(ctx2d: CanvasRenderingContext2D, model: CUnionModel): void {
    const boundary = cUnionBoundaryPoints(model, deps.freeState.cUnionCeFilter);
    if (boundary.length < 3) return;

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(0, 0, config.canvasSize, config.canvasSize);
    traceCanvasPolygon(ctx2d, HEXAGON_VERTICES);
    ctx2d.clip('evenodd');
    ctx2d.beginPath();
    traceCanvasPolygon(ctx2d, boundary);
    ctx2d.fillStyle = 'rgba(100, 116, 139, 0.16)';
    ctx2d.fill();
    ctx2d.restore();

    ctx2d.save();
    ctx2d.beginPath();
    traceCanvasPolygon(ctx2d, HEXAGON_VERTICES);
    ctx2d.clip();
    ctx2d.beginPath();
    traceCanvasPolygon(ctx2d, boundary);
    ctx2d.fillStyle = 'rgba(14, 165, 233, 0.24)';
    ctx2d.fill();
    ctx2d.restore();

    drawHexagonLines(ctx2d);
  }

  function drawCUnionBoundary(ctx2d: CanvasRenderingContext2D, model: CUnionModel): void {
    const boundary = cUnionBoundaryPoints(model, deps.freeState.cUnionCeFilter);
    if (boundary.length < 3) return;
    ctx2d.save();
    const boundarySelected = deps.freeState.selectedSegments.some((segment) => segment.kind === 'c-union-boundary');
    ctx2d.beginPath();
    traceCanvasPolygon(ctx2d, boundary);
    ctx2d.strokeStyle = boundarySelected ? '#facc15' : colorForTriangle('C');
    ctx2d.lineWidth = boundarySelected ? 5 : 2;
    ctx2d.stroke();
    ctx2d.restore();
  }

  function drawCUnionReference(ctx2d: CanvasRenderingContext2D): void {
    const origin = mathToCanvas({ x: 0, y: 0 });
    const vertex = mathToCanvas(HEXAGON_VERTICES[4]);
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.moveTo(origin.x, origin.y);
    ctx2d.lineTo(vertex.x, vertex.y);
    ctx2d.strokeStyle = '#d97706';
    ctx2d.lineWidth = 2.5;
    ctx2d.stroke();
    ctx2d.restore();
  }

  function drawFreeMode(
    ctx2d: CanvasRenderingContext2D,
    validation: FreeValidationResult,
    cUnionReady: boolean,
  ): void {
    ctx2d.save();
    const pointFailures = cUnionReady ? validation.pointFailures : [];
    if (deps.freeState.cForm === 'c-union' && deps.cUnionModel) {
      drawCUnionMode(ctx2d, deps.cUnionModel);
    }
    if (deps.freeState.target === 'LOTUS') {
      drawLotusTarget(ctx2d);
    }
    for (const triangle of deps.freeState.triangles) {
      if (triangle.hidden || deps.freeState.cForm === 'c-union' && triangle.id === 'C') {
        continue;
      }
      const vertices = triangleVertices(triangle.center, triangle.angle).map(mathToCanvas);
      const color = colorForTriangle(triangle.id);
      ctx2d.beginPath();
      ctx2d.moveTo(vertices[0].x, vertices[0].y);
      ctx2d.lineTo(vertices[1].x, vertices[1].y);
      ctx2d.lineTo(vertices[2].x, vertices[2].y);
      ctx2d.closePath();
      ctx2d.fillStyle = `${color}22`;
      ctx2d.strokeStyle = triangle.id === deps.freeState.selectedTriangleId ? '#111827' : color;
      ctx2d.lineWidth = triangle.id === deps.freeState.selectedTriangleId ? 3 : 2;
      ctx2d.fill();
      ctx2d.stroke();
      const center = mathToCanvas(triangle.center);
      ctx2d.fillStyle = triangle.fixed ? '#64748b' : color;
      ctx2d.font = '13px monospace';
      ctx2d.fillText(triangle.id, center.x + 5, center.y - 5);

      ctx2d.font = '12px monospace';
      for (let edgeIndex = 0;edgeIndex < 3;edgeIndex++) {
        const start = vertices[edgeIndex];
        const end = vertices[(edgeIndex + 1) % 3];
        const labelPoint = {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
        };
        const selectedEdge = deps.freeState.selectedSegments.some((segment) =>
          sameSegmentRef(segment, { kind: 'triangle-edge', triangleId: triangle.id, index: edgeIndex }),
        );
        ctx2d.fillStyle = selectedEdge || triangle.id === deps.freeState.selectedTriangleId ? '#111827' : color;
        ctx2d.fillText(`${triangle.id}:e${edgeIndex}`, labelPoint.x + 4, labelPoint.y - 4);
      }
    }

    if (cUnionReady) {
      drawCoverageGaps(ctx2d, validation.segments);
    }
    drawFreeSelectedSegments(ctx2d);
    if (deps.freeState.cForm === 'c-union' && deps.cUnionModel) {
      drawCUnionBoundary(ctx2d, deps.cUnionModel);
    }
    if (deps.freeState.cForm === 'c-union') {
      drawCUnionReference(ctx2d);
    }

    ctx2d.font = '12px monospace';
    for (let i = 0;i < 6;i++) {
      const point = mathToCanvas(midpoint(i));
      ctx2d.beginPath();
      ctx2d.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      ctx2d.fillStyle = i === 4 && deps.freeState.cForm === 'c-union'
        ? '#d97706'
        : pointFailures.includes(`M${i}`) ? '#dc2626' : '#0f172a';
      ctx2d.fill();
      ctx2d.fillText(`M${i}`, point.x + 5, point.y - 5);
    }

    if (deps.freeState.target === 'S_T') {
      for (const target of deps.freeState.targetTPoints) {
        for (let i = 0;i < 6;i++) {
          const label = targetTLabel(i, target.id);
          const point = mathToCanvas(targetTPoint(target, i));
          ctx2d.beginPath();
          ctx2d.arc(point.x, point.y, 6, 0, 2 * Math.PI);
          ctx2d.fillStyle = pointFailures.includes(label) ? '#dc2626' : '#f97316';
          ctx2d.fill();
          ctx2d.strokeStyle = target.fixed ? '#92400e' : '#7c2d12';
          ctx2d.lineWidth = target.fixed ? 2 : 1.5;
          ctx2d.stroke();
          ctx2d.fillStyle = '#7c2d12';
          ctx2d.fillText(label, point.x + 7, point.y + 12);
        }
      }
    }

    if (deps.freeState.target === 'BENZENE') {
      for (let i = 0;i < 6;i++) {
        const point = mathToCanvas(benzenePoint(i));
        ctx2d.beginPath();
        ctx2d.arc(point.x, point.y, 5, 0, 2 * Math.PI);
        ctx2d.fillStyle = pointFailures.includes(`B${i}`) ? '#dc2626' : '#7c3aed';
        ctx2d.fill();
        ctx2d.strokeStyle = '#4c1d95';
        ctx2d.lineWidth = 1.5;
        ctx2d.stroke();
        ctx2d.fillStyle = '#4c1d95';
        ctx2d.fillText(`B${i}`, point.x + 7, point.y - 7);
      }
    }

    drawSymmetricPoints(ctx2d, new Set(pointFailures));

    for (const label of deps.freeState.labels) {
      if (!label.point || isFreeLabelSuspended(deps.freeState, label, deps.cUnionModel)) {
        continue;
      }
      const point = mathToCanvas(label.point);
      ctx2d.beginPath();
      ctx2d.arc(point.x, point.y, 5, 0, 2 * Math.PI);
      ctx2d.fillStyle = '#2563eb';
      ctx2d.fill();
      ctx2d.fillText(label.name, point.x + 6, point.y - 6);
    }
    ctx2d.restore();
  }

  function drawFreeSelectedSegments(ctx2d: CanvasRenderingContext2D): void {
    if (deps.freeState.selectedSegments.length === 0) {
      return;
    }

    ctx2d.save();
    ctx2d.lineCap = 'round';
    for (const selected of deps.freeState.selectedSegments) {
      if (selected.kind === 'c-union-boundary') {
        continue;
      }
      const segment = getSegmentByRef(deps.freeState, selected, deps.cUnionModel);
      if (!segment) {
        continue;
      }
      const start = mathToCanvas(segment.start);
      const end = mathToCanvas(segment.end);
      ctx2d.beginPath();
      ctx2d.moveTo(start.x, start.y);
      ctx2d.lineTo(end.x, end.y);
      ctx2d.strokeStyle = '#facc15';
      ctx2d.lineWidth = 6;
      ctx2d.stroke();
      const labelPoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      ctx2d.fillStyle = '#92400e';
      ctx2d.font = '13px monospace';
      ctx2d.fillText(segment.label, labelPoint.x + 6, labelPoint.y + 14);
    }
    ctx2d.restore();
  }

  return {
    drawFreeMode,
    drawSymmetricPoints
  };
}

