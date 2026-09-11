const BINARY_STEPS = 42;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function algorithm2QuarticValue(c: number, p: number): number {
  return c ** 4 - c ** 2 + p * c - p ** 2;
}

// Shared with the historical Core Case construction; preserve its selected
// quartic branch and 42-step evaluation for existing saved configurations.
export function algorithm2CStar(p: number, q: number): number {
  const sum = p + q;
  const m = Math.min(p, q);
  const M = Math.max(p, q);
  const transition = sum ** 4 - sum ** 2 + p * q;

  if (transition >= 0) {
    const denominator = 1 + Math.sqrt(Math.max(0, 4 * sum ** 2 - 3));
    return clamp01(2 * M / denominator);
  }

  let low = clamp(sum, 0, 1);
  let high = 1;
  for (let step = 0; step < BINARY_STEPS; step++) {
    const candidate = (low + high) / 2;
    if (algorithm2QuarticValue(candidate, m) <= 0) {
      low = candidate;
    } else {
      high = candidate;
    }
  }
  return clamp01((low + high) / 2);
}
