// The summary table of one or more runs: one line per run with the score and
// its parts, then the attempts that went wrong.

import { MIN_HELDOUT_PEOPLE } from './finding';
import { type RunFile, scored, summary } from './score';

/** Why `run`'s aggregate can't be shown: it holds held-out people, and fewer of them scored than an aggregate needs to show no one's result. */
function withheld(run: RunFile): string | undefined {
  if (!run.attempts.some((attempt) => attempt.heldout)) return undefined;
  const people = new Set(scored(run.attempts).filter((attempt) => attempt.heldout).map((attempt) => attempt.persona)).size;
  return people < MIN_HELDOUT_PEOPLE ? `${people} held-out people scored, fewer than ${MIN_HELDOUT_PEOPLE}: their aggregate would show one person's result, so none is shown` : undefined;
}

const secs = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(0)}s` : '–');

export function lines(runs: RunFile[]): string[] {
  const out = [
    '| section | label | set | commit | score (95%) | found / needs | bad | invented | suggested | quality | first | last | wall | $ / gen | $ judge | runs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const run of runs) {
    const hidden = withheld(run);
    if (hidden) {
      out.push(`| ${run.section} | ${run.label} | ${run.set} | ${run.commit} | ${hidden} |`);
      continue;
    }
    const s = summary(run.attempts);
    out.push(
      `| ${run.section} | ${run.label} | ${run.set} | ${run.commit} | ${s.score.toFixed(1)} (${s.scoreInterval[0].toFixed(1)}–${s.scoreInterval[1].toFixed(1)}) | ${s.found.toFixed(2)} / ${s.needs.toFixed(1)} | ${s.bad.toFixed(2)} | ${s.invented.toFixed(2)} | ${s.suggestions.toFixed(1)} | ${s.quality.toFixed(2)}${s.feedRating !== undefined ? ` (feed ${s.feedRating.toFixed(1)}/10)` : ''} | ${secs(s.firstMedianMs)} | ${secs(s.lastMedianMs)} | ${secs(s.wallMedianMs)} | ${s.usd.toFixed(3)} | ${s.judgeUsd.toFixed(3)} | ${s.scored}/${s.attempts} |`,
    );
  }
  for (const run of runs) {
    if (withheld(run)) continue;
    const s = summary(run.attempts);
    const wrong = Object.entries(s.wrongPerRun)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(', ');
    out.push('', `${run.section} (${run.label}): wrong per generation: ${wrong || 'none'}; generations not ready: ${s.failedGenerations}; bench errors: ${s.benchErrors}`);
    if (s.goodDrafts !== undefined) {
      const aimed = s.aimed !== undefined ? `; work streams some suggestion acts on ${s.aimed.toFixed(2)} of ${s.workStreams!.toFixed(1)}` : '';
      if (s.finding && !s.finding.lists) out.push(`${run.section} (${run.label}): no work list could be judged (${s.finding.errors} failed)`);
      else if (s.finding) {
        const errors = s.finding.errors ? ` (${s.finding.errors} more not judged)` : '';
        out.push(`${run.section} (${run.label}): work lists read in ${s.finding.read} of ${s.finding.lists} generations${errors}; they named ${(100 * s.finding.found).toFixed(0)}% of the key's work streams, with ${s.finding.unreal.toFixed(1)} of ${s.finding.listed.toFixed(1)} entries naming none`);
      }
      out.push(`${run.section} (${run.label}): good drafts per generation ${s.goodDrafts.toFixed(2)} of ${s.drafts!.toFixed(2)} drafted, 5 or more in ${s.fiveGoodDrafts} of ${s.scored}; good catalog picks ${s.goodPicks!.toFixed(2)}${aimed}`);
    }
    // A held-out person's error can name them: only that it happened is shown.
    for (const attempt of run.attempts.filter((a) => a.benchError)) out.push(attempt.heldout ? `- a held-out generation #${attempt.rep}: bench error` : `- ${attempt.persona}${(attempt.seat ?? 1) > 1 ? `/s${attempt.seat}` : ''} #${attempt.rep}: ${attempt.benchError}`);
  }
  return out;
}
