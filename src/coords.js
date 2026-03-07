const SCALE_RATIO = 0.4;
export const config = {
    canvasSize: 600,
    scale: 240,
    centerX: 300,
    centerY: 300,
};
export function setCanvasSize(size) {
    const canvasSize = Math.max(1, Math.round(size));
    config.canvasSize = canvasSize;
    config.scale = canvasSize * SCALE_RATIO;
    config.centerX = canvasSize / 2;
    config.centerY = canvasSize / 2;
}
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
setCanvasSize(config.canvasSize);
