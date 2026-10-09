import { expect, it } from 'vitest';
import {
  goalSeekInput,
  parseGoalSeekReference,
  parseGoalValue,
  solveGoalSeek,
} from './goal-seek';

it('parses cell references and goals', () => {
  expect(parseGoalSeekReference('b12')).toEqual({ address: 'B12' });
  expect(parseGoalSeekReference('$C$3')).toEqual({ address: 'C3' });
  expect(parseGoalSeekReference('Inputs!B12')).toEqual({
    sheet: 'Inputs',
    address: 'B12',
  });
  expect(parseGoalSeekReference("'Q1 ''sheet'''!A1")).toEqual({
    sheet: "Q1 'sheet'",
    address: 'A1',
  });
  expect(parseGoalSeekReference('A1:B2')).toBeUndefined();
  expect(parseGoalSeekReference('not a cell')).toBeUndefined();
  expect(parseGoalValue(' 1,250.5 ')).toBe(1250.5);
  expect(parseGoalValue('$10')).toBe(10);
  expect(parseGoalValue('12%')).toBe(0.12);
  expect(parseGoalValue('1.5e3')).toBe(1500);
  expect(parseGoalValue('goal')).toBeUndefined();
  expect(goalSeekInput(0.1 + 0.2)).toBe('0.3');
  expect(goalSeekInput(-0)).toBe('0');
});

it('solves smooth formulas and reports a goal the formula cannot reach', () => {
  const linear = solveGoalSeek({
    goal: 50,
    guess: 2,
    evaluate: (input) => input * 5,
  });
  expect(linear).toMatchObject({ status: 'found', input: 10, result: 50 });

  const root = solveGoalSeek({
    goal: 2,
    guess: 1,
    evaluate: (input) => input * input,
  });
  expect(root?.status).toBe('found');
  expect(root?.result).toBeCloseTo(2, 6);

  const negative = solveGoalSeek({
    goal: 3,
    guess: 1,
    evaluate: (input) => input + 10,
  });
  expect(negative).toMatchObject({ status: 'found', input: -7, result: 3 });

  const already = solveGoalSeek({
    goal: 10,
    guess: 5,
    evaluate: (input) => input * 2,
  });
  expect(already).toMatchObject({
    status: 'found',
    input: 5,
    result: 10,
    evaluations: 1,
  });

  const unchanged = solveGoalSeek({
    goal: 10,
    guess: 4,
    evaluate: () => 2,
  });
  expect(unchanged?.status).toBe('unchanged');

  const closest = solveGoalSeek({
    goal: 100,
    guess: 0,
    evaluate: (input) => Math.min(40, input),
  });
  expect(closest?.status).toBe('approximate');
  expect(closest?.result).toBe(40);
});
