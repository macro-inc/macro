/** The FUZZ_* environment knobs both fuzz tests read; see the README. */

const number = (name: string, fallback: number) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`${name}=${value} is not a number`);
  return parsed;
};

export const RUNS = number('FUZZ_RUNS', 3);
export const PEERS = number('FUZZ_PEERS', 3);
export const STEPS = number('FUZZ_STEPS', 150);
export const MINUTES = number('FUZZ_MINUTES', 15);
export const SEED =
  process.env.FUZZ_SEED === undefined ? undefined : number('FUZZ_SEED', 0);
export const PATH = process.env.FUZZ_PATH;
export const REPLAY_PATH = process.env.FUZZ_REPLAY_PATH;
export const SHRINK = process.env.FUZZ_SHRINK !== '0';
/** Undo everything everyone did, check, then redo it all and check again. */
export const UNDO = process.env.FUZZ_UNDO;
/** Finding kinds that go in the report without failing the run. */
export const IGNORE = new Set(
  process.env.FUZZ_IGNORE?.split(',').filter(Boolean)
);
