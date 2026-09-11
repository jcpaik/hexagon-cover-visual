import { escapeHtml } from '../../app/format';
import { canvasToMath, config, mathToCanvas, scaleToMath } from '../../coords';
import { colorForTriangle, createDefaultFreeState, projectTriangleToConstraints, triangleVertices } from '../../freeGeometry';
import { setupFreeInteraction } from '../../freeInteraction';
import type { FreeState } from '../../freeTypes';
import { drawHexagon, HEXAGON_VERTICES } from '../../hexagon';
import {
  buildBC,
  buildD,
  deriveBC,
  deriveD,
  type BCParameters,
  type DParameters,
  type WitnessEvaluation,
} from '../../strategy3/geometry';
import { drawWitnessConstruction } from '../../strategy3/render';
import {
  createDefaultStrategy3State,
  sanitizeStrategy3State,
  STRATEGY3_TRIANGLE_IDS,
  type Strategy3State,
  type VTriangleId,
} from '../../strategy3/state';
import type { Point, ShapeMode } from '../../types';

interface Dependencies {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly controls: HTMLDivElement;
  readonly render: () => void;
  readonly shapeMode: ShapeMode;
}

type Mode = 'bc' | 'd';
type ParameterKey = 'left' | 'right' | 'radial0' | 'radial1' | 'radial2' | 'a' | 'epsilon' | 'beta';
interface Handle {
  id: string;
  key: ParameterKey;
  start: Point;
  end: Point;
  reverse?: boolean;
}

function numberText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : 'undefined';
}

function createAdapter(construction: Strategy3State[Mode]): FreeState {
  const adapter = createDefaultFreeState();
  adapter.target = 'S';
  adapter.tool = 'move';
  adapter.selectedTriangleId = construction.selectedTriangleId;
  for (const triangle of adapter.triangles) {
    if (triangle.id === 'C') {
      triangle.hidden = true;
      triangle.fixed = true;
      continue;
    }
    const pose = construction.triangles.find((pose) => pose.id === triangle.id)!;
    triangle.center = { ...pose.center };
    triangle.angle = pose.angle;
  }
  return adapter;
}

export function createStrategy3Controller(deps: Dependencies) {
  let state = createDefaultStrategy3State();
  let adapters = { bc: createAdapter(state.bc), d: createAdapter(state.d) };
  let enabled = false;
  let panelKey = '';
  let dragging: { mode: Mode; handle: Handle; pointerId: number } | null = null;

  function mode(): Mode | null {
    return deps.shapeMode === 'strategy3-bc' ? 'bc' : deps.shapeMode === 'strategy3-d' ? 'd' : null;
  }

  function saveTriangleChanges(): void {
    const active = mode();
    if (!active) return;
    const adapter = adapters[active];
    state[active].selectedTriangleId = adapter.selectedTriangleId as VTriangleId;
    state[active].triangles = adapter.triangles.filter((triangle) => triangle.id !== 'C').map((triangle) => ({
      id: triangle.id as VTriangleId,
      center: { ...triangle.center },
      angle: triangle.angle,
    }));
  }

  const interaction = setupFreeInteraction(deps.canvas, () => adapters[mode() ?? 'bc'], () => {
    saveTriangleChanges();
    deps.render();
  }, () => null);

  function stopHandleDrag(): void {
    if (dragging && deps.canvas.hasPointerCapture(dragging.pointerId)) {
      deps.canvas.releasePointerCapture(dragging.pointerId);
    }
    dragging = null;
  }

  function setEnabled(next: boolean): void {
    enabled = next;
    const active = mode();
    interaction.setEnabled(next && active !== null && state[active].source === 'triangles');
    if (!next || active !== dragging?.mode) stopHandleDrag();
  }

  function evaluation(active: Mode): WitnessEvaluation {
    if (active === 'bc') {
      return state.bc.source === 'parameters'
        ? buildBC(state.bc.parameters, state.bc.disabledPointIds)
        : deriveBC(adapters.bc.triangles, state.bc.disabledPointIds);
    }
    return state.d.source === 'parameters'
      ? buildD(state.d.parameters, state.d.disabledPointIds)
      : deriveD(adapters.d.triangles, state.d.disabledPointIds);
  }

  function parameterRows(active: Mode): Array<{ key: ParameterKey; label: string; value: number }> {
    if (active === 'bc') {
      const parameters = state.bc.parameters;
      return [
        { key: 'left', label: 'Gap left', value: parameters.left },
        { key: 'right', label: 'Gap right', value: parameters.right },
        ...parameters.radial.map((value, index) => ({ key: `radial${index}` as ParameterKey, label: `d${index + 2}`, value })),
      ];
    }
    return [
      { key: 'a', label: 'a', value: state.d.parameters.a },
      { key: 'epsilon', label: 'ε', value: state.d.parameters.epsilon },
      { key: 'beta', label: 'β', value: state.d.parameters.beta },
    ];
  }

  function setParameter(active: Mode, key: string, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const bounded = Math.max(0, Math.min(1, value));
    if (active === 'bc') {
      if (key === 'left' || key === 'right') state.bc.parameters[key] = bounded;
      else if (/^radial[0-2]$/.test(key)) state.bc.parameters.radial[Number(key.slice(-1))] = bounded;
      else return false;
    } else if (key === 'a' || key === 'epsilon' || key === 'beta') state.d.parameters[key] = bounded;
    else return false;
    return true;
  }

  function renderControls(active: Mode, sample: WitnessEvaluation): void {
    const construction = state[active];
    const key = `${active}:${construction.source}`;
    if (panelKey !== key) {
      panelKey = key;
      deps.controls.innerHTML = `
        <div class="free-toolbar">Source
          <button type="button" class="free-button" data-strategy3-source="parameters" aria-pressed="${construction.source === 'parameters'}">Parameters</button>
          <button type="button" class="free-button" data-strategy3-source="triangles" aria-pressed="${construction.source === 'triangles'}">V triangles</button>
        </div>
        <p class="free-small-status">${construction.source === 'parameters'
          ? 'Edit the construction parameters or drag its gap and radial points. Each source keeps its own values.'
          : 'Select a V triangle, drag its interior to move it, or drag near an edge to rotate. Each triangle retains its own vertex.'}</p>
        ${construction.source === 'parameters'
          ? parameterRows(active).map(({ key, label, value }) => `
            <div class="ab-union-toolbar">
              <label>${label}<input type="range" min="0" max="1" step="0.001" value="${value}" data-strategy3-parameter="${key}" aria-label="${label}"/></label>
              <input class="ab-hull-debug-number" type="number" min="0" max="1" step="0.001" value="${value}" data-strategy3-parameter="${key}" aria-label="${label} value"/>
            </div>`).join('')
          : `<div class="ab-union-toolbar"><label>Triangle
              <select data-strategy3-triangle>${STRATEGY3_TRIANGLE_IDS.map((id) => `<option value="${id}">${id}</option>`).join('')}</select>
            </label></div>
            <div class="ab-union-toolbar">${['x', 'y', 'angle'].map((key) => `<label>${key === 'angle' ? 'Angle (degrees)' : `Center ${key}`}<input class="ab-hull-debug-number" type="number" step="${key === 'angle' ? '1' : '0.01'}" data-strategy3-pose="${key}"/></label>`).join('')}</div>`}
        <div data-strategy3-readouts></div>
        <div class="ab-union-section-title">Witness points</div>
        <div class="free-toolbar" data-strategy3-points></div>
        <div data-strategy3-conditions></div>
        <div data-strategy3-reaches></div>
      `;
    }
    for (const { key, value } of parameterRows(active)) {
      deps.controls.querySelectorAll<HTMLInputElement>(`[data-strategy3-parameter="${key}"]`).forEach((input) => {
        if (input !== document.activeElement || input.type === 'range') input.value = numberText(value);
      });
    }
    const selector = deps.controls.querySelector<HTMLSelectElement>('[data-strategy3-triangle]');
    if (selector) selector.value = construction.selectedTriangleId;
    const selected = construction.triangles.find((triangle) => triangle.id === construction.selectedTriangleId)!;
    for (const input of deps.controls.querySelectorAll<HTMLInputElement>('[data-strategy3-pose]')) {
      const key = input.dataset.strategy3Pose;
      const value = key === 'angle' ? selected.angle * 180 / Math.PI : key === 'x' ? selected.center.x : selected.center.y;
      if (input !== document.activeElement) input.value = numberText(value);
    }
    let derived = '';
    if (construction.source === 'triangles') {
      if (sample.parameters === null) derived = '<p class="free-small-status">Derived parameters: undefined for this arrangement.</p>';
      else if (active === 'bc') {
        const parameters = sample.parameters as BCParameters;
        derived = `<p class="free-small-status">Derived gap=[${numberText(parameters.left)}, ${numberText(parameters.right)}]; d₂,d₃,d₄=(${parameters.radial.map(numberText).join(', ')})</p>`;
      } else {
        const parameters = sample.parameters as DParameters;
        derived = `<p class="free-small-status">Derived a=${numberText(parameters.a)}, ε=${numberText(parameters.epsilon)}, β=${numberText(parameters.beta)}</p>`;
      }
    }
    deps.controls.querySelector<HTMLElement>('[data-strategy3-readouts]')!.innerHTML = `
      <div class="ab-union-readout"><span>Enclosing side</span><strong>${numberText(sample.side)}</strong>
        <span>Enabled points</span><strong>${sample.enabledPointCount}</strong>
        <span>Geometric conditions</span><strong data-strategy3-geometry-status>${sample.geometryApplicable ? 'PASS' : 'FAIL'}</strong>
        <span>Original-triangle conditions</span><strong data-strategy3-source-status>${sample.sourceApplicable === null ? 'Not checked' : sample.sourceApplicable ? 'PASS' : 'FAIL'}</strong>
        <span>${active === 'd' ? 'D geometric theorem' : 'BC witness theorem'}</span><strong data-strategy3-theorem-status>${sample.theoremApplicable ? 'Applicable to the full witness set' : 'Not asserted for this selection'}</strong>
        <span>Status</span><strong>${escapeHtml(sample.status)}</strong></div>
      <p class="free-small-status">${escapeHtml(sample.domainStatus)}</p>${derived}`;
    deps.controls.querySelector<HTMLElement>('[data-strategy3-points]')!.innerHTML = sample.points.map((point) => `
      <label><input type="checkbox" data-strategy3-point="${point.id}"${point.enabled ? ' checked' : ''}/>${escapeHtml(point.label)}${point.point === null ? ' (undefined)' : ''}</label>`).join('');
    deps.controls.querySelector<HTMLElement>('[data-strategy3-conditions]')!.innerHTML = (['geometry', 'source'] as const).map((group) => {
      const conditions = sample.conditions.filter((condition) => (condition.group ?? 'geometry') === group);
      if (conditions.length === 0) return '';
      return `<div class="ab-union-section-title">${group === 'geometry' ? 'Geometric construction' : 'Original-triangle hypotheses'}</div>
        ${conditions.map((condition) => `<div class="free-small-status ${condition.ok ? 'ab-union-ok' : 'ab-union-bad'}">${condition.ok ? 'PASS' : 'FAIL'}: ${escapeHtml(condition.label)}</div>`).join('')}`;
    }).join('');
    deps.controls.querySelector<HTMLElement>('[data-strategy3-reaches]')!.innerHTML = sample.reaches
      ? `<div class="ab-union-section-title">Measured triangle reaches</div><table class="ab-union-table"><thead><tr><th>V</th><th>a</th><th>b</th><th>c</th><th>γ</th><th>radial</th></tr></thead><tbody>${sample.reaches.map((reach) => `<tr><td>V${reach.index}</td><td>${numberText(reach.a)}</td><td>${numberText(reach.b)}</td><td>${numberText(reach.c)}</td><td>${numberText(reach.gamma)}</td><td>${numberText(reach.radial)}</td></tr>`).join('')}</tbody></table>`
      : '';
  }

  function renderFrame(): void {
    const active = mode();
    if (!active) return;
    const sample = evaluation(active);
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    if (state[active].source === 'triangles') {
      for (const triangle of state[active].triangles) {
        const vertices = triangleVertices(triangle.center, triangle.angle).map(mathToCanvas);
        deps.ctx.beginPath();
        vertices.forEach((point, index) => index === 0 ? deps.ctx.moveTo(point.x, point.y) : deps.ctx.lineTo(point.x, point.y));
        deps.ctx.closePath();
        deps.ctx.strokeStyle = colorForTriangle(triangle.id);
        deps.ctx.lineWidth = triangle.id === state[active].selectedTriangleId ? 3 : 1;
        deps.ctx.stroke();
        const center = mathToCanvas(triangle.center);
        deps.ctx.fillStyle = colorForTriangle(triangle.id);
        deps.ctx.fillText(triangle.id, center.x + 5, center.y - 5);
      }
    }
    deps.ctx.save();
    deps.ctx.strokeStyle = '#64748b';
    deps.ctx.lineWidth = 1;
    deps.ctx.setLineDash([4, 4]);
    for (const segment of sample.segments) {
      const start = mathToCanvas(segment.start);
      const end = mathToCanvas(segment.end);
      deps.ctx.beginPath();
      deps.ctx.moveTo(start.x, start.y);
      deps.ctx.lineTo(end.x, end.y);
      deps.ctx.stroke();
    }
    deps.ctx.restore();
    drawWitnessConstruction(deps.ctx, sample);
    renderControls(active, sample);
  }

  deps.controls.addEventListener('click', (event) => {
    const active = mode();
    const target = event.target;
    if (!active || !(target instanceof HTMLElement)) return;
    const source = target.closest<HTMLButtonElement>('[data-strategy3-source]')?.dataset.strategy3Source;
    if (source !== 'parameters' && source !== 'triangles') return;
    state[active].source = source;
    stopHandleDrag();
    setEnabled(enabled);
    deps.render();
  });

  function applyInput(target: HTMLInputElement): void {
    const active = mode();
    if (!active) return;
    const value = Number(target.value);
    if (target.value.trim() === '' || !Number.isFinite(value)) return;
    if (target.dataset.strategy3Parameter) {
      if (setParameter(active, target.dataset.strategy3Parameter, value)) {
        target.value = Math.max(0, Math.min(1, value)).toString();
        deps.render();
      }
    } else if (target.dataset.strategy3Pose) {
      const triangle = adapters[active].triangles.find((triangle) => triangle.id === state[active].selectedTriangleId)!;
      const key = target.dataset.strategy3Pose;
      if (key === 'angle') triangle.angle = value / 180 * Math.PI;
      else if (key === 'x' || key === 'y') triangle.center[key] = value;
      else return;
      projectTriangleToConstraints(adapters[active], triangle);
      target.value = numberText(key === 'angle' ? triangle.angle * 180 / Math.PI : triangle.center[key]);
      saveTriangleChanges();
      deps.render();
    }
  }

  deps.controls.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range') applyInput(event.target);
  });
  deps.controls.addEventListener('change', (event) => {
    const active = mode();
    const target = event.target;
    if (!active) return;
    if (target instanceof HTMLSelectElement && target.dataset.strategy3Triangle !== undefined) {
      if (!STRATEGY3_TRIANGLE_IDS.includes(target.value as VTriangleId)) return;
      adapters[active].selectedTriangleId = target.value as VTriangleId;
      saveTriangleChanges();
      deps.render();
    } else if (target instanceof HTMLInputElement && target.dataset.strategy3Point) {
      const disabled = new Set(state[active].disabledPointIds);
      if (target.checked) disabled.delete(target.dataset.strategy3Point);
      else disabled.add(target.dataset.strategy3Point);
      state[active].disabledPointIds = [...disabled];
      deps.render();
    } else if (target instanceof HTMLInputElement) applyInput(target);
  });
  deps.controls.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      applyInput(event.target);
      event.preventDefault();
    }
  });

  function handles(active: Mode): Handle[] {
    const origin = { x: 0, y: 0 };
    if (active === 'bc') return [
      { id: 'G0', key: 'left', start: HEXAGON_VERTICES[0], end: HEXAGON_VERTICES[1] },
      { id: 'G1', key: 'right', start: HEXAGON_VERTICES[0], end: HEXAGON_VERTICES[1] },
      ...[2, 3, 4].map((index) => ({ id: `D${index}`, key: `radial${index - 2}` as ParameterKey, start: origin, end: HEXAGON_VERTICES[index] })),
    ];
    return [
      { id: 'G0', key: 'a', start: HEXAGON_VERTICES[0], end: HEXAGON_VERTICES[5] },
      { id: 'G1', key: 'beta', start: HEXAGON_VERTICES[0], end: HEXAGON_VERTICES[5], reverse: true },
      { id: 'PT', key: 'epsilon', start: origin, end: HEXAGON_VERTICES[1] },
    ];
  }

  function pointer(event: PointerEvent): Point {
    const rect = deps.canvas.getBoundingClientRect();
    return canvasToMath({ x: (event.clientX - rect.left) * config.canvasSize / rect.width,
      y: (event.clientY - rect.top) * config.canvasSize / rect.height });
  }

  function hitHandle(active: Mode, point: Point): Handle | null {
    const sample = evaluation(active);
    let best: Handle | null = null;
    let distance = scaleToMath(10);
    for (const handle of handles(active)) {
      const candidate = sample.points.find((point) => point.id === handle.id)?.point;
      if (!candidate) continue;
      const current = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (current <= distance) { best = handle; distance = current; }
    }
    return best;
  }

  deps.canvas.addEventListener('pointerdown', (event) => {
    const active = mode();
    if (!enabled || !active || state[active].source !== 'parameters' || !event.isPrimary) return;
    const handle = hitHandle(active, pointer(event));
    if (!handle) return;
    dragging = { mode: active, handle, pointerId: event.pointerId };
    deps.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  deps.canvas.addEventListener('pointermove', (event) => {
    const active = mode();
    if (!enabled || !active || state[active].source !== 'parameters') return;
    const point = pointer(event);
    if (!dragging) {
      deps.canvas.style.cursor = hitHandle(active, point) ? 'grab' : 'default';
      return;
    }
    if (dragging.pointerId !== event.pointerId) return;
    const { handle } = dragging;
    const dx = handle.end.x - handle.start.x;
    const dy = handle.end.y - handle.start.y;
    const value = ((point.x - handle.start.x) * dx + (point.y - handle.start.y) * dy) / (dx * dx + dy * dy);
    setParameter(active, handle.key, handle.reverse ? 1 - value : value);
    deps.canvas.style.cursor = 'grabbing';
    deps.render();
    event.preventDefault();
  });
  for (const eventName of ['pointerup', 'pointercancel'] as const) {
    deps.canvas.addEventListener(eventName, (event) => {
      if (dragging?.pointerId === event.pointerId) stopHandleDrag();
    });
  }

  return {
    renderFrame,
    setEnabled,
    getState(): Strategy3State { return structuredClone(state); },
    restoreState(next: Strategy3State): void {
      const restored = sanitizeStrategy3State(next);
      interaction.setEnabled(false);
      state = restored;
      adapters = { bc: createAdapter(state.bc), d: createAdapter(state.d) };
      panelKey = '';
      stopHandleDrag();
      setEnabled(enabled);
    },
  };
}
