import { canvasToMath, config, scaleToMath } from './coords';
import { closestPointOnSegment, clampPointToCircle, clampPointToTriangle, distance, distanceToCircleBorder, distanceToSegment, distanceToTriangleBorder, pointInCircle, pointInTriangle, rotatePoint, } from './geometry';
import { HEXAGON_VERTICES } from './hexagon';
import { CIRCUMRADIUS, getVertices, getValidRegion } from './triangle';
const LOCAL_C_HIT_PX = 8;
const LOCAL_C_RAY_HIT_PX = 10;
const CONTROL_POINT_HIT_PX = 8;
const BORDER_HIT_PX = 6;
const START_EDGE_HIT_PX = 8;
const PEN_HIT_SCALE = 1.35;
const TOUCH_HIT_SCALE = 1.75;
export function setupInteraction(canvas, state, getShapeMode, getGammas, getLocalCs, onLocalCChange, render, onStartValueSelect) {
    let interaction = { kind: 'idle' };
    let activePointerId = null;
    let activePointerType = 'mouse';
    function getHitScale(pointerType) {
        if (pointerType === 'touch')
            return TOUCH_HIT_SCALE;
        if (pointerType === 'pen')
            return PEN_HIT_SCALE;
        return 1;
    }
    function getPointerMath(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? config.canvasSize / rect.width : 1;
        const scaleY = rect.height > 0 ? config.canvasSize / rect.height : 1;
        return canvasToMath({
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        });
    }
    function localCPoint(index, localC) {
        const vertex = HEXAGON_VERTICES[index];
        const radius = 1 - localC;
        return {
            x: vertex.x * radius,
            y: vertex.y * radius,
        };
    }
    function getLocalCHandleIndex(mouse, pointerType) {
        if (getShapeMode() !== 'local-c') {
            return null;
        }
        const maxDistance = scaleToMath(LOCAL_C_HIT_PX * getHitScale(pointerType));
        let bestIndex = null;
        let bestDistance = Infinity;
        const localCs = getLocalCs();
        for (let i = 0; i < localCs.length; i++) {
            const handle = localCPoint(i, localCs[i]);
            const handleDistance = distance(mouse, handle);
            if (handleDistance > maxDistance || handleDistance >= bestDistance) {
                continue;
            }
            bestDistance = handleDistance;
            bestIndex = i;
        }
        return bestIndex;
    }
    function getLocalCRayIndex(mouse, pointerType) {
        if (getShapeMode() !== 'local-c') {
            return null;
        }
        const maxDistance = scaleToMath(LOCAL_C_RAY_HIT_PX * getHitScale(pointerType));
        let bestIndex = null;
        let bestDistance = Infinity;
        for (let i = 0; i < 6; i++) {
            const gamma = Math.max(0, Math.min(1, getGammas()[i] ?? 0));
            const boundary = localCPoint(i, 1 - gamma);
            const vertex = HEXAGON_VERTICES[i];
            const rayDistance = distanceToSegment(mouse, boundary, vertex);
            if (rayDistance > maxDistance || rayDistance >= bestDistance) {
                continue;
            }
            bestDistance = rayDistance;
            bestIndex = i;
        }
        return bestIndex;
    }
    function projectLocalC(mouse, index) {
        const gamma = Math.max(0, Math.min(1, getGammas()[index] ?? 0));
        const boundary = localCPoint(index, 1 - gamma);
        const vertex = HEXAGON_VERTICES[index];
        const closest = closestPointOnSegment(mouse, boundary, vertex);
        return Math.max(0, Math.min(1 - gamma, distance(closest, vertex)));
    }
    function hitTest(mouse, pointerType) {
        const hitScale = getHitScale(pointerType);
        const localCHandleIndex = getLocalCHandleIndex(mouse, pointerType) ?? getLocalCRayIndex(mouse, pointerType);
        if (localCHandleIndex !== null) {
            return { kind: 'local-c-handle', index: localCHandleIndex };
        }
        const shapeMode = getShapeMode();
        if (shapeMode === 'local-c') {
            return { kind: 'none' };
        }
        if (shapeMode === 'circle') {
            const borderDist = distanceToCircleBorder(mouse, state.position, CIRCUMRADIUS);
            if (borderDist <= scaleToMath(BORDER_HIT_PX * hitScale))
                return { kind: 'border' };
            if (pointInCircle(mouse, state.position, CIRCUMRADIUS))
                return { kind: 'interior' };
            return { kind: 'none' };
        }
        const cpDist = distance(mouse, state.controlPoint);
        if (cpDist <= scaleToMath(CONTROL_POINT_HIT_PX * hitScale))
            return { kind: 'control-point' };
        const verts = getVertices(state);
        const borderDist = distanceToTriangleBorder(mouse, verts);
        if (borderDist <= scaleToMath(BORDER_HIT_PX * hitScale))
            return { kind: 'border' };
        if (pointInTriangle(mouse, verts[0], verts[1], verts[2]))
            return { kind: 'interior' };
        return { kind: 'none' };
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
    function getStartValueFromMouse(mouse, pointerType) {
        if (!onStartValueSelect)
            return null;
        const start = HEXAGON_VERTICES[5];
        const end = HEXAGON_VERTICES[0];
        const hitDistance = distanceToSegment(mouse, start, end);
        if (hitDistance > scaleToMath(START_EDGE_HIT_PX * getHitScale(pointerType)))
            return null;
        return projectStartValue(mouse);
    }
    function updateCursor(mouse, pointerType) {
        if (pointerType !== 'mouse') {
            return;
        }
        const hit = hitTest(mouse, pointerType);
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
                canvas.style.cursor = getStartValueFromMouse(mouse, pointerType) === null
                    ? 'default'
                    : 'pointer';
        }
    }
    function stopInteraction() {
        interaction = { kind: 'idle' };
        if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
            canvas.releasePointerCapture(activePointerId);
        }
        activePointerId = null;
        activePointerType = 'mouse';
    }
    function onPointerDown(e) {
        if (!e.isPrimary) {
            return;
        }
        const pointerType = e.pointerType || 'mouse';
        const mouse = getPointerMath(e);
        const hit = hitTest(mouse, pointerType);
        const shapeMode = getShapeMode();
        let startedInteraction = true;
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
                }
                else {
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
                    const startValue = getStartValueFromMouse(mouse, pointerType);
                    if (startValue !== null) {
                        interaction = { kind: 'dragging-start-value' };
                        onStartValueSelect?.(startValue);
                        render();
                        break;
                    }
                }
                startedInteraction = false;
        }
        if (!startedInteraction) {
            updateCursor(mouse, pointerType);
            return;
        }
        activePointerId = e.pointerId;
        activePointerType = pointerType;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
    function onPointerMove(e) {
        const pointerType = activePointerId === e.pointerId ? activePointerType : (e.pointerType || 'mouse');
        const mouse = getPointerMath(e);
        if (interaction.kind === 'idle') {
            updateCursor(mouse, pointerType);
            return;
        }
        if (activePointerId !== e.pointerId) {
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
                : clampPointToTriangle(desiredPos, ...getValidRegion(state.angle));
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
        e.preventDefault();
    }
    function onPointerUp(e) {
        if (activePointerId !== e.pointerId) {
            return;
        }
        const mouse = getPointerMath(e);
        const pointerType = activePointerType;
        stopInteraction();
        updateCursor(mouse, pointerType);
    }
    function onPointerCancel(e) {
        if (activePointerId !== e.pointerId) {
            return;
        }
        stopInteraction();
        canvas.style.cursor = 'default';
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', (e) => {
        if (interaction.kind === 'idle' && (e.pointerType || 'mouse') === 'mouse') {
            canvas.style.cursor = 'default';
        }
    });
    canvas.addEventListener('lostpointercapture', () => {
        interaction = { kind: 'idle' };
        activePointerId = null;
        activePointerType = 'mouse';
        canvas.style.cursor = 'default';
    });
}
