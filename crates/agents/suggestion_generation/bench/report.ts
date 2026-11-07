// The summary table of one or more runs: one line per run with the score and
// its parts, then the attempts that went wrong.

import { type RunFile, summary } from './score';

const secs = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(0)}s` : '–');

export function lines(runs: RunFile[]): string[] {
  const out = [
    '| section | label | set | commit | score (95%) | found / needs | bad | invented | suggested | quality | first | wall | $ / gen | $ judge | runs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const run of runs) {
    const s = summary(run.attempts);
    out.push(
      `| ${run.section} | ${run.label} | ${run.set} | ${run.commit} | ${s.score.toFixed(1)} (${s.scoreInterval[0].toFixed(1)}–${s.scoreInterval[1].toFixed(1)}) | ${s.found.toFixed(2)} / ${s.needs.toFixed(1)} | ${s.bad.toFixed(2)} | ${s.invented.toFixed(2)} | ${s.suggestions.toFixed(1)} | ${s.quality.toFixed(2)}${s.feedRating !== undefined ? ` (feed ${s.feedRating.toFixed(1)}/10)` : ''} | ${secs(s.firstMedianMs)} | ${secs(s.wallMedianMs)} | ${s.usd.toFixed(3)} | ${s.judgeUsd.toFixed(3)} | ${s.scored}/${s.attempts} |`,
    );
  }
  for (const run of runs) {
    const s = summary(run.attempts);
    const wrong = Object.entries(s.wrongPerRun)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(', ');
    out.push('', `${run.section} (${run.label}): wrong per generation: ${wrong || 'none'}; generations not ready: ${s.failedGenerations}; bench errors: ${s.benchErrors}`);
    for (const attempt of run.attempts.filter((a) => a.benchError)) out.push(`- ${attempt.persona}${(attempt.seat ?? 1) > 1 ? `/s${attempt.seat}` : ''} #${attempt.rep}: ${attempt.benchError}`);
  }
  return out;
}
