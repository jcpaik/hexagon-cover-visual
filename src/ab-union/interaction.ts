import { canvasToMath, config, scaleToMath } from '../coords';
import {
  clampPointToCircle,
  clampPointToTriangle,
  distance,
  distanceToCircleBorder,
  distanceToSegment,
  distanceToTriangleBorder,
  pointInCircle,
  pointInTriangle,
  rotatePoint,
} from '../geometry';
import { HEXAGON_VERTICES } from '../hexagon';
import { CIRCUMRADIUS, getValidRegion, getVertices } from '../triangle';
import type { Point, TriangleState } from '../types';
import {
  distanceToMarkPrimitive,
  localCPoint,
  markPrimitiveForRef,
  mod6,
  pointInClosedHex,
  pointOnEdge,
  projectEdgeValue,
  projectLocalC,
} from './geometry';
import {
  addAbUnionFMark,
  addEdgeDot,
  deleteEdgeDot,
  moveAbUnionFMark,
  requestAbUnionThetaOptimization,
  selectMarkSource,
  setAbUnionDotValue,
} from './state';
import type {
  AbUnionCenterMode,
  AbUnionDotHandle,
  AbUnionDotRole,
  AbUnionFMark,
  AbUnionMarkPrimitive,
  AbUnionMarkSourceRef,
  AbUnionState,
  AbUnionTool,
} from './types';

const REGION_VERTEX_HIT_PX = 12;
const POINT_HIT_PX = 14;
const LOCAL_C_HIT_PX = 8;
const LOCAL_C_RAY_HIT_PX = 10;
const CONTROL_POINT_HIT_PX = 8;
const BORDER_HIT_PX = 6;
const MARK_HIT_PX = 9;
const CLICK_CANCEL_PX = 6;
const PEN_HIT_SCALE = 1.35;
const TOUCH_HIT_SCALE = 1.75;

interface AbUnionInteractionCallbacks {
  onPreviewChange?: () => void;
  onCommitChange?: () => void;
  moveDotValue?: (state: AbUnionState, dot: AbUnionDotHandle, value: number) => void;
}

type PointerInteraction =
  | { kind: 'idle' }
  | { kind: 'pending-click'; startMouse: Point; hit: AbUnionHitTarget | null }
  | { kind: 'dragging-dot'; dot: AbUnionDotHandle; startMouse: Point; moved: boolean }
  | { kind: 'dragging-f-mark'; id: string; startMouse: Point; moved: boolean }
  | { kind: 'dragging-local-c'; index: number }
  | { kind: 'dragging-center'; startMouse: Point; startPos: Point; startControl: Point }
  | { kind: 'rotating-triangle'; startMouse: Point; startAngle: number; startPos: Point }
  | { kind: 'dragging-control'; startMouse: Point; startControl: Point };

type AbUnionHitTarget =
  | { kind: 'dot'; dot: AbUnionDotHandle }
  | { kind: 'edge'; index: number }
  | { kind: 'v'; index: number }
  | { kind: 'local-c'; index: number }
  | { kind: 'center-control' }
  | { kind: 'center-border' }
  | { kind: 'center-interior' };

function getHitScale(pointerType: string): number {
  if (pointerType === 'touch') return TOUCH_HIT_SCALE;
  if (pointerType === 'pen') return PEN_HIT_SCALE;
  return 1;
}

function getPointerMath(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? config.canvasSize / rect.width : 1;
  const scaleY = rect.height > 0 ? config.canvasSize / rect.height : 1;
  return canvasToMath({
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  });
}

function hitDotTarget(mouse: Point, state: AbUnionState, pointerType: string): AbUnionHitTarget | null {
  const pointHit = scaleToMath(POINT_HIT_PX * getHitScale(pointerType));
  let best: AbUnionHitTarget | null = null;
  let bestDistance = Infinity;

  for (let i = 0; i < 6; i++) {
    const edge = state.edgeDots[i];
    if (!edge.split) {
      const d = distance(mouse, pointOnEdge(i, edge.left));
      if (d <= pointHit && d < bestDistance) {
        best = { kind: 'dot', dot: { edge: i, role: 'shared' } };
        bestDistance = d;
      }
      continue;
    }

    const leftDistance = distance(mouse, pointOnEdge(i, edge.left));
    const rightDistance = distance(mouse, pointOnEdge(i, edge.right));
    if (leftDistance <= pointHit || rightDistance <= pointHit) {
      let role: AbUnionDotRole = leftDistance <= rightDistance ? 'left' : 'right';
      if (Math.abs(leftDistance - rightDistance) < 1e-6) {
        const projected = projectEdgeValue(mouse, i);
        role = projected <= (edge.left + edge.right) / 2 ? 'left' : 'right';
      }
      const d = Math.min(leftDistance, rightDistance);
      if (d < bestDistance) {
        best = { kind: 'dot', dot: { edge: i, role } };
        bestDistance = d;
      }
    }
  }

  return best;
}

function hitFMarkTarget(mouse: Point, state: AbUnionState, pointerType: string): AbUnionFMark | null {
  const pointHit = scaleToMath(POINT_HIT_PX * getHitScale(pointerType));
  let best: AbUnionFMark | null = null;
  let bestDistance = Infinity;
  for (const mark of state.fMarks) {
    const d = distance(mouse, mark.point);
    if (d <= pointHit && d < bestDistance) {
      best = mark;
      bestDistance = d;
    }
  }
  return best;
}

function hitRegionTarget(mouse: Point, state: AbUnionState, pointerType: string): AbUnionHitTarget | null {
  const dot = hitDotTarget(mouse, state, pointerType);
  if (dot) return dot;

  const vertexHit = scaleToMath(REGION_VERTEX_HIT_PX * getHitScale(pointerType));
  let best: AbUnionHitTarget | null = null;
  let bestDistance = Infinity;

  for (let i = 0; i < 6; i++) {
    const d = distance(mouse, HEXAGON_VERTICES[i]);
    if (d <= vertexHit && d < bestDistance) {
      best = { kind: 'v', index: i };
      bestDistance = d;
    }
  }

  return best;
}

function hitEdgeTarget(mouse: Point, pointerType: string): AbUnionHitTarget | null {
  const edgeHit = scaleToMath(LOCAL_C_RAY_HIT_PX * getHitScale(pointerType));
  let best: AbUnionHitTarget | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < 6; i++) {
    const d = distanceToSegment(mouse, HEXAGON_VERTICES[i], HEXAGON_VERTICES[mod6(i + 1)]);
    if (d <= edgeHit && d < bestDistance) {
      best = { kind: 'edge', index: i };
      bestDistance = d;
    }
  }
  return best;
}

function hitLocalC(mouse: Point, localCs: number[], pointerType: string): AbUnionHitTarget | null {
  const handleHit = scaleToMath(LOCAL_C_HIT_PX * getHitScale(pointerType));
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < 6; i++) {
    const d = distance(mouse, localCPoint(i, localCs[i] ?? 0));
    if (d <= handleHit && d < bestDistance) {
      bestIndex = i;
      bestDistance = d;
    }
  }
  if (bestIndex !== null) return { kind: 'local-c', index: bestIndex };

  const rayHit = scaleToMath(LOCAL_C_RAY_HIT_PX * getHitScale(pointerType));
  for (let i = 0; i < 6; i++) {
    const d = distanceToSegment(mouse, localCPoint(i, 1), HEXAGON_VERTICES[i]);
    if (d <= rayHit && d < bestDistance) {
      bestIndex = i;
      bestDistance = d;
    }
  }
  return bestIndex === null ? null : { kind: 'local-c', index: bestIndex };
}

function hitCenterShape(
  mouse: Point,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
  pointerType: string,
): AbUnionHitTarget | null {
  if (state.centerMode === 'none') {
    return null;
  }
  if (state.centerLocked) {
    return null;
  }
  const hitScale = getHitScale(pointerType);
  if (state.centerMode === 'local-c') {
    return hitLocalC(mouse, localCs, pointerType);
  }
  if (state.centerMode === 'circle') {
    const borderDist = distanceToCircleBorder(mouse, triangleState.position, CIRCUMRADIUS);
    if (borderDist <= scaleToMath(BORDER_HIT_PX * hitScale)) return { kind: 'center-border' };
    if (pointInCircle(mouse, triangleState.position, CIRCUMRADIUS)) return { kind: 'center-interior' };
    return null;
  }

  const controlDist = distance(mouse, triangleState.controlPoint);
  if (controlDist <= scaleToMath(CONTROL_POINT_HIT_PX * hitScale)) return { kind: 'center-control' };
  const vertices = getVertices(triangleState);
  const borderDist = distanceToTriangleBorder(mouse, vertices);
  if (borderDist <= scaleToMath(BORDER_HIT_PX * hitScale)) return { kind: 'center-border' };
  if (pointInTriangle(mouse, vertices[0], vertices[1], vertices[2])) return { kind: 'center-interior' };
  return null;
}

function selectableMarkPrimitives(
  state: AbUnionState,
  triangleState: TriangleState,
): AbUnionMarkPrimitive[] {
  if (state.centerMode !== 'triangle' && state.centerMode !== 'circle') return [];
  const refs: AbUnionMarkSourceRef[] = [
    ...Array.from({ length: 6 }, (_, index) => ({ kind: 'hex-edge', index }) as AbUnionMarkSourceRef),
    ...Array.from({ length: 6 }, (_, index) => ({ kind: 'half-diagonal', index }) as AbUnionMarkSourceRef),
  ];

  if (state.centerMode === 'triangle') {
    refs.push(...Array.from({ length: 3 }, (_, index) => ({ kind: 'center-triangle-edge', index }) as AbUnionMarkSourceRef));
  } else if (state.centerMode === 'circle') {
    refs.push({ kind: 'center-circle', index: 0 });
  }

  return refs.flatMap((ref) => {
    const primitive = markPrimitiveForRef(ref, state, triangleState);
    return primitive ? [primitive] : [];
  });
}

function hitMarkSource(
  mouse: Point,
  state: AbUnionState,
  triangleState: TriangleState,
  pointerType: string,
): AbUnionMarkSourceRef | null {
  const limit = scaleToMath(MARK_HIT_PX * getHitScale(pointerType));
  let best: { ref: AbUnionMarkSourceRef; distance: number } | null = null;
  for (const primitive of selectableMarkPrimitives(state, triangleState)) {
    const d = distanceToMarkPrimitive(mouse, primitive);
    if (d <= limit && (!best || d < best.distance)) {
      best = { ref: primitive.ref, distance: d };
    }
  }
  return best?.ref ?? null;
}

function hitTest(
  mouse: Point,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
  pointerType: string,
): AbUnionHitTarget | null {
  return (state.tool === 'add' ? hitDotTarget(mouse, state, pointerType) ?? hitEdgeTarget(mouse, pointerType) : null)
    ?? hitRegionTarget(mouse, state, pointerType)
    ?? hitCenterShape(mouse, state, triangleState, localCs, pointerType);
}

function setActiveOnly(state: AbUnionState, regions: number[]): void {
  const wanted = new Set(regions.map(mod6));
  const same = state.activeRegions.every((active, index) => active === wanted.has(index));
  state.activeRegions = Array(6).fill(false);
  if (same) return;
  for (const index of wanted) {
    state.activeRegions[index] = true;
  }
}

function handleClick(state: AbUnionState, hit: AbUnionHitTarget | null): void {
  if (!hit) {
    state.activeRegions = Array(6).fill(false);
  } else if (hit.kind === 'v') {
    setActiveOnly(state, [hit.index]);
  } else if (hit.kind === 'dot') {
    if (hit.dot.role === 'left') {
      setActiveOnly(state, [hit.dot.edge]);
    } else if (hit.dot.role === 'right') {
      setActiveOnly(state, [hit.dot.edge + 1]);
    } else {
      setActiveOnly(state, [hit.dot.edge, hit.dot.edge + 1]);
    }
  }
}

function updateCursor(
  canvas: HTMLCanvasElement,
  hit: AbUnionHitTarget | null,
  centerMode: AbUnionCenterMode,
  tool: AbUnionTool,
): void {
  if (!hit) {
    canvas.style.cursor = 'default';
  } else if (tool === 'add' && hit.kind === 'edge') {
    canvas.style.cursor = 'copy';
  } else if (tool === 'delete' && hit.kind === 'dot') {
    canvas.style.cursor = 'pointer';
  } else if (hit.kind === 'dot') {
    canvas.style.cursor = 'grab';
  } else if (hit.kind === 'v' || hit.kind === 'local-c' || hit.kind === 'center-control') {
    canvas.style.cursor = 'pointer';
  } else if (hit.kind === 'center-border') {
    canvas.style.cursor = centerMode === 'circle' ? 'move' : 'alias';
  } else {
    canvas.style.cursor = 'move';
  }
}

function updateFMarkCursor(
  canvas: HTMLCanvasElement,
  mouse: Point,
  state: AbUnionState,
  pointerType: string,
): void {
  if (hitFMarkTarget(mouse, state, pointerType)) {
    canvas.style.cursor = 'grab';
  } else if (pointInClosedHex(mouse)) {
    canvas.style.cursor = 'crosshair';
  } else {
    canvas.style.cursor = 'default';
  }
}

export function setupAbUnionInteraction(
  canvas: HTMLCanvasElement,
  isEnabled: () => boolean,
  getState: () => AbUnionState,
  triangleState: TriangleState,
  getLocalCs: () => number[],
  onLocalCChange: (index: number, value: number) => void,
  render: () => void,
  callbacks: AbUnionInteractionCallbacks = {},
): void {
  let interaction: PointerInteraction = { kind: 'idle' };
  let activePointerId: number | null = null;
  let activePointerType = 'mouse';

  function moveDotValue(state: AbUnionState, dot: AbUnionDotHandle, value: number): void {
    if (callbacks.moveDotValue) {
      callbacks.moveDotValue(state, dot, value);
    } else {
      setAbUnionDotValue(state, dot, value);
    }
  }

  function stop(): void {
    interaction = { kind: 'idle' };
    if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
      canvas.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    activePointerType = 'mouse';
  }

  function onPointerDown(event: PointerEvent): void {
    if (!isEnabled() || !event.isPrimary) return;
    const pointerType = event.pointerType || 'mouse';
    const mouse = getPointerMath(canvas, event);
    const state = getState();

    if (state.tool === 'd-mark' || state.tool === 's-mark') {
      const source = hitMarkSource(mouse, state, triangleState, pointerType);
      if (source) {
        selectMarkSource(
          state,
          source,
          state.tool === 's-mark' ? 'static' : 'dynamic',
          mouse,
          triangleState,
        );
        render();
        event.preventDefault();
      }
      return;
    }

    if (state.tool === 'f-mark') {
      const existingMark = hitFMarkTarget(mouse, state, pointerType);
      const id = existingMark?.id ?? addAbUnionFMark(state, mouse);
      if (existingMark) {
        state.selectedFMarkId = existingMark.id;
        state.status = `Selected ${existingMark.id}.`;
      }
      if (id) {
        interaction = { kind: 'dragging-f-mark', id, startMouse: mouse, moved: false };
        activePointerId = event.pointerId;
        activePointerType = pointerType;
        canvas.setPointerCapture(event.pointerId);
      }
      render();
      event.preventDefault();
      return;
    }

    const hit = hitTest(mouse, state, triangleState, getLocalCs(), pointerType);

    if (state.tool === 'add' && (hit?.kind === 'edge' || hit?.kind === 'dot')) {
      const edgeIndex = hit.kind === 'edge' ? hit.index : hit.dot.edge;
      addEdgeDot(state, edgeIndex, projectEdgeValue(mouse, edgeIndex));
      callbacks.onCommitChange?.();
      render();
      event.preventDefault();
      return;
    }
    if (state.tool === 'delete' && hit?.kind === 'dot') {
      deleteEdgeDot(state, hit.dot);
      callbacks.onCommitChange?.();
      render();
      event.preventDefault();
      return;
    }

    if (state.tool === 'move' && hit?.kind === 'dot') {
      interaction = { kind: 'dragging-dot', dot: hit.dot, startMouse: mouse, moved: false };
      moveDotValue(state, hit.dot, projectEdgeValue(mouse, hit.dot.edge));
      callbacks.onPreviewChange?.();
      render();
    } else if (hit?.kind === 'local-c') {
      interaction = { kind: 'dragging-local-c', index: hit.index };
      onLocalCChange(hit.index, projectLocalC(mouse, hit.index));
      render();
    } else if (hit?.kind === 'center-control') {
      interaction = { kind: 'dragging-control', startMouse: mouse, startControl: { ...triangleState.controlPoint } };
    } else if (hit?.kind === 'center-border') {
      interaction = state.centerMode === 'circle'
        ? {
            kind: 'dragging-center',
            startMouse: mouse,
            startPos: { ...triangleState.position },
            startControl: { ...triangleState.controlPoint },
          }
        : {
            kind: 'rotating-triangle',
            startMouse: mouse,
            startAngle: triangleState.angle,
            startPos: { ...triangleState.position },
          };
    } else if (hit?.kind === 'center-interior') {
      interaction = {
        kind: 'dragging-center',
        startMouse: mouse,
        startPos: { ...triangleState.position },
        startControl: { ...triangleState.controlPoint },
      };
    } else {
      interaction = { kind: 'pending-click', startMouse: mouse, hit };
    }

    activePointerId = event.pointerId;
    activePointerType = pointerType;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!isEnabled()) return;
    const pointerType = activePointerId === event.pointerId ? activePointerType : (event.pointerType || 'mouse');
    const mouse = getPointerMath(canvas, event);
    const state = getState();

    if (interaction.kind === 'idle') {
      if (state.tool === 'd-mark' || state.tool === 's-mark') {
        const source = hitMarkSource(mouse, state, triangleState, pointerType);
        canvas.style.cursor = source ? 'crosshair' : 'default';
        return;
      }
      if (state.tool === 'f-mark') {
        updateFMarkCursor(canvas, mouse, state, pointerType);
        return;
      }
      updateCursor(canvas, hitTest(mouse, state, triangleState, getLocalCs(), pointerType), state.centerMode, state.tool);
      return;
    }
    if (activePointerId !== event.pointerId) return;

    if (interaction.kind === 'pending-click') {
      if (distance(mouse, interaction.startMouse) > scaleToMath(CLICK_CANCEL_PX * getHitScale(pointerType))) {
        stop();
      }
      return;
    }

    if (interaction.kind === 'dragging-dot') {
      interaction.moved = interaction.moved
        || distance(mouse, interaction.startMouse) > scaleToMath(CLICK_CANCEL_PX * getHitScale(pointerType));
      moveDotValue(state, interaction.dot, projectEdgeValue(mouse, interaction.dot.edge));
      callbacks.onPreviewChange?.();
    } else if (interaction.kind === 'dragging-f-mark') {
      interaction.moved = interaction.moved
        || distance(mouse, interaction.startMouse) > scaleToMath(CLICK_CANCEL_PX * getHitScale(pointerType));
      moveAbUnionFMark(state, interaction.id, mouse);
    } else if (interaction.kind === 'dragging-local-c') {
      onLocalCChange(interaction.index, projectLocalC(mouse, interaction.index));
    } else if (interaction.kind === 'dragging-center') {
      const dx = mouse.x - interaction.startMouse.x;
      const dy = mouse.y - interaction.startMouse.y;
      const desiredPos = { x: interaction.startPos.x + dx, y: interaction.startPos.y + dy };
      const clamped = state.centerMode === 'circle'
        ? clampPointToCircle(desiredPos, { x: 0, y: 0 }, CIRCUMRADIUS)
        : clampPointToTriangle(desiredPos, ...getValidRegion(triangleState.angle));
      const clampDx = clamped.x - interaction.startPos.x;
      const clampDy = clamped.y - interaction.startPos.y;
      triangleState.position = clamped;
      triangleState.controlPoint = {
        x: interaction.startControl.x + clampDx,
        y: interaction.startControl.y + clampDy,
      };
    } else if (interaction.kind === 'rotating-triangle') {
      const cp = triangleState.controlPoint;
      const startAngle = Math.atan2(interaction.startMouse.y - cp.y, interaction.startMouse.x - cp.x);
      const currentAngle = Math.atan2(mouse.y - cp.y, mouse.x - cp.x);
      const delta = currentAngle - startAngle;
      const nextAngle = interaction.startAngle + delta;
      const nextPosition = rotatePoint(interaction.startPos, cp, delta);
      if (pointInTriangle(nextPosition, ...getValidRegion(nextAngle))) {
        triangleState.angle = nextAngle;
        triangleState.position = nextPosition;
      }
    } else if (interaction.kind === 'dragging-control') {
      triangleState.controlPoint = {
        x: interaction.startControl.x + mouse.x - interaction.startMouse.x,
        y: interaction.startControl.y + mouse.y - interaction.startMouse.y,
      };
    }

    render();
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!isEnabled() || activePointerId !== event.pointerId) return;
    const mouse = getPointerMath(canvas, event);
    const state = getState();
    const hit = hitTest(mouse, state, triangleState, getLocalCs(), activePointerType);

    if (interaction.kind === 'pending-click') {
      handleClick(state, interaction.hit ?? hit);
      render();
    } else if (interaction.kind === 'dragging-dot' && !interaction.moved) {
      handleClick(state, { kind: 'dot', dot: interaction.dot });
      callbacks.onCommitChange?.();
      render();
    } else if (interaction.kind === 'dragging-dot' && interaction.moved) {
      requestAbUnionThetaOptimization(state);
      callbacks.onCommitChange?.();
      render();
    }

    stop();
    if (state.tool === 'f-mark') {
      updateFMarkCursor(canvas, mouse, state, activePointerType);
    } else {
      updateCursor(canvas, hit, state.centerMode, state.tool);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) return;
    stop();
    canvas.style.cursor = 'default';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => {
    if (interaction.kind === 'idle' && isEnabled()) canvas.style.cursor = 'default';
  });
  canvas.addEventListener('lostpointercapture', () => {
    interaction = { kind: 'idle' };
    activePointerId = null;
    activePointerType = 'mouse';
  });
}
