import { setupAbUnionInteraction } from '../../ab-union/interaction';
import { optimizeAbUnionTheta, renderAbUnion } from '../../ab-union/render';
import {
  abUnionAValues,
  abUnionBValues,
  abUnionCoincidenceTargets,
  clearAbUnionFMarks,
  createDefaultAbUnionState,
  deleteAbUnionLabel,
  deleteSelectedAbUnionFMark,
  requestAbUnionThetaOptimization,
  setAbUnionCoincidenceLock,
  setAbUnionLock,
  setAbUnionPreset,
  setAbUnionSumConstraint,
  setAbUnionTool,
  snapAbUnionLabelToEdge,
} from '../../ab-union/state';
import {
  type AbUnionCenterMode,
  type AbUnionPreset,
  type AbUnionQuality,
  type AbUnionRenderResult,
  type AbUnionTool,
} from '../../ab-union/types';
import {
  abUnionCenterLabel,
  clampToLocalCMax,
  escapeHtml,
  formatAbUnionDegrees,
  formatAbUnionValues,
  formatAreaNumber,
  isAbUnionCoincidenceRole,
  isAreaSumConstraintMode,
} from '../../app/format';
import { config } from '../../coords';
import { drawHexagon } from '../../hexagon';
import type { ShapeMode, TriangleState } from '../../types';

interface Dependencies {
  readonly areaConstraintDelta: number;
  readonly abUnionControls: HTMLDivElement;
  readonly areaDeltaControlHtml: () => string;
  manualLocalCs: number[];
  readonly ctx: CanvasRenderingContext2D;
  readonly triangleState: TriangleState;
  readonly gammaValues: HTMLDivElement;
  readonly localCBounds: HTMLDivElement;
  readonly localCValues: HTMLDivElement;
  readonly ceStatus: HTMLDivElement;
  readonly ceChainStatus: HTMLDivElement;
  readonly coverOverlayStatus: HTMLDivElement;
  readonly render: () => void;
  readonly canvas: HTMLCanvasElement;
  readonly shapeMode: ShapeMode;
}

export function createAbUnionController(deps: Dependencies) {
  let abUnionState = createDefaultAbUnionState();

  function abUnionOverlayLabel(): string {
    const overlays = [
      abUnionState.showOriginalRegion ? 'original' : null,
      abUnionState.useAxisAlignedHull ? 'hex-axis hull' : null,
    ].filter((label): label is string => label !== null);
    return overlays.join(' + ') || 'none';
  }

  function renderAbUnionPanel(result: AbUnionRenderResult): void {
    const thetaDeg = abUnionState.theta * 180 / Math.PI;
    const thetaManualDisabled = abUnionState.autoOptimizeTheta ? ' disabled' : '';
    const lastOptimized = abUnionState.lastOptimized
      ? `best L*=${abUnionState.lastOptimized.L.toFixed(5)} at ${formatAbUnionDegrees(abUnionState.lastOptimized.theta)}`
      : 'best L*: not optimized';
    const equalityWarning = result.minEqualityGap < 1e-3
      ? '<div class="ab-union-warning">close to equality; apparent L &lt; 1 may be a near-degenerate artifact</div>'
      : '';
    const centerContainsText = abUnionState.centerMode === 'none'
      ? 'n/a'
      : result.centerContains ? 'yes' : `no (${result.centerFailures})`;
    const centerContainsClass = abUnionState.centerMode === 'none'
      ? ''
      : result.centerContains ? 'ab-union-ok' : 'ab-union-bad';
    const farPairText = !abUnionState.showFarPair
      ? 'off'
      : result.farPair === null
        ? 'no red points'
        : result.farPair.exceedsUnit
          ? `found d=${result.farPair.distance.toFixed(5)}`
          : `best d=${result.farPair.distance.toFixed(5)} <= 1`;
    const farPairClass = result.farPair?.exceedsUnit ? 'ab-union-bad' : '';
    const fMarkText = result.fMarkCount === 0
      ? 'none'
      : result.fMarkDistance !== null
        ? `distance=${result.fMarkDistance.toFixed(5)}`
        : result.fMarkTriangleSide !== null
          ? `side=${result.fMarkTriangleSide.toFixed(5)}`
          : `${result.fMarkCount} dot${result.fMarkCount === 1 ? '' : 's'}`;
    const toolLabels: Record<AbUnionTool, string> = {
      move: 'Move',
      add: 'Add',
      delete: 'Delete',
      'd-mark': 'd-mark',
      's-mark': 's-mark',
      'f-mark': 'f mark',
    };
    const toolControls = (['move', 'add', 'delete', 'd-mark', 's-mark', 'f-mark'] as AbUnionTool[]).map((tool) => `
    <button type="button" class="free-button${abUnionState.tool === tool ? ' is-active' : ''}" data-ab-tool="${tool}">${toolLabels[tool]}</button>
  `).join('');
    const regionRowsHtml = result.regionRows.map((row) => {
      const currentTitle = row.sumConstraintMode === 'current' && row.fixedSum !== null
        ? `fix current a${row.index}+b${row.index} = ${row.fixedSum.toFixed(4)}`
        : `fix current a${row.index}+b${row.index}`;
      return `
      <tr class="${abUnionState.activeRegions[row.index] ? 'ab-union-active-row' : ''}${row.equality ? ' ab-union-equality-row' : ''}">
        <td>R${row.index}</td>
        <td><input type="checkbox" title="include a${row.index} in the same-a group" data-ab-lock-kind="a" data-ab-lock-index="${row.index}"${row.aLocked ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="include b${row.index} in the same-b group" data-ab-lock-kind="b" data-ab-lock-index="${row.index}"${row.bLocked ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="${currentTitle}" data-ab-sum-mode="current" data-ab-sum-index="${row.index}"${row.sumConstraintMode === 'current' ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="fix a${row.index}+b${row.index} = 1" data-ab-sum-mode="one" data-ab-sum-index="${row.index}"${row.sumConstraintMode === 'one' ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="fix a${row.index}+b${row.index} = ${formatAreaNumber(1 + deps.areaConstraintDelta)}" data-ab-sum-mode="one-plus-delta" data-ab-sum-index="${row.index}"${row.sumConstraintMode === 'one-plus-delta' ? ' checked' : ''}/></td>
        <td>${row.a.toFixed(4)}</td>
        <td>${row.b.toFixed(4)}</td>
        <td>${row.sum.toFixed(4)}</td>
        <td>${row.distance.toFixed(4)}</td>
        <td>${row.equality ? 'yes' : 'no'}</td>
        <td><span class="ab-union-pill ${row.state}">${row.state}</span></td>
      </tr>
    `;
    }).join('');
    const edgeRowsHtml = result.edgeRows.map((row) => `
    <tr>
      <td>e${row.index}</td>
      <td>${row.split ? 'two' : 'one'}</td>
      <td>${row.left.toFixed(4)}</td>
      <td>${row.right.toFixed(4)}</td>
    </tr>
  `).join('');
    const regionVisibilityControls = Array.from({ length: 6 }, (_, index) => `
    <label><input type="checkbox" data-ab-region-visible="${index}"${abUnionState.regionVisible[index] ? ' checked' : ''}/>R${index}</label>
  `).join('');
    const labelRows = abUnionState.labels.map((label) => {
      const targets = abUnionCoincidenceTargets(abUnionState, label.id).map((target) => `
      <button type="button" class="free-button" data-ab-snap-label="${escapeHtml(label.id)}" data-ab-snap-edge="${target.edge}" data-ab-snap-role="${target.role}"${label.point ? '' : ' disabled'}>snap ${escapeHtml(target.label)}</button>
      <label><input type="checkbox" data-ab-coincidence-label="${escapeHtml(label.id)}" data-ab-coincidence-edge="${target.edge}" data-ab-coincidence-role="${target.role}"${target.locked ? ' checked' : ''}${label.point ? '' : ' disabled'}/>lock ${escapeHtml(target.label)}</label>
    `).join('');
      return `<div class="free-label-row">${escapeHtml(label.name)}: ${label.point ? `(${label.point.x.toFixed(3)}, ${label.point.y.toFixed(3)})` : 'invalid'} ${targets}<button type="button" class="free-button" data-ab-delete-label="${escapeHtml(label.id)}">delete</button></div>`;
    }).join('');

    deps.abUnionControls.innerHTML = `
    <div class="ab-union-toolbar">
      <span>tool</span>
      ${toolControls}
    </div>
    <div class="ab-union-toolbar">
      <span>f marks</span>
      <button type="button" class="free-button" data-ab-fmark-delete${abUnionState.selectedFMarkId ? '' : ' disabled'}>delete selected</button>
      <button type="button" class="free-button" data-ab-fmark-clear${result.fMarkCount > 0 ? '' : ' disabled'}>clear</button>
      <span class="free-small-status">${escapeHtml(fMarkText)}</span>
    </div>
    <div class="ab-union-toolbar">
      <label><input type="checkbox" data-ab-show-original${abUnionState.showOriginalRegion ? ' checked' : ''}/>original AB union</label>
      <label><input type="checkbox" data-ab-axis-hull${abUnionState.useAxisAlignedHull ? ' checked' : ''}/>hex-axis hull</label>
      <label><input type="checkbox" data-ab-show-theta${abUnionState.showThetaTriangle ? ' checked' : ''}/>show purple triangle</label>
      <label><input type="checkbox" data-ab-auto-theta${abUnionState.autoOptimizeTheta ? ' checked' : ''}/>auto optimize theta</label>
      <label><input type="checkbox" data-ab-show-far-pair${abUnionState.showFarPair ? ' checked' : ''}/>show red pair &gt; 1</label>
      <label><input type="checkbox" data-ab-clip-sectors${abUnionState.clipToCornerSectors ? ' checked' : ''}/>clip to corner sectors</label>
      <label><input type="checkbox" data-ab-center-locked${abUnionState.centerLocked ? ' checked' : ''}/>lock center</label>
      <label>center
        <select data-ab-center-mode>
          <option value="none"${abUnionState.centerMode === 'none' ? ' selected' : ''}>none</option>
          <option value="triangle"${abUnionState.centerMode === 'triangle' ? ' selected' : ''}>triangle</option>
          <option value="circle"${abUnionState.centerMode === 'circle' ? ' selected' : ''}>circle</option>
          <option value="local-c"${abUnionState.centerMode === 'local-c' ? ' selected' : ''}>manual c_i hull</option>
        </select>
      </label>
      <label>quality
        <select data-ab-quality>
          <option value="coarse"${abUnionState.quality === 'coarse' ? ' selected' : ''}>coarse</option>
          <option value="high"${abUnionState.quality === 'high' ? ' selected' : ''}>high</option>
          <option value="adaptive"${abUnionState.quality === 'adaptive' ? ' selected' : ''}>adaptive</option>
        </select>
      </label>
    </div>
    <div class="ab-union-toolbar">
      <span>visible regions</span>
      ${regionVisibilityControls}
    </div>
    <div class="ab-union-toolbar">
      <button type="button" class="free-button" data-ab-preset="equality">equality</button>
      <button type="button" class="free-button" data-ab-preset="midpoint">midpoints</button>
      ${deps.areaDeltaControlHtml()}
    </div>
    <div class="ab-union-row">
      <label for="ab-union-theta">theta = <span>${thetaDeg.toFixed(1)} deg</span></label>
      <input id="ab-union-theta" type="range" min="0" max="120" step="0.5" value="${thetaDeg.toFixed(1)}" data-ab-theta${thetaManualDisabled}/>
    </div>
    <div class="ab-union-toolbar">
      <button type="button" class="free-button" data-ab-optimize${thetaManualDisabled}>optimize theta</button>
    </div>
    <div class="ab-union-readout">
      <span>L(theta)</span><strong>${result.currentL.toFixed(5)}</strong>
      <span>${escapeHtml(lastOptimized)}</span><strong>${abUnionState.lastOptimized && abUnionState.lastOptimized.L < 1 ? '&lt; 1' : ''}</strong>
      <span>uncovered pixels</span><strong>${result.uncoveredCount}</strong>
      <span>analysis points</span><strong>${result.analysisCount}</strong>
      <span>active boundaries</span><strong>${escapeHtml(result.activeLabel)}</strong>
      <span>center shape</span><strong>${escapeHtml(abUnionCenterLabel(abUnionState.centerMode))}</strong>
      <span>center contains U</span><strong class="${centerContainsClass}">${escapeHtml(centerContainsText)}</strong>
      <span>red pair search</span><strong class="${farPairClass}">${escapeHtml(farPairText)}</strong>
      <span>f marks</span><strong>${escapeHtml(fMarkText)}</strong>
      <span>region clip</span><strong>${abUnionState.clipToCornerSectors ? 'corner sectors' : 'off'}</strong>
      <span>compute model</span><strong>${abUnionState.useAxisAlignedHull ? 'hex-axis hull' : 'exact'}</strong>
      <span>visible overlays</span><strong>${escapeHtml(abUnionOverlayLabel())}</strong>
      <span>theta mode</span><strong>${abUnionState.autoOptimizeTheta ? 'auto' : 'manual'}</strong>
      <span>min |a_i+b_i-1|</span><strong>${result.minEqualityGap.toExponential(3)}</strong>
    </div>
    ${equalityWarning}
    <div class="free-row"><span class="status-reserve">${escapeHtml(abUnionState.status)}</span></div>
    <div class="free-row"><strong>labels</strong></div>
    ${labelRows || '<div class="free-small-status">No labels. Use d-mark or s-mark and click two intersecting sources.</div>'}
    <div class="ab-union-section-title">edge dots</div>
    <table class="ab-union-table">
      <thead><tr><th>edge</th><th>dots</th><th>left</th><th>right</th></tr></thead>
      <tbody>${edgeRowsHtml}</tbody>
    </table>
    <div class="ab-union-section-title">region data</div>
    <table class="ab-union-table">
      <thead><tr><th>R_i</th><th>same a</th><th>same b</th><th>fix current</th><th>=1</th><th>=1+delta</th><th>a_i</th><th>b_i</th><th>a_i+b_i</th><th>d_i</th><th>eq?</th><th>state</th></tr></thead>
      <tbody>${regionRowsHtml}</tbody>
    </table>
  `;
  }

  function renderAbUnionFrame(): void {
    deps.manualLocalCs = deps.manualLocalCs.map((value) => clampToLocalCMax(value, 1));
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    const abResult = renderAbUnion(deps.ctx, abUnionState, deps.triangleState, deps.manualLocalCs);
    deps.gammaValues.textContent = `${formatAbUnionValues('a', abUnionAValues(abUnionState))}; ${formatAbUnionValues('b', abUnionBValues(abUnionState))}`;
    deps.localCBounds.textContent = `center = ${abUnionCenterLabel(abUnionState.centerMode)}, quality = ${abUnionState.quality}, compute = ${abUnionState.useAxisAlignedHull ? 'hex-axis hull' : 'exact'}`;
    deps.localCValues.textContent = `L(theta) = ${abResult.currentL.toFixed(5)}, min equality gap = ${abResult.minEqualityGap.toExponential(3)}`;
    deps.ceStatus.textContent = 'ab union: CE/g-chain inactive';
    deps.ceStatus.style.color = '#475569';
    deps.ceChainStatus.textContent = abUnionState.centerMode === 'none'
      ? 'center containment inactive'
      : abResult.centerContains
        ? 'center containment PASS on sampled U'
        : `center containment FAIL on ${abResult.centerFailures} sampled points`;
    deps.ceChainStatus.style.color = abUnionState.centerMode === 'none'
      ? '#64748b'
      : abResult.centerContains ? '#047857' : '#b91c1c';
    deps.coverOverlayStatus.textContent = `ab union overlays: ${abUnionOverlayLabel()}`;
    deps.coverOverlayStatus.style.color = '#475569';
    renderAbUnionPanel(abResult);
    return;
  }

  function bindAbControls(): void {
    deps.abUnionControls.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tool = target.dataset.abTool;
      if (tool === 'move' || tool === 'add' || tool === 'delete' || tool === 'd-mark' || tool === 's-mark' || tool === 'f-mark') {
        setAbUnionTool(abUnionState, tool);
        deps.render();
        return;
      }
      if (target.dataset.abFmarkDelete !== undefined) {
        deleteSelectedAbUnionFMark(abUnionState);
        deps.render();
        return;
      }
      if (target.dataset.abFmarkClear !== undefined) {
        clearAbUnionFMarks(abUnionState);
        deps.render();
        return;
      }
      const snapLabel = target.dataset.abSnapLabel;
      const snapRole = target.dataset.abSnapRole;
      if (snapLabel && isAbUnionCoincidenceRole(snapRole)) {
        const edge = Number(target.dataset.abSnapEdge);
        if (Number.isInteger(edge) && edge >= 0 && edge < 6) {
          snapAbUnionLabelToEdge(abUnionState, snapLabel, edge, snapRole);
          deps.render();
        }
        return;
      }
      const deleteLabel = target.dataset.abDeleteLabel;
      if (deleteLabel) {
        deleteAbUnionLabel(abUnionState, deleteLabel);
        deps.render();
        return;
      }
      const preset = target.dataset.abPreset as AbUnionPreset | undefined;
      if (preset) {
        setAbUnionPreset(abUnionState, preset);
        deps.render();
        return;
      }
      if (target.dataset.abOptimize !== undefined) {
        if (abUnionState.autoOptimizeTheta) return;
        abUnionState.lastOptimized = optimizeAbUnionTheta(abUnionState);
        abUnionState.theta = abUnionState.lastOptimized.theta;
        abUnionState.thetaOptimizationPending = false;
        deps.render();
        return;
      }
    });

    deps.abUnionControls.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.abTheta !== undefined) {
        if (abUnionState.autoOptimizeTheta) return;
        abUnionState.theta = Math.max(0, Math.min(120, Number(target.value))) * Math.PI / 180;
        abUnionState.lastOptimized = null;
        deps.render();
      }
    });

    deps.abUnionControls.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.dataset.abShowOriginal !== undefined) {
        abUnionState.showOriginalRegion = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abShowTheta !== undefined) {
        abUnionState.showThetaTriangle = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abAutoTheta !== undefined) {
        abUnionState.autoOptimizeTheta = target.checked;
        if (target.checked) {
          requestAbUnionThetaOptimization(abUnionState);
        }
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abShowFarPair !== undefined) {
        abUnionState.showFarPair = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abClipSectors !== undefined) {
        abUnionState.clipToCornerSectors = target.checked;
        requestAbUnionThetaOptimization(abUnionState);
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abAxisHull !== undefined) {
        abUnionState.useAxisAlignedHull = target.checked;
        requestAbUnionThetaOptimization(abUnionState);
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abCenterLocked !== undefined) {
        abUnionState.centerLocked = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abCoincidenceLabel !== undefined) {
        const edge = Number(target.dataset.abCoincidenceEdge);
        const role = target.dataset.abCoincidenceRole;
        if (Number.isInteger(edge) && edge >= 0 && edge < 6 && isAbUnionCoincidenceRole(role)) {
          setAbUnionCoincidenceLock(abUnionState, target.dataset.abCoincidenceLabel, edge, role, target.checked);
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abRegionVisible !== undefined) {
        const index = Number(target.dataset.abRegionVisible);
        if (Number.isInteger(index) && index >= 0 && index < 6) {
          abUnionState.regionVisible[index] = target.checked;
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abSumMode !== undefined) {
        const index = Number(target.dataset.abSumIndex);
        const mode = target.checked ? target.dataset.abSumMode : 'none';
        if (Number.isInteger(index) && index >= 0 && index < 6) {
          if (isAreaSumConstraintMode(mode)) {
            setAbUnionSumConstraint(abUnionState, index, mode, deps.areaConstraintDelta);
          }
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.abLockKind !== undefined) {
        const index = Number(target.dataset.abLockIndex);
        const kind = target.dataset.abLockKind;
        if (Number.isInteger(index) && index >= 0 && index < 6) {
          if (kind === 'a' || kind === 'b') {
            setAbUnionLock(abUnionState, kind, index, target.checked);
          }
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLSelectElement && target.dataset.abCenterMode !== undefined) {
        const value = target.value;
        if (value === 'none' || value === 'triangle' || value === 'circle' || value === 'local-c') {
          abUnionState.centerMode = value as AbUnionCenterMode;
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLSelectElement && target.dataset.abQuality !== undefined) {
        const value = target.value;
        if (value === 'coarse' || value === 'high' || value === 'adaptive') {
          abUnionState.quality = value as AbUnionQuality;
          requestAbUnionThetaOptimization(abUnionState);
          deps.render();
        }
      }
    });

    setupAbUnionInteraction(
      deps.canvas,
      () => deps.shapeMode === 'ab-union',
      () => abUnionState,
      deps.triangleState,
      () => deps.manualLocalCs,
      (index, value) => {
        deps.manualLocalCs[index] = clampToLocalCMax(value, 1);
      },
      deps.render,
    );
  }

  return {
    get abUnionState() { return abUnionState; },
    renderAbUnionFrame,
    bindAbControls
  };
}
