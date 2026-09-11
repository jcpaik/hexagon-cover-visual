import { escapeHtml } from '../../app/format';
import { type CUnionModel } from '../../cUnion';
import {
  allowedMidpointIndices,
  describeTarget,
  getFreeVd0RawSourceOptions,
  getFreeVd0Status,
  getFreeVd0SuspensionReason,
  getTriangle,
  isFreeLabelSuspended,
  namedPointLabel,
} from '../../freeGeometry';
import type {
  FreeNamedPointRef,
  FreeState,
  FreeTarget,
  FreeTool,
  FreeTriangleId,
  FreeValidationResult,
  FreeVd0Coordinate,
} from '../../freeTypes';
import { formatFreeSnapshot } from './snapshot';

interface Dependencies {
  readonly freeState: FreeState;
  readonly cUnionModel: CUnionModel | null;
  readonly pointSeedStatusText: () => string;
  readonly freeStatus: HTMLDivElement;
  readonly cUnionBuildState: 'idle' | 'building' | 'ready' | 'error';
  readonly cUnionBuildError: string;
  readonly cUnionBuildProgress: number;
  readonly summarizeFreeValidation: (validation: FreeValidationResult) => string;
  readonly freeControls: HTMLDivElement;
  readonly renderSamplingPanel: () => string;
  readonly freeStateJson: HTMLTextAreaElement;
}

export function createFreePanel(deps: Dependencies) {
  function namedPointOptions(selected: FreeNamedPointRef | null): string {
    const refs: FreeNamedPointRef[] = [
      { kind: 'O' },
      ...[0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'M', index }) as FreeNamedPointRef),
      ...deps.freeState.targetTPoints.flatMap((target) =>
        [0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'P', index, targetTId: target.id }) as FreeNamedPointRef),
      ),
      ...[0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'B', index }) as FreeNamedPointRef),
      ...[0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'V', index }) as FreeNamedPointRef),
      ...deps.freeState.labels.map((label) => ({ kind: 'label', labelId: label.id }) as FreeNamedPointRef),
    ];
    const options = refs.map((ref) => {
      const value = encodeNamedPointRef(ref);
      return `<option value="${value}"${sameNamedPointRef(ref, selected) ? ' selected' : ''}>${namedPointLabel(ref)}</option>`;
    }).join('');
    const manual = selected?.kind === 'manual' ? selected : { kind: 'manual', manualPoint: { x: 0, y: 0 } } as FreeNamedPointRef;
    return `${options}<option value="${encodeNamedPointRef(manual)}"${selected?.kind === 'manual' ? ' selected' : ''}>manual</option>`;
  }

  function vd0RawSourceOptions(triangleId: FreeTriangleId, coordinate: FreeVd0Coordinate): string {
    const triangle = getTriangle(deps.freeState, triangleId);
    const selected = triangle.vd0.rawSources?.[coordinate] ?? null;
    const options = getFreeVd0RawSourceOptions(deps.freeState, triangle, coordinate, deps.cUnionModel);
    const selectedIsValid = options.some((option) => sameNamedPointRef(option.ref, selected));
    const autoSelected = selected === null || selected === undefined;
    const optionHtml = options.map((option) => {
      const value = encodeNamedPointRef(option.ref);
      const selectedAttr = sameNamedPointRef(option.ref, selected) ? ' selected' : '';
      return `<option value="${value}"${selectedAttr}>${option.label} (${option.value.toFixed(3)})</option>`;
    }).join('');
    const invalidHtml = selected && !selectedIsValid
      ? `<option value="${encodeNamedPointRef(selected)}" selected>${namedPointLabel(selected)} (invalid)</option>`
      : '';
    return `<option value=""${autoSelected ? ' selected' : ''}>auto</option>${optionHtml}${invalidHtml}`;
  }

  function formatVd0RawStatus(status: NonNullable<ReturnType<typeof getFreeVd0Status>>, maxLabel: string): string {
    const raw = (coordinate: FreeVd0Coordinate): string => {
      const source = status.rawSourceLabels[coordinate];
      return `${coordinate}=${status.raw[coordinate].toFixed(3)}${source ? `(${source})` : ''}`;
    };
    return `raw ${raw('a')}, ${raw('b')}, ${raw('c')}; ${maxLabel}=${status.max.toFixed(3)}`;
  }

  function sameNamedPointRef(a: FreeNamedPointRef, b: FreeNamedPointRef | null): boolean {
    return !!b && a.kind === b.kind && a.index === b.index && a.targetTId === b.targetTId && a.labelId === b.labelId;
  }

  function encodeNamedPointRef(ref: FreeNamedPointRef): string {
    if (ref.kind === 'O') return 'O';
    if (ref.kind === 'M') return `M:${ref.index ?? 0}`;
    if (ref.kind === 'P') return `PT:${ref.targetTId ?? deps.freeState.targetTPoints[0]?.id ?? 't1'}:${ref.index ?? 0}`;
    if (ref.kind === 'B') return `B:${ref.index ?? 0}`;
    if (ref.kind === 'V') return `V:${ref.index ?? 0}`;
    if (ref.kind === 'label') return `L:${ref.labelId ?? ''}`;
    const point = ref.manualPoint ?? { x: 0, y: 0 };
    return `P:${point.x},${point.y}`;
  }

  function renderFreePanel(validation: FreeValidationResult, cUnionReady: boolean): void {
    const cFormControls = (['triangle', 'c-union'] as const).map((form) =>
      `<button type="button" class="free-button${deps.freeState.cForm === form ? ' is-active' : ''}" data-free-c-form="${form}">${form === 'c-union' ? 'Cunion' : 'triangle'}</button>`,
    ).join('');
    const cUnionFilterControls = deps.freeState.cForm === 'c-union'
      ? (['ce1', 'ce2', 'both'] as const).map((filter) =>
        `<button type="button" class="free-button${deps.freeState.cUnionCeFilter === filter ? ' is-active' : ''}" data-c-union-filter="${filter}">${filter.toUpperCase()}</button>`,
      ).join('')
      : '';
    const targetButtons = (['S_HALF', 'S_T', 'S', 'BENZENE', 'LOTUS'] as FreeTarget[]).map((target) =>
      `<button type="button" class="free-button${deps.freeState.target === target ? ' is-active' : ''}" data-free-target="${target}">${describeTarget(target)}</button>`,
    ).join('');
    const targetTControls = deps.freeState.target === 'S_T'
      ? `
      <button type="button" class="free-button" data-add-target-t>add t</button>
      ${deps.freeState.targetTPoints.map((target) => `
        <span class="free-target-t-row">
          <strong>${escapeHtml(target.id)}</strong>
          <input class="free-target-t-input" type="number" min="0" max="1" step="0.001" value="${target.t.toFixed(3)}" data-target-t-value="${escapeHtml(target.id)}"/>
          <label><input type="checkbox" data-target-t-fixed="${escapeHtml(target.id)}"${target.fixed ? ' checked' : ''}/>lock</label>
          <button type="button" class="free-button" data-delete-target-t="${escapeHtml(target.id)}"${deps.freeState.targetTPoints.length <= 1 ? ' disabled' : ''}>delete</button>
        </span>
      `).join('')}`
      : '';
    const freeTools: FreeTool[] = deps.freeState.cForm === 'c-union'
      ? ['move', 'd-mark', 's-mark', 'point']
      : ['move', 'd-mark', 's-mark', 'sample', 'point'];
    const toolButtons = freeTools.map((tool) =>
      `<button type="button" class="free-button${deps.freeState.tool === tool ? ' is-active' : ''}" data-free-tool="${tool}">${tool}</button>`,
    ).join('');
    const pointControls = `
    <div class="free-toolbar">
      points
      <button type="button" class="free-button" data-delete-point-seed${deps.freeState.selectedPointSeedId ? '' : ' disabled'}>delete selected</button>
      <button type="button" class="free-button" data-clear-point-seeds${deps.freeState.pointSeeds.length > 0 ? '' : ' disabled'}>clear</button>
      <span class="free-small-status">${escapeHtml(deps.pointSeedStatusText())}</span>
    </div>`;
    const statuses = new Map(validation.constraintStatuses.map((status) => [status.triangleId, status]));

    const triangleRows = deps.freeState.triangles.filter((triangle) =>
      deps.freeState.cForm === 'triangle' || triangle.id !== 'C',
    ).map((triangle) => {
      const status = statuses.get(triangle.id);
      const midpoints = allowedMidpointIndices(triangle.id).map((index) =>
        `<label><input type="checkbox" data-midpoint="${triangle.id}:${index}"${triangle.midpointConstraints[index] ? ' checked' : ''}/>M${index}</label>`,
      ).join('');
      const vd0Unavailable = deps.freeState.cForm === 'c-union' && !cUnionReady;
      const vd0Status = vd0Unavailable ? null : getFreeVd0Status(deps.freeState, triangle, deps.cUnionModel);
      const vd0SuspensionReason = vd0Unavailable && triangle.vd0.enabled
        ? 'Vd0 unavailable until Cunion is ready.'
        : getFreeVd0SuspensionReason(deps.freeState, triangle, deps.cUnionModel);
      const vd0MaxLabel = triangle.vd0.mode === 'max-c' ? 'max c' : triangle.vd0.mode === 'max-a' ? 'max a' : 'max b';
      const vd0RawControls = (['a', 'b', 'c'] as FreeVd0Coordinate[]).map((coordinate) => `
      <label>${coordinate}
        <select data-vd0-raw-source="${triangle.id}:${coordinate}"${triangle.vd0.enabled && !vd0Unavailable ? '' : ' disabled'}>
          ${vd0RawSourceOptions(triangle.id, coordinate)}
        </select>
      </label>
    `).join('');
      const vd0Controls = triangle.id === 'C' || deps.freeState.target === 'LOTUS' ? '' : `
      <label><input type="checkbox" data-vd0-enabled="${triangle.id}"${triangle.vd0.enabled ? ' checked' : ''}${vd0Unavailable ? ' disabled' : ''}/>Vd0</label>
      <label>Vd0 mode
        <select data-vd0-mode="${triangle.id}"${triangle.vd0.enabled && !vd0Unavailable ? '' : ' disabled'}>
          <option value="max-c"${triangle.vd0.mode === 'max-c' ? ' selected' : ''}>max c from a,b</option>
          <option value="max-a"${triangle.vd0.mode === 'max-a' ? ' selected' : ''}>max a from b,c</option>
          <option value="max-b"${triangle.vd0.mode === 'max-b' ? ' selected' : ''}>max b from c,a</option>
        </select>
      </label>
      ${vd0RawControls}
      ${vd0SuspensionReason
          ? `<span class="free-small-status">${escapeHtml(vd0SuspensionReason)}</span>`
          : vd0Status ? `<span class="free-small-status">${formatVd0RawStatus(vd0Status, vd0MaxLabel)}</span>` : ''}`;
      const edge = triangle.edgePointConstraint;
      const manualPoint = edge?.point.kind === 'manual' ? edge.point.manualPoint : null;
      const edgeControls = `
      <label>edge
        <select data-edge-index="${triangle.id}">
          <option value="">none</option>
          ${[0, 1, 2].map((index) => `<option value="${index}"${edge?.edgeIndex === index ? ' selected' : ''}>${index}</option>`).join('')}
        </select>
      </label>
      <label>point
        <select data-edge-point="${triangle.id}">
          ${namedPointOptions(edge?.point ?? null)}
        </select>
      </label>
      ${manualPoint ? `
        <label>x <input class="free-manual-input" type="number" step="0.001" value="${manualPoint.x}" data-manual-x="${triangle.id}"/></label>
        <label>y <input class="free-manual-input" type="number" step="0.001" value="${manualPoint.y}" data-manual-y="${triangle.id}"/></label>
      ` : ''}`;
      return `
      <div class="free-triangle-row${triangle.id === deps.freeState.selectedTriangleId ? ' is-selected' : ''}${status?.ok === false ? ' is-bad' : ''}">
        <button type="button" class="free-button free-name" data-select-triangle="${triangle.id}">${triangle.id}</button>
        <label><input type="checkbox" data-fixed="${triangle.id}"${triangle.fixed ? ' checked' : ''}/>fixed</label>
        <label><input type="checkbox" data-hidden="${triangle.id}"${triangle.hidden ? ' checked' : ''}${deps.freeState.tool === 'sample' && triangle.id !== 'C' && triangle.id !== 'V0' ? ' disabled' : ''}/>hidden</label>
        ${midpoints}
        ${vd0Controls}
        ${edgeControls}
        <span class="free-small-status">${status?.ok ? 'ok' : status?.messages.join(', ')}</span>
      </div>`;
    }).join('');

    const labelRows = deps.freeState.labels.map((label) =>
      `<div class="free-label-row">${label.name}: ${isFreeLabelSuspended(deps.freeState, label, deps.cUnionModel) ? 'suspended' : label.point ? `(${label.point.x.toFixed(3)}, ${label.point.y.toFixed(3)})` : 'invalid'} <button type="button" class="free-button" data-delete-label="${label.id}">delete</button></div>`,
    ).join('');

    const cUnionPending = deps.freeState.cForm === 'c-union' && !cUnionReady;
    deps.freeStatus.textContent = cUnionPending
      ? deps.cUnionBuildState === 'error' ? `Cunion error: ${deps.cUnionBuildError}` : `Building Cunion ${Math.round(deps.cUnionBuildProgress * 100)}%`
      : deps.summarizeFreeValidation(validation);
    deps.freeStatus.style.color = cUnionPending
      ? deps.cUnionBuildState === 'error' ? '#b91c1c' : '#475569'
      : validation.coverageOk && validation.constraintsOk ? '#047857' : '#b91c1c';
    deps.freeControls.innerHTML = `
    <div class="free-toolbar">C form ${cFormControls}${deps.freeState.cForm === 'c-union' ? ` CE filter ${cUnionFilterControls}` : ''}</div>
    <div class="free-toolbar">target ${targetButtons}${targetTControls}</div>
    <div class="free-toolbar">tool ${toolButtons}</div>
    ${pointControls}
    ${deps.freeState.cForm === 'triangle' ? deps.renderSamplingPanel() : ''}
    <div class="free-row"><span class="status-reserve">${deps.freeState.status}</span></div>
    ${triangleRows}
    <div class="free-row"><strong>labels</strong></div>
    ${labelRows || '<div class="free-small-status">No labels. Use d-mark or s-mark and click two intersecting segments.</div>'}
  `;
    deps.freeStateJson.value = formatFreeSnapshot(deps.freeState);
  }

  return {
    renderFreePanel
  };
}

