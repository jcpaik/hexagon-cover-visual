import { setupAbUnionInteraction } from '../../ab-union/interaction';
import { AB_UNION_REGION_COLORS, renderAbUnionBoundaryControls, renderAbUnionRegions } from '../../ab-union/render';
import { createDefaultAbUnionState } from '../../ab-union/state';
import type { AbUnionDotHandle, AbUnionState } from '../../ab-union/types';
import { escapeHtml } from '../../app/format';
import { config, mathToCanvas } from '../../coords';
import { drawHexagon, drawHexagonLines, HEXAGON_VERTICES } from '../../hexagon';
import { evaluateStrategy3Boundary, type BoundaryEvaluation, type BoundaryRole } from '../../strategy3/boundary';
import { drawWitnessConstruction } from '../../strategy3/render';
import {
  createDefaultStrategy3State, sanitizeStrategy3State, strategy3EdgeDots,
  type Strategy3Mode, type Strategy3State,
} from '../../strategy3/state';
import type { ShapeMode, TriangleState } from '../../types';

interface Dependencies {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly controls: HTMLDivElement;
  readonly render: () => void;
  readonly shapeMode: ShapeMode;
}

function numberText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : 'undefined';
}

function restrictionText(role: BoundaryRole): string {
  const exactA = role.restriction === 'in' || role.restriction === 'both';
  const exactB = role.restriction === 'out' || role.restriction === 'both';
  return `A ${exactA ? '=' : '≥'} a; B ${exactB ? '=' : '≥'} b`;
}

export function createStrategy3Controller(deps: Dependencies) {
  let state = createDefaultStrategy3State();
  let enabled = false;
  let enabledMode: Strategy3Mode | null = null;
  let panelKey = '';
  let quality: 'preview' | 'full' = 'full';
  let frame: number | null = null;
  let pointerId: number | null = null;
  const evaluations: Partial<Record<Strategy3Mode, { key: string; sample: BoundaryEvaluation }>> = {};
  const adapters = { bc: createDefaultAbUnionState(), d: createDefaultAbUnionState(), f: createDefaultAbUnionState() };
  for (const adapter of Object.values(adapters)) adapter.autoOptimizeTheta = false;
  const unusedTriangle: TriangleState = { position: { x: 0, y: 0 }, angle: 0, controlPoint: { x: 0, y: 0 } };

  function mode(): Strategy3Mode | null {
    return deps.shapeMode === 'strategy3-bc' ? 'bc'
      : deps.shapeMode === 'strategy3-d' ? 'd'
        : deps.shapeMode === 'strategy3-f' ? 'f' : null;
  }

  function adapterFor(active: Strategy3Mode): AbUnionState {
    const adapter = adapters[active];
    adapter.edgeDots = strategy3EdgeDots(state, active);
    adapter.regionVisible = state[active].regionVisible;
    return adapter;
  }

  function requestRender(): void {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (enabled && mode()) deps.render();
    });
  }

  function moveDot(adapter: AbUnionState, dot: AbUnionDotHandle, value: number): void {
    const active = mode();
    if (!active) return;
    const edge = adapter.edgeDots[dot.edge];
    const bounded = Math.max(0, Math.min(1, value));
    if (dot.role === 'shared') edge.left = edge.right = bounded;
    else edge[dot.role] = dot.role === 'left' ? Math.min(bounded, edge.right) : Math.max(bounded, edge.left);
    if (active === 'f') state.f.edgeDots = adapter.edgeDots;
    else state[active].layouts[state[active].layout] = adapter.edgeDots;
  }

  // Commit a focused numeric field before the shared pointer handler reads
  // the dots. Otherwise its later blur can overwrite a completed canvas drag.
  deps.canvas.addEventListener('pointerdown', () => {
    if (enabled && document.activeElement instanceof HTMLInputElement && deps.controls.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }, true);

  setupAbUnionInteraction(
    deps.canvas, () => enabled && mode() !== null, () => adapterFor(mode() ?? 'bc'),
    unusedTriangle, () => [], () => {}, requestRender,
    {
      moveDotValue: moveDot,
      onPreviewChange: () => { quality = 'preview'; },
      onCommitChange: () => { quality = 'full'; },
    },
  );

  function finishDrag(): void {
    quality = 'full';
    if (pointerId !== null && deps.canvas.hasPointerCapture(pointerId)) deps.canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }

  deps.canvas.addEventListener('pointerdown', (event) => {
    if (enabled && event.isPrimary) pointerId = event.pointerId;
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    deps.canvas.addEventListener(eventName, () => {
      const wasPreview = quality === 'preview';
      quality = 'full';
      pointerId = null;
      if (wasPreview) requestRender();
    });
  }

  function setEnabled(next: boolean): void {
    if (!next || enabledMode !== mode()) finishDrag();
    enabled = next;
    enabledMode = next ? mode() : null;
  }

  function renderControls(active: Strategy3Mode, sample: BoundaryEvaluation, regions: Array<{ count: number; status: string }>): void {
    const edges = strategy3EdgeDots(state, active);
    const count = edges.reduce((total, edge) => total + (edge.split ? 2 : 1), 0);
    const key = `${active}:${count}`;
    if (panelKey !== key) {
      panelKey = key;
      deps.controls.innerHTML = `
        ${active === 'f' ? '' : `<div class="free-toolbar">Boundary layout
          ${(['seven', 'eight'] as const).map((layout) => `<button type="button" class="free-button" data-strategy3-layout="${layout}" aria-pressed="${state[active].layout === layout}">${layout === 'seven' ? '7 dots · one gap' : '8 dots · two gaps'}</button>`).join('')}
        </div>`}
        <p class="free-small-status">Drag the ${count} white boundary handles or edit their edge positions below. Witness coordinates update automatically. Click a vertex to highlight its region.</p>
        <p class="free-small-status">Shared dots specify lower demands. Gap endpoints fix the actual adjacent reaches. Invalid case configurations remain editable.</p>
        ${active === 'f' ? `<p class="free-small-status">The reaches at V4 determine the nine points. The other handles change the regions and Case F checks.</p>
          <fieldset class="free-toolbar"><legend>F witness construction</legend>
            <label><input type="radio" name="strategy3-construction" data-strategy3-construction value="newton"/>Newton inner A, B, C</label>
            <label><input type="radio" name="strategy3-construction" data-strategy3-construction value="frontier"/>Exact frontier Q−, Q0, Q+</label>
          </fieldset>` : ''}
        <div class="ab-union-toolbar" aria-label="AB region visibility"><span>Visible AB sets</span>
          ${AB_UNION_REGION_COLORS.map((color, index) => `<label style="color:${color}"><input type="checkbox" data-ab-region-visible="${index}" aria-label="Show AB set at V${index}"/>V${index}</label>`).join('')}
        </div>
        <div class="ab-union-section-title">Boundary positions · t from Vi to Vi+1</div>
        ${edges.map((edge, index) => `<div class="ab-union-toolbar"><span>e${index}</span>
          ${(edge.split ? ['left', 'right'] as const : ['shared'] as const).map((role) => `<label>${role === 'shared' ? `b${index}/a${(index + 1) % 6}` : role === 'left' ? `b${index}` : `a${(index + 1) % 6}`}
            <input class="ab-hull-debug-number" type="number" min="0" max="1" step="0.001" data-strategy3-edge="${index}" data-strategy3-role="${role}" aria-label="Edge ${index} ${role} position"/>
          </label>`).join('')}</div>`).join('')}
        ${active === 'f' ? '<label class="free-small-status"><input type="checkbox" data-strategy3-disk/> Show comparison disk</label>' : ''}
        <div data-strategy3-readouts></div>
        <div class="ab-union-section-title">Derived witness points</div>
        <div class="free-toolbar" data-strategy3-points></div>
        <div data-strategy3-conditions></div>
        <div class="ab-union-section-title">Restricted AB regions and radial bounds</div>
        <p class="free-small-status">Shading samples the restricted source families. Analytic capacity bounds place the witnesses. Source samples do not certify a covering configuration.</p>
        <div data-strategy3-reaches></div>`;
    }
    for (const input of deps.controls.querySelectorAll<HTMLInputElement>('[data-strategy3-edge]')) {
      const edge = edges[Number(input.dataset.strategy3Edge)];
      if (input !== document.activeElement) input.value = numberText(input.dataset.strategy3Role === 'right' ? edge.right : edge.left);
    }
    const disk = deps.controls.querySelector<HTMLInputElement>('[data-strategy3-disk]');
    if (disk) disk.checked = state.f.showDisk;
    for (const input of deps.controls.querySelectorAll<HTMLInputElement>('[data-strategy3-construction]')) {
      input.checked = input.value === state.f.pointConstruction;
    }
    for (const input of deps.controls.querySelectorAll<HTMLInputElement>('[data-ab-region-visible]')) {
      input.checked = state[active].regionVisible[Number(input.dataset.abRegionVisible)];
    }
    const witness = sample.witness;
    const geometryOk = 'geometryApplicable' in witness ? witness.geometryApplicable : witness.domainOk;
    const caseOk = sample.conditions.filter((condition) => condition.group === 'source').every((condition) => condition.ok);
    deps.controls.querySelector<HTMLElement>('[data-strategy3-readouts]')!.innerHTML = `
      ${active === 'f' ? `<p class="free-small-status" data-strategy3-construction-note>${state.f.pointConstruction === 'newton'
        ? 'Six radial points + A, B = Q0, C. One Newton step: A ∈ (Q0,Q−), C ∈ (Q0,Q+); these are not the circle intersections.'
        : 'Six radial points + exact frontier Q−, Q0, Q+. Q− and Q+ are the selected first circle intersections.'}</p>
        <p class="free-small-status">The fit uses only enabled points. The disk is a comparison overlay, not a separate fitting constraint.</p>` : ''}
      <div class="ab-union-readout"><span>${witness.points.every((point) => point.enabled) ? 'Enclosing side' : 'Subset enclosing side'}</span><strong data-strategy3-side>${numberText(witness.side)}</strong>
        <span>Boundary handles</span><strong data-strategy3-handle-count>${count}</strong>
        <span>Enabled witnesses</span><strong>${witness.enabledPointCount}</strong>
        <span>Construction conditions</span><strong data-strategy3-geometry-status>${geometryOk ? 'PASS' : 'FAIL'}</strong>
        <span>Boundary case checks</span><strong data-strategy3-source-status>${caseOk ? 'PASS (input checks)' : 'FAIL'}</strong>
        ${active === 'd' && 'theoremApplicable' in witness ? `<span>D geometric theorem</span><strong data-strategy3-theorem-status>${witness.theoremApplicable ? 'Applicable to the full witness set' : 'Not asserted for this selection'}</strong>` : ''}
        <span>Status</span><strong>${escapeHtml(witness.status)}</strong></div>`;
    deps.controls.querySelector<HTMLElement>('[data-strategy3-points]')!.innerHTML = witness.points.map((point) => `
      <label title="${escapeHtml(point.label)}"><input type="checkbox" data-strategy3-point="${point.id}" aria-label="Show ${escapeHtml(point.symbol ?? point.id)}"${point.enabled ? ' checked' : ''}/>${escapeHtml(point.symbol ?? point.id)}: ${point.point ? `(${numberText(point.point.x)}, ${numberText(point.point.y)})` : 'undefined'}</label>`).join('');
    deps.controls.querySelector<HTMLElement>('[data-strategy3-conditions]')!.innerHTML = sample.conditions.map((condition) => `
      <div class="free-small-status ${condition.ok ? 'ab-union-ok' : 'ab-union-bad'}">${condition.ok ? 'PASS' : 'FAIL'}: ${escapeHtml(condition.label)}</div>`).join('');
    deps.controls.querySelector<HTMLElement>('[data-strategy3-reaches]')!.innerHTML = `
      <table class="ab-union-table"><thead><tr><th>V</th><th>a</th><th>b</th><th>Γ</th><th>1−Γ</th></tr></thead><tbody>
        ${sample.roles.map((role, index) => `<tr><td style="color:${AB_UNION_REGION_COLORS[index]}">V${index}</td><td>${role.a.toFixed(4)}</td><td>${role.b.toFixed(4)}</td><td>${sample.capacities[index].gamma?.toFixed(4) ?? '—'}</td><td>${sample.capacities[index].radial?.toFixed(4) ?? '—'}</td></tr>`).join('')}
      </tbody></table>
      ${sample.roles.map((role, index) => `<div class="free-small-status" data-strategy3-region="${index}" data-source-count="${regions[index].count}"><strong style="color:${AB_UNION_REGION_COLORS[index]}">V${index}: ${restrictionText(role)}</strong>; ${role.criticality === 'any' ? 'reach sum unrestricted' : role.criticality}${role.suppliesMidpoint ? '; supplies M1' : ''}. ${escapeHtml(regions[index].status)}</div>`).join('')}`;
  }

  function renderFrame(): void {
    const active = mode();
    if (!active) return;
    const adapter = adapterFor(active);
    const construction = active === 'f' ? state.f.pointConstruction : 'frontier';
    const key = JSON.stringify([adapter.edgeDots, state[active].disabledPointIds, construction]);
    if (evaluations[active]?.key !== key) {
      evaluations[active] = { key, sample: evaluateStrategy3Boundary(active, adapter.edgeDots, state[active].disabledPointIds, construction) };
    }
    const sample = evaluations[active]!.sample;
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    const { regions } = renderAbUnionRegions(deps.ctx, adapter, {
      sourceRegions: sample.roles, sourceQuality: quality, colorByRegion: true, showUncovered: false,
    });
    drawHexagonLines(deps.ctx);
    deps.ctx.save();
    deps.ctx.strokeStyle = '#dc2626';
    deps.ctx.lineWidth = 3;
    deps.ctx.setLineDash([4, 3]);
    adapter.edgeDots.forEach((edge, index) => {
      if (!edge.split) return;
      const start = HEXAGON_VERTICES[index], end = HEXAGON_VERTICES[(index + 1) % 6];
      const point = (t: number) => mathToCanvas({ x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) });
      const left = point(edge.left), right = point(edge.right);
      deps.ctx.beginPath();
      deps.ctx.moveTo(left.x, left.y);
      deps.ctx.lineTo(right.x, right.y);
      deps.ctx.stroke();
    });
    deps.ctx.restore();
    drawWitnessConstruction(deps.ctx, sample.witness, { showDisk: active === 'f' && state.f.showDisk });
    renderAbUnionBoundaryControls(deps.ctx, adapter, { showFMarkTriangle: false });
    renderControls(active, sample, regions);
  }

  function applyInput(input: HTMLInputElement): void {
    const active = mode();
    if (!active || input.dataset.strategy3Edge === undefined || input.value.trim() === '') return;
    const value = Number(input.value);
    const edge = Number(input.dataset.strategy3Edge);
    const role = input.dataset.strategy3Role;
    if (!Number.isFinite(value) || (role !== 'left' && role !== 'right' && role !== 'shared')) return;
    const adapter = adapterFor(active);
    moveDot(adapter, { edge, role }, value);
    input.value = numberText(role === 'right' ? adapter.edgeDots[edge].right : adapter.edgeDots[edge].left);
    quality = 'full';
    deps.render();
  }

  deps.controls.addEventListener('click', (event) => {
    const active = mode();
    if (!active || active === 'f' || !(event.target instanceof HTMLElement)) return;
    const layout = event.target.closest<HTMLButtonElement>('[data-strategy3-layout]')?.dataset.strategy3Layout;
    if (layout !== 'seven' && layout !== 'eight') return;
    finishDrag();
    state[active].layout = layout;
    adapters[active].activeRegions.fill(false);
    deps.render();
  });
  deps.controls.addEventListener('change', (event) => {
    const active = mode();
    const input = event.target;
    if (!active || !(input instanceof HTMLInputElement)) return;
    if (active === 'f' && input.dataset.strategy3Construction !== undefined) {
      if (input.value !== 'frontier' && input.value !== 'newton') return;
      state.f.pointConstruction = input.value;
      deps.render();
    } else if (input.dataset.abRegionVisible !== undefined) {
      state[active].regionVisible[Number(input.dataset.abRegionVisible)] = input.checked;
      deps.render();
    } else if (input.dataset.strategy3Point) {
      const disabled = new Set(state[active].disabledPointIds);
      if (input.checked) disabled.delete(input.dataset.strategy3Point);
      else disabled.add(input.dataset.strategy3Point);
      state[active].disabledPointIds = [...disabled];
      deps.render();
    } else if (input.dataset.strategy3Disk !== undefined) {
      state.f.showDisk = input.checked;
      deps.render();
    } else applyInput(input);
  });
  deps.controls.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      applyInput(event.target);
      event.preventDefault();
    }
  });

  return {
    renderFrame,
    setEnabled,
    getState(): Strategy3State { return structuredClone(state); },
    restoreState(next: Strategy3State): void {
      const restored = sanitizeStrategy3State(next);
      finishDrag();
      state = restored;
      panelKey = '';
      for (const adapter of Object.values(adapters)) adapter.activeRegions.fill(false);
    },
  };
}
