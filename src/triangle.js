import { mathToCanvas } from './coords';
import { rayPolygonExitDistance } from './geometry';
import { HEXAGON_VERTICES } from './hexagon';
const CIRCUMRADIUS = 1 / Math.sqrt(3);
const LIGHT_BLUE = '#89CFF0';
export function getVertices(state) {
    const { position, angle } = state;
    const verts = [];
    for (let k = 0; k < 3; k++) {
        const a = angle + Math.PI / 2 + k * (2 * Math.PI / 3);
        verts.push({
            x: position.x + CIRCUMRADIUS * Math.cos(a),
            y: position.y + CIRCUMRADIUS * Math.sin(a),
        });
    }
    return verts;
}
/** Valid centroid positions such that the origin stays inside the triangle. */
export function getValidRegion(angle) {
    const verts = [];
    for (let k = 0; k < 3; k++) {
        const a = angle + Math.PI / 2 + k * (2 * Math.PI / 3);
        verts.push({
            x: -CIRCUMRADIUS * Math.cos(a),
            y: -CIRCUMRADIUS * Math.sin(a),
        });
    }
    return verts;
}
export function drawTriangle(ctx, state) {
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
export function drawControlPoint(ctx, state) {
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
export function getInnerGammas(state) {
    const verts = getVertices(state);
    const origin = { x: 0, y: 0 };
    return HEXAGON_VERTICES.map((vertex) => {
        const distance = rayPolygonExitDistance(origin, vertex, verts);
        return distance ?? 0;
    });
}
