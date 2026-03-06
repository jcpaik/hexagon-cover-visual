import type { Point, ShapeMode, TriangleState, InteractionState } from './types';
import { canvasToMath, scaleToMath } from './coords';
import {
  closestPointOnSegment,
  clampPointToCircle,
  clampPointToTriangle,
  distance,
  distanceToCircleBorder,
  distanceToSegment,
  distanceToTriangleBorder,
  pointInCircle,
  pointInTriangle,
  rotatePoint,
} from './geometry';
import { HEXAGON_VERTICES } from './hexagon';
import { CIRCUMRADIUS, getVertices, getValidRegion } from './triangle';

const LOCAL_C_HIT_PX = 8;
const CONTROL_POINT_HIT_PX = 8;
const BORDER_HIT_PX = 6;
const START_EDGE_HIT_PX = 8;

export function setupInteraction(
  canvas: HTMLCanvasElement,
  state: TriangleState,
  getShapeMode: () => ShapeMode,
  getGammas: () => number[],
  getLocalCs: () => number[],
  onLocalCChange: (index: number, value: number) => void,
  render: () => void,
  onStartValueSelect?: (value: number) => void,
): void {
  let interaction: InteractionState = { kind: 'idle' };

  type HitTarget =
    | { kind: 'local-c-handle'; index: number }
    | { kind: 'control-point' }
    | { kind: 'border' }
    | { kind: 'interior' }
    | { kind: 'none' };

  function getMouseMath(e: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return canvasToMath({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function localCPoint(index: number, localC: number): Point {
    const vertex = HEXAGON_VERTICES[index];
    const radius = 1 - localC;
    return {
      x: vertex.x * radius,
      y: vertex.y * radius,
    };
  }

  function getLocalCHandleIndex(mouse: Point): number | null {
    if (getShapeMode() !== 'local-c') {
      return null;
    }

    let bestIndex: number | null = null;
    let bestDistance = Infinity;
    const localCs = getLocalCs();

    for (let i = 0; i < localCs.length; i++) {
      const handle = localCPoint(i, localCs[i]);
      const handleDistance = distance(mouse, handle);
      if (handleDistance > scaleToMath(LOCAL_C_HIT_PX) || handleDistance >= bestDistance) {
        continue;
      }
      bestDistance = handleDistance;
      bestIndex = i;
    }

    return bestIndex;
  }

  function projectLocalC(mouse: Point, index: number): number {
    const gamma = Math.max(0, Math.min(1, getGammas()[index] ?? 0));
    const boundary = localCPoint(index, 1 - gamma);
    const vertex = HEXAGON_VERTICES[index];
    const closest = closestPointOnSegment(mouse, boundary, vertex);
    return Math.max(0, Math.min(1 - gamma, distance(closest, vertex)));
  }

  function hitTest(mouse: Point): HitTarget {
    const localCHandleIndex = getLocalCHandleIndex(mouse);
    if (localCHandleIndex !== null) {
      return { kind: 'local-c-handle', index: localCHandleIndex };
    }

    const shapeMode = getShapeMode();

    if (shapeMode === 'local-c') {
      return { kind: 'none' };
    }

    if (shapeMode === 'circle') {
      const borderDist = distanceToCircleBorder(mouse, state.position, CIRCUMRADIUS);
      if (borderDist <= scaleToMath(BORDER_HIT_PX)) return { kind: 'border' };
      if (pointInCircle(mouse, state.position, CIRCUMRADIUS)) return { kind: 'interior' };
      return { kind: 'none' };
    }

    const cpDist = distance(mouse, state.controlPoint);
    if (cpDist <= scaleToMath(CONTROL_POINT_HIT_PX)) return { kind: 'control-point' };

    const verts = getVertices(state);
    const borderDist = distanceToTriangleBorder(mouse, verts);
    if (borderDist <= scaleToMath(BORDER_HIT_PX)) return { kind: 'border' };

    if (pointInTriangle(mouse, verts[0], verts[1], verts[2])) return { kind: 'interior' };

    return { kind: 'none' };
  }

  function projectStartValue(mouse: Point): number {
    const start = HEXAGON_VERTICES[5];
    const end = HEXAGON_VERTICES[0];
    const closest = closestPointOnSegment(mouse, start, end);
    const edge = {
      x: start.x - end.x,
      y: start.y - end.y,
    };
    const edgeLen2 = edge.x * edge.x + edge.y * edge.y;
    if (edgeLen2 === 0) return 0;

    const dx = closest.x - end.x;
    const dy = closest.y - end.y;
    return Math.max(0, Math.min(1, (dx * edge.x + dy * edge.y) / edgeLen2));
  }

  function getStartValueFromMouse(mouse: Point): number | null {
    if (!onStartValueSelect) return null;

    const start = HEXAGON_VERTICES[5];
    const end = HEXAGON_VERTICES[0];
    const hitDistance = distanceToSegment(mouse, start, end);
    if (hitDistance > scaleToMath(START_EDGE_HIT_PX)) return null;

    return projectStartValue(mouse);
  }

  function updateCursor(mouse: Point): void {
    const hit = hitTest(mouse);
    switch (hit.kind) {
      case 'local-c-handle':
      case 'control-point':
        canvas.style.cursor = 'pointer';
        break;
      case 'border':
        canvas.style.cursor = getShapeMode() === 'circle' ? 'move' : 'alias';
        break;
      case 'interior':
        canvas.style.cursor = 'move';
        break;
      default:
        canvas.style.cursor = getStartValueFromMouse(mouse) === null ? 'default' : 'pointer';
    }
  }

  function onMouseDown(e: MouseEvent): void {
    const mouse = getMouseMath(e);
    const hit = hitTest(mouse);
    const shapeMode = getShapeMode();

    switch (hit.kind) {
      case 'local-c-handle':
        interaction = {
          kind: 'dragging-local-c-handle',
          index: hit.index,
        };
        onLocalCChange(hit.index, projectLocalC(mouse, hit.index));
        render();
        break;
      case 'control-point':
        interaction = {
          kind: 'dragging-control-point',
          startMouse: mouse,
          startControl: { ...state.controlPoint },
        };
        break;
      case 'border':
        if (shapeMode === 'circle') {
          interaction = {
            kind: 'dragging-triangle',
            startMouse: mouse,
            startPos: { ...state.position },
            startControl: { ...state.controlPoint },
          };
        } else {
          interaction = {
            kind: 'rotating-triangle',
            startMouse: mouse,
            startAngle: state.angle,
            startPos: { ...state.position },
          };
        }
        break;
      case 'interior':
        interaction = {
          kind: 'dragging-triangle',
          startMouse: mouse,
          startPos: { ...state.position },
          startControl: { ...state.controlPoint },
        };
        break;
      default:
        {
          const startValue = getStartValueFromMouse(mouse);
          if (startValue !== null) {
            interaction = { kind: 'dragging-start-value' };
            onStartValueSelect?.(startValue);
            render();
            break;
          }
        }
        return;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent): void {
    const mouse = getMouseMath(e);

    if (interaction.kind === 'idle') {
      updateCursor(mouse);
      return;
    }

    if (interaction.kind === 'dragging-local-c-handle') {
      onLocalCChange(interaction.index, projectLocalC(mouse, interaction.index));
    }

    if (interaction.kind === 'dragging-triangle') {
      const dx = mouse.x - interaction.startMouse.x;
      const dy = mouse.y - interaction.startMouse.y;
      const desiredPos = {
        x: interaction.startPos.x + dx,
        y: interaction.startPos.y + dy,
      };
      const clamped = getShapeMode() === 'circle'
        ? clampPointToCircle(desiredPos, { x: 0, y: 0 }, CIRCUMRADIUS)
        : clampPointToTriangle(
            desiredPos,
            ...getValidRegion(state.angle),
          );
      const clampDx = clamped.x - interaction.startPos.x;
      const clampDy = clamped.y - interaction.startPos.y;
      state.position = clamped;
      state.controlPoint = {
        x: interaction.startControl.x + clampDx,
        y: interaction.startControl.y + clampDy,
      };
    }

    if (interaction.kind === 'rotating-triangle') {
      const cp = state.controlPoint;
      const startAngleToCP = Math.atan2(
        interaction.startMouse.y - cp.y,
        interaction.startMouse.x - cp.x,
      );
      const currAngleToCP = Math.atan2(
        mouse.y - cp.y,
        mouse.x - cp.x,
      );
      const dTheta = currAngleToCP - startAngleToCP;
      const newAngle = interaction.startAngle + dTheta;
      const newPos = rotatePoint(interaction.startPos, cp, dTheta);
      if (getShapeMode() !== 'circle' && pointInTriangle(newPos, ...getValidRegion(newAngle))) {
        state.angle = newAngle;
        state.position = newPos;
      }
    }

    if (interaction.kind === 'dragging-control-point') {
      const dx = mouse.x - interaction.startMouse.x;
      const dy = mouse.y - interaction.startMouse.y;
      state.controlPoint = {
        x: interaction.startControl.x + dx,
        y: interaction.startControl.y + dy,
      };
    }

    if (interaction.kind === 'dragging-start-value') {
      onStartValueSelect?.(projectStartValue(mouse));
    }

    render();
  }

  function onMouseUp(): void {
    interaction = { kind: 'idle' };
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  // Hover cursor updates when idle
  canvas.addEventListener('mousemove', (e) => {
    if (interaction.kind === 'idle') {
      updateCursor(getMouseMath(e));
    }
  });

  canvas.addEventListener('mousedown', onMouseDown);
}
