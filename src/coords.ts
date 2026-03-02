import type { Point } from './types';

export const config = {
  canvasSize: 600,
  scale: 240,
  centerX: 300,
  centerY: 300,
};

export function mathToCanvas(p: Point): Point {
  return {
    x: config.centerX + config.scale * p.x,
    y: config.centerY - config.scale * p.y,
  };
}

export function canvasToMath(p: Point): Point {
  return {
    x: (p.x - config.centerX) / config.scale,
    y: (config.centerY - p.y) / config.scale,
  };
}

export function scaleToCanvas(d: number): number {
  return d * config.scale;
}

export function scaleToMath(d: number): number {
  return d / config.scale;
}
