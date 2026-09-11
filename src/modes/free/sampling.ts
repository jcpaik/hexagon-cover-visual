import { escapeHtml } from '../../app/format';
import type { FreeState } from '../../freeTypes';
import {
  summarizeCSamples,
  summarizeVSamples,
  type CCaseSummary,
  type CSample,
  type RejectedSample,
  type SamplingStore,
  type VCaseSummary,
  type VSample,
} from '../../halfSkeletonFrontier';

interface Dependencies {
  readonly showAllSamplePoints: boolean;
  readonly currentV0Sample: VSample | RejectedSample | null;
  readonly currentCSample: CSample | RejectedSample | null;
  readonly samplingStore: () => SamplingStore;
  readonly freeState: FreeState;
}

export function createSamplingPanel(deps: Dependencies) {
  function samplePointToSvg(point: { a: number; b: number; }, size: { width: number; height: number; pad: number; }): { x: number; y: number; } {
    const innerWidth = size.width - 2 * size.pad;
    const innerHeight = size.height - 2 * size.pad;
    return {
      x: size.pad + point.a * innerWidth,
      y: size.height - size.pad - point.b * innerHeight,
    };
  }

  function colorForSampleCase(caseId: string): string {
    const colors: Record<string, string> = {
      'vd0-o1-empty': 'hsl(214, 84%, 48%)',
      'vd0-o2-m0': 'hsl(188, 86%, 38%)',
      'vd1-empty': 'hsl(132, 68%, 38%)',
      'vd1-m0': 'hsl(82, 78%, 36%)',
      'vd1-m1': 'hsl(48, 90%, 42%)',
      'vd1-m5': 'hsl(25, 88%, 48%)',
      'vd1-m0-m1': 'hsl(0, 76%, 50%)',
      'vd1-m0-m5': 'hsl(326, 74%, 46%)',
      'vd2-m0': 'hsl(276, 78%, 50%)',
      'vd2-m0-m1': 'hsl(250, 76%, 54%)',
      'vd2-m0-m5': 'hsl(226, 75%, 52%)',
      'vd2-m0-m1-m5': 'hsl(170, 82%, 34%)',
      't3-m1': 'hsl(30, 10%, 28%)',
      't3-m5': 'hsl(210, 13%, 18%)',
    };
    return colors[caseId] ?? '#0f766e';
  }

  function sampleAxis(size: { width: number; height: number; pad: number; }, xLabel: string, yLabel: string): string {
    const innerWidth = size.width - 2 * size.pad;
    const innerHeight = size.height - 2 * size.pad;
    const ticks = Array.from({ length: 11 }, (_, index) => {
      const value = index / 10;
      const x = size.pad + value * innerWidth;
      const y = size.height - size.pad - value * innerHeight;
      const label = index === 0 || index === 5 || index === 10 ? value.toString() : '';
      return `
      <line class="half-frontier-tick" x1="${x}" y1="${size.height - size.pad}" x2="${x}" y2="${size.height - size.pad + 4}" />
      <line class="half-frontier-tick" x1="${size.pad - 4}" y1="${y}" x2="${size.pad}" y2="${y}" />
      ${label ? `<text class="half-frontier-tick-label" x="${x}" y="${size.height - size.pad + 18}" text-anchor="middle">${label}</text>` : ''}
      ${label ? `<text class="half-frontier-tick-label" x="${size.pad - 8}" y="${y + 4}" text-anchor="end">${label}</text>` : ''}
    `;
    }).join('');
    return `
    <line x1="${size.pad}" y1="${size.height - size.pad}" x2="${size.width - size.pad}" y2="${size.height - size.pad}" />
    <line x1="${size.pad}" y1="${size.pad}" x2="${size.pad}" y2="${size.height - size.pad}" />
    ${ticks}
    <text x="${size.width - size.pad}" y="${size.height - 8}" text-anchor="end">${xLabel}</text>
    <text x="10" y="${size.pad}" text-anchor="start">${yLabel}</text>
  `;
  }

  function renderVSamplePlot(summaries: VCaseSummary[]): string {
    const size = { width: 720, height: 420, pad: 54 };
    const axis = sampleAxis(size, 'a', 'b');
    const points = summaries.flatMap((summary) => {
      const visibleSamples = deps.showAllSamplePoints ? summary.samples : summary.pareto;
      return visibleSamples.map((point) => {
        const svgPoint = samplePointToSvg(point, size);
        const isPareto = summary.pareto.includes(point);
        const className = deps.showAllSamplePoints && !isPareto ? ' class="half-frontier-nonfront"' : '';
        return `<circle${className} cx="${svgPoint.x}" cy="${svgPoint.y}" r="${isPareto ? 3 : 2.2}" style="fill:${colorForSampleCase(point.caseId)}" />`;
      });
    }).join('');
    const current = deps.currentV0Sample && 'kind' in deps.currentV0Sample && deps.currentV0Sample.kind === 'v'
      ? (() => {
        const point = samplePointToSvg(deps.currentV0Sample, size);
        return `<circle class="half-frontier-selected" cx="${point.x}" cy="${point.y}" r="4" style="fill:${colorForSampleCase(deps.currentV0Sample.caseId)}" />`;
      })()
      : '';
    const legend = summaries.filter((summary) =>
      deps.showAllSamplePoints ? summary.samples.length > 0 : summary.pareto.length > 0,
    ).map((summary) => `
    <div class="half-frontier-legend-item">
      <span class="half-frontier-swatch" style="background:${colorForSampleCase(summary.caseId)}"></span>
      <span>${escapeHtml(summary.label)}</span>
    </div>
  `).join('');
    return `
    <div class="half-frontier-v-plot-block">
      <svg class="half-frontier-plot half-frontier-v-plot" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="V0 sampling plot">${axis}${points}${current}</svg>
      <div class="half-frontier-legend" aria-label="V0 sampling color legend">${legend || '<div class="free-small-status">No front points.</div>'}</div>
    </div>
  `;
  }

  function endpointPointToSvg(point: { start: number; end: number; }, size: { width: number; height: number; pad: number; }): { x: number; y: number; } {
    return samplePointToSvg({ a: point.start, b: point.end }, size);
  }

  function ce2Hue(index: number, count: number): string {
    const t = count <= 1 ? 0 : index / (count - 1);
    return `hsl(${Math.round(220 - 220 * t)}, 78%, 46%)`;
  }

  function endpointAxis(size: { width: number; height: number; pad: number; }, xLabel: string, yLabel: string): string {
    return sampleAxis(size, xLabel, yLabel);
  }

  function renderCe1EndpointPlot(summary: CCaseSummary | undefined): string {
    const size = { width: 500, height: 210, pad: 42 };
    const visibleSamples = summary ? deps.showAllSamplePoints ? summary.samples : summary.maximal : [];
    const points = visibleSamples.map((sample) => {
      const point = endpointPointToSvg(sample.edge01, size);
      const isMaximal = summary?.maximal.includes(sample) ?? false;
      const className = isMaximal ? 'half-frontier-endpoint is-maximal' : 'half-frontier-endpoint half-frontier-nonfront';
      return `<circle class="${className}" cx="${point.x}" cy="${point.y}" r="${isMaximal ? 4 : 2.2}" />`;
    }).join('');
    const current = deps.currentCSample &&
      !('reason' in deps.currentCSample) &&
      deps.currentCSample.caseId === 'ce1-m0'
      ? (() => {
        const point = endpointPointToSvg(deps.currentCSample.edge01, size);
        return `<circle class="half-frontier-selected" cx="${point.x}" cy="${point.y}" r="4" />`;
      })()
      : '';
    return `<svg class="half-frontier-plot" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="CE1 endpoint plot">${endpointAxis(size, 'start e01', 'end e01')}${points}${current}</svg>`;
  }

  function renderCe2EndpointPlot(summary: CCaseSummary | undefined, edge: 'edge50' | 'edge01', label: string): string {
    const size = { width: 500, height: 210, pad: 42 };
    const samples = summary ? deps.showAllSamplePoints ? summary.samples : summary.maximal : [];
    const ordered = samples
      .map((sample, index) => ({ sample, index }))
      .sort((a, b) => (a.sample.edge50?.start ?? 0) - (b.sample.edge50?.start ?? 0));
    const points = ordered.map(({ sample }, index) => {
      const interval = edge === 'edge50' ? sample.edge50 : sample.edge01;
      if (!interval) return '';
      const point = endpointPointToSvg(interval, size);
      const color = ce2Hue(index, Math.max(1, ordered.length));
      const isMaximal = summary?.maximal.includes(sample) ?? false;
      const className = isMaximal ? 'half-frontier-endpoint is-maximal' : 'half-frontier-endpoint half-frontier-nonfront';
      return `<circle class="${className}" cx="${point.x}" cy="${point.y}" r="${isMaximal ? 4 : 2.2}" style="fill:${color};stroke:${color}" />`;
    }).join('');
    const current = deps.currentCSample &&
      !('reason' in deps.currentCSample) &&
      deps.currentCSample.caseId === 'ce2-m0'
      ? (() => {
        const interval = edge === 'edge50' ? deps.currentCSample.edge50 : deps.currentCSample.edge01;
        if (!interval) return '';
        const point = endpointPointToSvg(interval, size);
        return `<circle class="half-frontier-selected" cx="${point.x}" cy="${point.y}" r="4" />`;
      })()
      : '';
    return `<svg class="half-frontier-plot" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="${label} endpoint plot">${endpointAxis(size, `start ${label}`, `end ${label}`)}${points}${current}</svg>`;
  }

  function renderCSamplePlot(summaries: CCaseSummary[]): string {
    const ce1 = summaries.find((summary) => summary.caseId === 'ce1-m0');
    const ce2 = summaries.find((summary) => summary.caseId === 'ce2-m0');
    return `
    <div class="half-frontier-subtitle">CE1 e01 endpoints</div>
    ${renderCe1EndpointPlot(ce1)}
    <div class="half-frontier-subtitle">CE2 e50 endpoints</div>
    ${renderCe2EndpointPlot(ce2, 'edge50', 'e50')}
    <div class="half-frontier-subtitle">CE2 e01 endpoints matched by color</div>
    ${renderCe2EndpointPlot(ce2, 'edge01', 'e01')}
  `;
  }

  function currentSampleText(sample: VSample | CSample | RejectedSample | null): string {
    if (!sample) return 'none';
    if ('reason' in sample) return `rejected: ${sample.reason}`;
    if (sample.kind === 'v') return `${sample.label}; a=${sample.a.toFixed(4)}, b=${sample.b.toFixed(4)}`;
    const e50 = sample.edge50 ? `; e50=[${sample.edge50.start.toFixed(3)}, ${sample.edge50.end.toFixed(3)}]` : '';
    return `${sample.label}; e01=[${sample.edge01.start.toFixed(3)}, ${sample.edge01.end.toFixed(3)}]${e50}`;
  }

  function renderSamplingPanel(): string {
    const store = deps.samplingStore();
    const vSummaries = summarizeVSamples(store.v);
    const cSummaries = summarizeCSamples(store.c);
    const groupText = [
      ...vSummaries.map((summary) => `${summary.label}: ${summary.samples.length} (${summary.pareto.length} Pareto)`),
      ...cSummaries.map((summary) => `${summary.label}: ${summary.samples.length} (${summary.maximal.length} maximal)`),
    ].join('; ');
    const graphs = deps.freeState.tool === 'sample'
      ? `${renderVSamplePlot(vSummaries)}${renderCSamplePlot(cSummaries)}`
      : '';

    return `
    <div class="half-frontier-panel">
      <div class="half-frontier-title">sampling</div>
      <div class="half-frontier-controls">
        <button type="button" class="free-button" data-clear-samples>clear samples</button>
        <label><input type="checkbox" data-show-all-samples${deps.showAllSamplePoints ? ' checked' : ''}/>show all points</label>
      </div>
      <div class="free-small-status">current V0: ${escapeHtml(currentSampleText(deps.currentV0Sample))}</div>
      <div class="free-small-status">current C: ${escapeHtml(currentSampleText(deps.currentCSample))}</div>
      ${graphs}
      <div class="free-small-status">${escapeHtml(groupText || 'No samples yet. Select the sample tool and move C or V0.')}</div>
      <div class="free-small-status">rejected=${store.rejected.length}</div>
    </div>
  `;
  }

  return {
    renderSamplingPanel
  };
}

