import type { Point, TriangleState, InteractionState } from './types';
import { canvasToMath, scaleToMath } from './coords';
import { distance, distanceToTriangleBorder, pointInTriangle, rotatePoint, clampPointToTriangle } from './geometry';
import { getVertices, getValidRegion } from './triangle';

const CONTROL_POINT_HIT_PX = 8;
const BORDER_HIT_PX = 6;

export function setupInteraction(
  canvas: HTMLCanvasElement,
  state: TriangleState,
  render: () => void,
): void {
  let interaction: InteractionState = { kind: 'idle' };

  function getMouseMath(e: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return canvasToMath({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function hitTest(mouse: Point): 'control-point' | 'border' | 'interior' | 'none' {
    const cpDist = distance(mouse, state.controlPoint);
    if (cpDist <= scaleToMath(CONTROL_POINT_HIT_PX)) return 'control-point';

    const verts = getVertices(state);
    const borderDist = distanceToTriangleBorder(mouse, verts);
    if (borderDist <= scaleToMath(BORDER_HIT_PX)) return 'border';

    if (pointInTriangle(mouse, verts[0], verts[1], verts[2])) return 'interior';

    return 'none';
  }

  function updateCursor(mouse: Point): void {
    const hit = hitTest(mouse);
    switch (hit) {
      case 'control-point': canvas.style.cursor = 'pointer'; break;
      case 'border': canvas.style.cursor = 'alias'; break;
      case 'interior': canvas.style.cursor = 'move'; break;
      default: canvas.style.cursor = 'default';
    }
  }

  function onMouseDown(e: MouseEvent): void {
    const mouse = getMouseMath(e);
    const hit = hitTest(mouse);

    switch (hit) {
      case 'control-point':
        interaction = {
          kind: 'dragging-control-point',
          startMouse: mouse,
          startControl: { ...state.controlPoint },
        };
        break;
      case 'border':
        interaction = {
          kind: 'rotating-triangle',
          startMouse: mouse,
          startAngle: state.angle,
          startPos: { ...state.position },
        };
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

    if (interaction.kind === 'dragging-triangle') {
      const dx = mouse.x - interaction.startMouse.x;
      const dy = mouse.y - interaction.startMouse.y;
      const desiredPos = {
        x: interaction.startPos.x + dx,
        y: interaction.startPos.y + dy,
      };
      // Clamp centroid so origin stays inside the triangle
      const valid = getValidRegion(state.angle);
      const clamped = clampPointToTriangle(desiredPos, valid[0], valid[1], valid[2]);
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
      // Only apply if origin stays inside the triangle
      const valid = getValidRegion(newAngle);
      if (pointInTriangle(newPos, valid[0], valid[1], valid[2])) {
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
