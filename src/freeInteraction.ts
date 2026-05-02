import { canvasToMath, config, scaleToMath } from './coords';
import { distanceToSegment, pointInTriangle } from './geometry';
import {
  createLabel,
  getSegmentByRef,
  projectTriangleToConstraints,
  refreshLabels,
  sameSegmentRef,
  skeletonSegments,
  triangleVertices,
} from './freeGeometry';
import type { FreeSegmentRef, FreeState, FreeTriangleId, FreeTriangleState } from './freeTypes';
import type { Point } from './types';

const EDGE_HIT_PX = 7;
const ROTATE_HIT_PX = 8;

export interface FreeInteractionApi {
  setEnabled(enabled: boolean): void;
}

type DragState =
  | { kind: 'idle' }
  | {
      kind: 'move-triangle';
      pointerId: number;
      triangleId: FreeTriangleId;
      startMouse: Point;
      startCenter: Point;
      startAngle: number;
      rotate: boolean;
    };

export function setupFreeInteraction(
  canvas: HTMLCanvasElement,
  getState: () => FreeState,
  render: () => void,
  onDragEnd?: () => void,
): FreeInteractionApi {
  let enabled = false;
  let dragState: DragState = { kind: 'idle' };

  function getPointerMath(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? config.canvasSize / rect.width : 1;
    const scaleY = rect.height > 0 ? config.canvasSize / rect.height : 1;
    return canvasToMath({
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    });
  }

  function selectedTriangle(): FreeTriangleState | null {
    const state = getState();
    return state.triangles.find((triangle) => triangle.id === state.selectedTriangleId) ?? null;
  }

  function triangleUnderPoint(point: Point): FreeTriangleState | null {
    const state = getState();
    const selected = selectedTriangle();
    if (
      selected &&
      !selected.hidden &&
      !selected.fixed &&
      pointInTriangle(point, ...triangleVertices(selected.center, selected.angle))
    ) {
      return selected;
    }

    for (let i = state.triangles.length - 1; i >= 0; i--) {
      const triangle = state.triangles[i];
      if (triangle.hidden || triangle.fixed) continue;
      if (pointInTriangle(point, ...triangleVertices(triangle.center, triangle.angle))) {
        return triangle;
      }
    }
    return null;
  }

  function isNearSelectedEdge(point: Point, triangle: FreeTriangleState): boolean {
    const vertices = triangleVertices(triangle.center, triangle.angle);
    const limit = scaleToMath(ROTATE_HIT_PX);
    return vertices.some((vertex, index) =>
      distanceToSegment(point, vertex, vertices[(index + 1) % 3]) <= limit,
    );
  }

  function segmentUnderPoint(point: Point): FreeSegmentRef | null {
    const state = getState();
    const limit = scaleToMath(EDGE_HIT_PX);
    let best: { ref: FreeSegmentRef; distance: number } | null = null;
    for (const segment of skeletonSegments(state)) {
      const d = distanceToSegment(point, segment.start, segment.end);
      if (d <= limit && (!best || d < best.distance)) {
        best = { ref: segment.ref, distance: d };
      }
    }
    return best?.ref ?? null;
  }

  function updateCursor(point: Point): void {
    const state = getState();
    if (!enabled) return;
    if (state.tool === 'mark') {
      canvas.style.cursor = segmentUnderPoint(point) ? 'crosshair' : 'default';
      return;
    }
    const selected = selectedTriangle();
    if (selected && !selected.hidden && !selected.fixed && isNearSelectedEdge(point, selected)) {
      canvas.style.cursor = 'alias';
      return;
    }
    canvas.style.cursor = triangleUnderPoint(point) ? 'move' : 'default';
  }

  function selectMarkSegment(ref: FreeSegmentRef): void {
    const state = getState();
    if (state.selectedSegments.some((selected) => sameSegmentRef(selected, ref))) {
      state.selectedSegments = state.selectedSegments.filter((selected) => !sameSegmentRef(selected, ref));
      state.status = 'Segment unselected.';
      return;
    }

    const next = [...state.selectedSegments, ref].slice(-2);
    state.selectedSegments = next;
    if (next.length < 2) {
      const segment = getSegmentByRef(state, ref);
      state.status = `Selected ${segment?.label ?? 'segment'}; choose one more segment.`;
      return;
    }

    const label = createLabel(state, next[0], next[1]);
    if (!label) {
      state.status = 'Selected segments do not intersect.';
      state.selectedSegments = [];
      return;
    }
    state.labels.push(label);
    state.selectedSegments = [];
    state.status = `Created label ${label.name}.`;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!enabled || !e.isPrimary) return;
    const point = getPointerMath(e);
    const state = getState();
    if (state.tool === 'mark') {
      const ref = segmentUnderPoint(point);
      if (ref) {
        selectMarkSegment(ref);
        render();
        e.preventDefault();
      }
      return;
    }

    const triangle = triangleUnderPoint(point);
    if (!triangle) {
      updateCursor(point);
      return;
    }
    state.selectedTriangleId = triangle.id;
    dragState = {
      kind: 'move-triangle',
      pointerId: e.pointerId,
      triangleId: triangle.id,
      startMouse: point,
      startCenter: { ...triangle.center },
      startAngle: triangle.angle,
      rotate: isNearSelectedEdge(point, triangle),
    };
    canvas.setPointerCapture(e.pointerId);
    render();
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!enabled) return;
    const point = getPointerMath(e);
    const state = getState();
    if (dragState.kind === 'idle') {
      updateCursor(point);
      return;
    }
    const activeDrag = dragState;
    if (activeDrag.pointerId !== e.pointerId) return;
    const triangle = state.triangles.find((candidate) => candidate.id === activeDrag.triangleId);
    if (!triangle || triangle.fixed || triangle.hidden) return;

    if (activeDrag.rotate) {
      const startAngle = Math.atan2(
        activeDrag.startMouse.y - activeDrag.startCenter.y,
        activeDrag.startMouse.x - activeDrag.startCenter.x,
      );
      const currentAngle = Math.atan2(point.y - activeDrag.startCenter.y, point.x - activeDrag.startCenter.x);
      triangle.center = { ...activeDrag.startCenter };
      triangle.angle = activeDrag.startAngle + currentAngle - startAngle;
    } else {
      triangle.center = {
        x: activeDrag.startCenter.x + point.x - activeDrag.startMouse.x,
        y: activeDrag.startCenter.y + point.y - activeDrag.startMouse.y,
      };
      triangle.angle = activeDrag.startAngle;
    }

    projectTriangleToConstraints(state, triangle);
    refreshLabels(state);
    render();
    e.preventDefault();
  }

  function stop(e: PointerEvent): void {
    if (dragState.kind !== 'idle' && dragState.pointerId === e.pointerId) {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      dragState = { kind: 'idle' };
      updateCursor(getPointerMath(e));
      onDragEnd?.();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', () => {
    if (dragState.kind === 'idle' && enabled) canvas.style.cursor = 'default';
  });

  return {
    setEnabled(nextEnabled: boolean): void {
      enabled = nextEnabled;
      if (!enabled) {
        dragState = { kind: 'idle' };
      }
    },
  };
}
