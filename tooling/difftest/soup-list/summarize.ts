/**
 * Folds the runs' result files into one summary: per run, the cases, the
 * sequences and steps, the failures by kind, the mutants caught, the
 * differences that are not failures (incidental staleness, branch fresher),
 * and the coverage per dimension.
 *
 *   bun run summarize.ts results/quiet.json results/load.json ...
 */
type Json = Record<string, any>;

const count = (xs: { kind?: string }[] = []) => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x.kind ?? '?'] = (out[x.kind ?? '?'] ?? 0) + 1;
  return out;
};

function summarize(r: Json) {
  const fuzz = Object.values((r.fuzz ?? {}) as Record<string, Json>);
  const sum = (k: string) => fuzz.reduce((n, f) => n + (f[k] ?? 0), 0);
  const fuzzFailures = fuzz.flatMap((f) => f.failures ?? []);
  const seq: Json = r.sequences ?? {};
  const mutants: Json = r.mutants ?? {};
  const planted = Object.entries(mutants).filter(([m]) => m !== 'control');
  return {
    label: r.meta?.label,
    seed: r.meta?.seed,
    apps: r.meta?.apps,
    harness: r.meta?.harness,
    seconds: r.meta?.seconds,
    setupRetries: r.meta?.setupRetries,
    openRetries: r.meta?.openRetries?.length ?? 0,
    fuzz: {
      cases: sum('cases'),
      sameAsRest: sum('translatable'),
      tracedFallback: sum('fallback'),
      restRejected: sum('restRejected'),
      failures: fuzzFailures.length,
      failureKinds: count(fuzzFailures),
      fallbackReasons: fuzz.reduce((t: Record<string, number>, f) => {
        for (const [k, v] of Object.entries((f.reasons ?? {}) as Record<string, number>)) t[k] = (t[k] ?? 0) + v;
        return t;
      }, {}),
      /** GraphQL differs from REST identically on main and the branch. */
      preexisting: fuzz.reduce((n, f) => n + (f.preexisting?.length ?? 0), 0),
      /** Background GraphQL reads of the app's own lists seen during fallback cases. */
      shellRequests: sum('shellRequests'),
    },
    callers: {
      cases: r.callers?.cases ?? 0,
      byCaller: Object.fromEntries(Object.entries((r.callers?.byCaller ?? {}) as Record<string, Json>).map(([k, v]) => [k, v.cases])),
      failures: r.callers?.failures?.length ?? 0,
      failureKinds: count(r.callers?.failures),
      /** Slash-menu PR counts per user: main's menu, the oracle, the branch. */
      slash: r.callers?.slash,
      /** PR-link one-shots main refused, against main run in slices. */
      splitOracle: r.callers?.splitOracle,
    },
    sequences: {
      sequences: seq.sequences ?? 0,
      steps: seq.steps ?? 0,
      reloads: seq.reloads ?? 0,
      comparisons: seq.comparisons ?? 0,
      stepKinds: seq.stepKinds,
      failures: seq.failures?.length ?? 0,
      failureKinds: count(seq.failures),
      newOnly: seq.newOnly?.length ?? 0,
      /** Missed live updates: how many the branch showed late (within the tail) and how many never. */
      missedLive: (seq.failures ?? [])
        .filter((x: Json) => /missed-update$/.test(x.kind))
        .reduce((t: Json, x: Json) => {
          const k = x.lateMs == null ? 'never' : 'late';
          t[k] = (t[k] ?? 0) + 1;
          if (x.cache?.new?.length) t.withCacheErrors = (t.withCacheErrors ?? 0) + 1;
          return t;
        }, {}),
      repairs: seq.repairs?.length ?? 0,
      aborted: seq.aborted?.length ?? 0,
      /** Steps that ran past the step deadline; their attempts were run again. */
      hangs: seq.hangs?.length ?? 0,
      incidental: Object.fromEntries(Object.entries((seq.incidental ?? {}) as Record<string, Json>).map(([k, v]) => [k, v.count])),
      liveData: seq.liveData,
      writeErrors: seq.writeErrors,
    },
    mutants: {
      planted: planted.length,
      caught: planted.filter(([, v]) => v?.caught).length,
      each: Object.fromEntries(Object.entries(mutants).map(([m, v]: [string, Json]) => [m, { caught: v?.caught, failures: v?.failures, kinds: v?.kinds }])),
    },
    load: r.load && { ops: r.load.ops, errors: r.load.errors },
    laneErrors: (r.errors ?? []).map((e: Json) => e.lane),
    coverage: r.coverage,
  };
}

const runs = [];
for (const path of process.argv.slice(2)) {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    runs.push({ path, missing: true });
    continue;
  }
  runs.push(summarize(await file.json()));
}
const total = (f: (s: any) => number) => runs.reduce((n, s: any) => n + (s.missing ? 0 : f(s)), 0);
console.log(
  JSON.stringify(
    {
      runs,
      totals: {
        readCases: total((s) => s.fuzz.cases + s.callers.cases),
        sequences: total((s) => s.sequences.sequences),
        steps: total((s) => s.sequences.steps),
        failures: total((s) => s.fuzz.failures + s.callers.failures + s.sequences.failures),
        mutantsPlanted: total((s) => s.mutants.planted),
        mutantsCaught: total((s) => s.mutants.caught),
      },
    },
    null,
    1
  )
);
