export const config = {
    canvasSize: 600,
    scale: 240,
    centerX: 300,
    centerY: 300,
};
export function mathToCanvas(p) {
    return {
        x: config.centerX + config.scale * p.x,
        y: config.centerY - config.scale * p.y,
    };
}
export function canvasToMath(p) {
    return {
        x: (p.x - config.centerX) / config.scale,
        y: (config.centerY - p.y) / config.scale,
    };
}
export function scaleToCanvas(d) {
    return d * config.scale;
}
export function scaleToMath(d) {
    return d / config.scale;
}
