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

function validAnchors(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 && a <= 1 && b <= 1;
}

// The ordinary AB envelope bounds every endpoint-conditioned subfamily.
// Unlike the historical plotting helper, infeasible anchors have no capacity.
export function ownRayCapacity(a: number, b: number): number | null {
  if (!validAnchors(a, b)) return null;
  const distanceSquared = a * a + a * b + b * b;
  if (distanceSquared > 1) return null;
  if (a + b === 0) return 1;
  if (a + b <= 1) return algorithm2CStar(a, b);
  const m = Math.min(a, b);
  const M = Math.max(a, b);
  return clamp01(M * (2 * m * M + 1 - Math.sqrt(4 * distanceSquared - 3)) / (2 * (1 - m * m)));
}

// 2008: C_+(a,b), including the plateau value at b = tau(a).
export function forwardNeighborCapacity(a: number, b: number): number | null {
  if (!validAnchors(a, b) || a + b > 1) return null;
  if (a > 0.5) return 1 - b;
  let low = a;
  let high = 1;
  for (let step = 0; step < 52; step++) {
    const p = (low + high) / 2;
    const value = p ** 3 - (a + 2) * p * p + 2 * (a + 1) * p - 1;
    if (value <= 0) low = p;
    else high = p;
  }
  const p = (low + high) / 2;
  const sigma = 1 - p;
  const tau = 1 - a - (p - a) * (1 - p);
  if (b <= sigma) return 1 - b;
  if (b <= tau + 2 * Number.EPSILON) return p;
  return clamp01(a + 0.5 - Math.sqrt(Math.max(0, (a + b) ** 2 - 0.75)));
}

export function backwardNeighborCapacity(a: number, b: number): number | null {
  return forwardNeighborCapacity(b, a);
}
