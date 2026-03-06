import { canvasToMath, scaleToMath } from './coords';
import { closestPointOnSegment, clampPointToTriangle, distance, distanceToSegment, distanceToTriangleBorder, pointInTriangle, rotatePoint, } from './geometry';
import { HEXAGON_VERTICES } from './hexagon';
import { getVertices, getValidRegion } from './triangle';
const CONTROL_POINT_HIT_PX = 8;
const BORDER_HIT_PX = 6;
const START_EDGE_HIT_PX = 8;
export function setupInteraction(canvas, state, render, onStartValueSelect) {
    let interaction = { kind: 'idle' };
    function getMouseMath(e) {
        const rect = canvas.getBoundingClientRect();
        return canvasToMath({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
    }
    function hitTest(mouse) {
        const cpDist = distance(mouse, state.controlPoint);
        if (cpDist <= scaleToMath(CONTROL_POINT_HIT_PX))
            return 'control-point';
        const verts = getVertices(state);
        const borderDist = distanceToTriangleBorder(mouse, verts);
        if (borderDist <= scaleToMath(BORDER_HIT_PX))
            return 'border';
        if (pointInTriangle(mouse, verts[0], verts[1], verts[2]))
            return 'interior';
        return 'none';
    }
    function projectStartValue(mouse) {
        const start = HEXAGON_VERTICES[5];
        const end = HEXAGON_VERTICES[0];
        const closest = closestPointOnSegment(mouse, start, end);
        const edge = {
            x: start.x - end.x,
            y: start.y - end.y,
        };
        const edgeLen2 = edge.x * edge.x + edge.y * edge.y;
        if (edgeLen2 === 0)
            return 0;
        const dx = closest.x - end.x;
        const dy = closest.y - end.y;
        return Math.max(0, Math.min(1, (dx * edge.x + dy * edge.y) / edgeLen2));
    }
    function getStartValueFromMouse(mouse) {
        if (!onStartValueSelect)
            return null;
        const start = HEXAGON_VERTICES[5];
        const end = HEXAGON_VERTICES[0];
        const hitDistance = distanceToSegment(mouse, start, end);
        if (hitDistance > scaleToMath(START_EDGE_HIT_PX))
            return null;
        return projectStartValue(mouse);
    }
    function updateCursor(mouse) {
        const hit = hitTest(mouse);
        switch (hit) {
            case 'control-point':
                canvas.style.cursor = 'pointer';
                break;
            case 'border':
                canvas.style.cursor = 'alias';
                break;
            case 'interior':
                canvas.style.cursor = 'move';
                break;
            default:
                canvas.style.cursor = getStartValueFromMouse(mouse) === null ? 'default' : 'pointer';
        }
    }
    function onMouseDown(e) {
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
    function onMouseMove(e) {
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
            const startAngleToCP = Math.atan2(interaction.startMouse.y - cp.y, interaction.startMouse.x - cp.x);
            const currAngleToCP = Math.atan2(mouse.y - cp.y, mouse.x - cp.x);
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
        if (interaction.kind === 'dragging-start-value') {
            onStartValueSelect?.(projectStartValue(mouse));
        }
        render();
    }
    function onMouseUp() {
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
