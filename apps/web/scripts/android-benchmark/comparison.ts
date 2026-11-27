import type { Sample } from './measure';
import { summarize } from './stats';

/** The parts of a results file a comparison reads. */
export type Results = {
  meta: { label?: string; environment?: { app?: string } };
  samples: Pick<
    Sample,
    'scenario' | 'variant' | 'cpuThrottle' | 'readyMs' | 'contentMs' | 'target'
  >[];
};

export type ComparedStep = {
  cpuThrottle: number;
  scenario: string;
  variant: string;
  a: { n: number; median: number; detect: number };
  b: { n: number; median: number; detect: number };
  /** B's median relative to A's, minus one. */
  change: number;
  /** The two runs did not open the same target for this step. */
  differentTargets: boolean;
  /** One run waited for content (`contentMs`) and the other did not. */
  differentReadiness: boolean;
};

/** Steps whose time depends on the target; older results don't say which. */
const OPENS_TARGET = /^(channel\.(open|back)|document\.(small|large)\.open)$/;

function key(sample: Results['samples'][number]) {
  return `${sample.cpuThrottle}\u0000${sample.scenario}\u0000${sample.variant}`;
}

function grouped(results: Results) {
  const groups = new Map<string, Results['samples']>();
  for (const sample of results.samples)
    groups.set(key(sample), [...(groups.get(key(sample)) ?? []), sample]);
  return groups;
}

/** The targets a group opened, as `index:fingerprint`, or `unknown`. */
function targetsOf(samples: Results['samples']): string[] {
  return [
    ...new Set(
      samples.map((sample) =>
        sample.target
          ? `${sample.target.index}:${sample.target.fingerprint}`
          : 'unknown'
      )
    ),
  ].sort();
}

function describe(targets: string[]) {
  return targets
    .map((target) =>
      target === 'unknown'
        ? 'an unrecorded target (results from before targets were recorded)'
        : `candidate ${target.split(':')[0]} (${target.split(':')[1]})`
    )
    .join(' and ');
}

/**
 * Compares two runs step by step, matching steps by CPU throttle, scenario
 * and variant, and warns where they cannot be compared: different targets
 * for a step that opens one, or steps only one run measured.
 */
export function compareRuns(a: Results, b: Results) {
  const groupsA = grouped(a);
  const groupsB = grouped(b);
  const warnings: string[] = [];
  const steps: ComparedStep[] = [];
  for (const [stepKey, samplesA] of groupsA) {
    const [cpuThrottle, scenario, variant] = stepKey.split('\u0000');
    const label = `${scenario} ${variant} at ${cpuThrottle}×`;
    const samplesB = groupsB.get(stepKey);
    if (!samplesB) {
      warnings.push(`${label}: only in A`);
      continue;
    }
    let differentTargets = false;
    const targetsA = targetsOf(samplesA);
    const targetsB = targetsOf(samplesB);
    if (samplesA[0].target || samplesB[0].target || OPENS_TARGET.test(scenario)) {
      differentTargets =
        targetsA.length > 1 ||
        targetsB.length > 1 ||
        targetsA[0] !== targetsB[0] ||
        targetsA[0] === 'unknown';
      if (differentTargets)
        warnings.push(
          `${label}: A opened ${describe(targetsA)}, B opened ${describe(targetsB)}; not comparable`
        );
    }
    // Older results end a content-gated view at its span, newer at its content.
    const waitsForContent = (samples: Results['samples']) =>
      samples.some((sample) => sample.contentMs !== undefined);
    const differentReadiness = waitsForContent(samplesA) !== waitsForContent(samplesB);
    if (differentReadiness)
      warnings.push(
        `${label}: ${waitsForContent(samplesA) ? 'A' : 'B'} waited for content to paint, the other ended at the span; not comparable`
      );
    const summaryA = summarize(samplesA.map((sample) => sample.readyMs));
    const summaryB = summarize(samplesB.map((sample) => sample.readyMs));
    steps.push({
      cpuThrottle: Number(cpuThrottle),
      scenario,
      variant,
      a: { n: summaryA.n, median: summaryA.median, detect: summaryA.detectableChange },
      b: { n: summaryB.n, median: summaryB.median, detect: summaryB.detectableChange },
      change: summaryB.median / summaryA.median - 1,
      differentTargets,
      differentReadiness,
    });
  }
  for (const stepKey of groupsB.keys())
    if (!groupsA.has(stepKey)) {
      const [cpuThrottle, scenario, variant] = stepKey.split('\u0000');
      warnings.push(`${scenario} ${variant} at ${cpuThrottle}×: only in B`);
    }
  return { steps, warnings };
}
