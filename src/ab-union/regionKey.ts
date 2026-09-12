import type { AbUnionRegionDefinition } from './types';

export function abUnionRegionKey(definition: AbUnionRegionDefinition): string {
  const { index, a, b, restriction, criticality, requiredInteriorPoints } = definition;
  return JSON.stringify([index, a, b, restriction, criticality, requiredInteriorPoints.map((point) => [point.x, point.y])]);
}
