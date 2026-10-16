import { parseCellAddress } from './spreadsheet-document';

/** A formula cell and the numeric cell Goal Seek is allowed to change. */
export type GoalSeekRequest = {
  setSheetId: string;
  setAddress: string;
  goal: number;
  changeSheetId: string;
  changeAddress: string;
};

export type GoalSeekSolution = {
  status: 'found' | 'approximate';
  /** Literal written into the changing cell. */
  input: string;
  /** The number that literal stores. */
  value: number;
  /** Formula result at that input. */
  result: number;
  evaluations: number;
  setSheetId: string;
  setAddress: string;
  changeSheetId: string;
  changeAddress: string;
};

export type GoalSeekResult =
  | GoalSeekSolution
  | { status: 'invalid'; message: string };

export type GoalSeekSolveStatus = 'found' | 'approximate' | 'unchanged';

export type GoalSeekSolveOutcome = {
  status: GoalSeekSolveStatus;
  input: number;
  result: number;
  evaluations: number;
};

const GOAL_SEEK_REFERENCE =
  /^(?:(?:'((?:[^']|'')+)'|([^'!:\s()]+))!)?\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i;

/** `B12`, `$B$12`, `Inputs!B12`, or `'Q1 sheet'!B12`. */
export function parseGoalSeekReference(
  text: string
): { sheet?: string; address: string } | undefined {
  const match = GOAL_SEEK_REFERENCE.exec(text.trim());
  if (!match) return;
  const [, quoted, bare, column, row] = match;
  const address = `${column}${row}`.toUpperCase();
  if (!parseCellAddress(address)) return;
  return { sheet: quoted?.replace(/''/g, "'") ?? bare, address };
}

/** A goal typed as `10`, `1,250.5`, `$10`, or `12%`. */
export function parseGoalValue(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return;
  const percent = trimmed.endsWith('%');
  const body = (percent ? trimmed.slice(0, -1) : trimmed)
    .replace(/[$,\s]/g, '')
    .replace(/^\+/, '');
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(body)) return;
  const value = Number(body);
  if (!Number.isFinite(value)) return;
  return percent ? value / 100 : value;
}

/** Fifteen significant digits, matching the precision Excel stores. */
export function goalSeekInput(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const precise = Number(value.toPrecision(15));
  if (precise === 0) return '0';
  return String(precise);
}

function reached(result: number, goal: number) {
  const scale = Math.max(1, Math.abs(goal), Math.abs(result));
  return Math.abs(result - goal) <= 1e-7 * scale;
}

/**
 * Find an input that makes `evaluate` return `goal`. Newton steps handle
 * smooth formulas; a sign change switches to bisection. At most 100
 * evaluations, which is Excel's Goal Seek iteration limit.
 */
export function solveGoalSeek(options: {
  goal: number;
  guess: number;
  evaluate: (input: number) => number | undefined;
  maxEvaluations?: number;
}): GoalSeekSolveOutcome | undefined {
  const max = options.maxEvaluations ?? 100;
  const goal = options.goal;
  let evaluations = 0;
  let best: { input: number; result: number; distance: number } | undefined;
  let first: number | undefined;
  let varied = false;

  const sample = (input: number): number | undefined => {
    if (evaluations >= max || !Number.isFinite(input)) return;
    evaluations++;
    const result = options.evaluate(input);
    if (result === undefined || !Number.isFinite(result)) return;
    if (first === undefined) first = result;
    else if (Math.abs(result - first) > 1e-9 * Math.max(1, Math.abs(first)))
      varied = true;
    const distance = Math.abs(result - goal);
    if (!best || distance < best.distance) best = { input, result, distance };
    return result;
  };

  const found = (input: number, result: number): GoalSeekSolveOutcome => {
    // A Newton step can stop a few ulps away from a round input such as 10.
    // Keep a shorter decimal when it still reaches the goal.
    let bestInput = input;
    let bestResult = result;
    const candidates = [Math.round(input)];
    for (const digits of [12, 10, 8, 6, 4, 2]) {
      const rounded = Number(input.toPrecision(digits));
      if (Number.isFinite(rounded)) candidates.push(rounded);
    }
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate) || candidate === bestInput) continue;
      const checked = sample(candidate);
      if (checked === undefined || !reached(checked, goal)) continue;
      if (goalSeekInput(candidate).length < goalSeekInput(bestInput).length) {
        bestInput = candidate;
        bestResult = checked;
      }
    }
    return {
      status: 'found',
      input: bestInput,
      result: bestResult,
      evaluations,
    };
  };

  const finish = (): GoalSeekSolveOutcome | undefined => {
    if (!best) return;
    if (reached(best.result, goal))
      return {
        status: 'found',
        input: best.input,
        result: best.result,
        evaluations,
      };
    return {
      status: varied ? 'approximate' : 'unchanged',
      input: best.input,
      result: best.result,
      evaluations,
    };
  };

  const bisect = (
    leftInput: number,
    leftResult: number,
    rightInput: number,
    rightResult: number
  ) => {
    let left = { input: leftInput, result: leftResult };
    let right = { input: rightInput, result: rightResult };
    while (evaluations < max) {
      const mid = (left.input + right.input) / 2;
      if (mid === left.input || mid === right.input) break;
      const result = sample(mid);
      if (result === undefined) break;
      if (reached(result, goal)) return found(mid, result);
      if ((left.result - goal) * (result - goal) <= 0)
        right = { input: mid, result };
      else left = { input: mid, result };
    }
    return finish();
  };

  const guess = Number.isFinite(options.guess) ? options.guess : 0;
  let current = guess;
  let currentResult = sample(current);
  if (currentResult === undefined) return finish();
  if (reached(currentResult, goal)) return found(current, currentResult);

  // Newton, damped so a steep slope cannot jump to a non-finite input.
  // A sign change between samples is handed to bisection.
  for (let step = 0; step < 24 && evaluations < max - 1; step++) {
    const probe = current + Math.max(Math.abs(current) * 1e-4, 1e-4);
    const probed = sample(probe);
    if (probed === undefined) break;
    if (reached(probed, goal)) return found(probe, probed);
    if ((currentResult - goal) * (probed - goal) < 0)
      return bisect(current, currentResult, probe, probed);
    const slope = (probed - currentResult) / (probe - current);
    if (!Number.isFinite(slope) || slope === 0) break;
    let delta = (currentResult - goal) / slope;
    const limit = Math.max(1, Math.abs(current)) * 10;
    if (Math.abs(delta) > limit) delta = Math.sign(delta) * limit;
    const next = current - delta;
    if (!Number.isFinite(next) || next === current) break;
    const nextResult = sample(next);
    if (nextResult === undefined) break;
    if (reached(nextResult, goal)) return found(next, nextResult);
    if ((currentResult - goal) * (nextResult - goal) < 0)
      return bisect(current, currentResult, next, nextResult);
    if (
      step > 4 &&
      Math.abs(nextResult - goal) >= Math.abs(currentResult - goal)
    )
      break;
    current = next;
    currentResult = nextResult;
  }

  // Expand geometrically around the original guess until the goal is bracketed.
  let anchor = { input: guess, result: currentResult };
  if (best && Math.abs(best.result - goal) < Math.abs(anchor.result - goal))
    anchor = { input: best.input, result: best.result };
  let expansion = Math.max(Math.abs(guess) * 0.5, 0.5);
  for (let step = 0; step < 20 && evaluations < max; step++) {
    expansion *= 2;
    for (const direction of [-1, 1]) {
      const input = guess + direction * expansion;
      const result = sample(input);
      if (result === undefined) continue;
      if (reached(result, goal)) return found(input, result);
      if ((anchor.result - goal) * (result - goal) < 0)
        return bisect(anchor.input, anchor.result, input, result);
      if (Math.abs(result - goal) < Math.abs(anchor.result - goal))
        anchor = { input, result };
    }
  }
  return finish();
}
