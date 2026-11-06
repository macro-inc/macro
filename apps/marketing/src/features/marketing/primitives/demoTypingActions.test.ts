import { expect, it } from 'vitest';
import { demoTypingActions } from './demoTypingActions';

it('adds one character per action and pauses after spaces and punctuation', () => {
  const values: string[] = [];
  const actions = demoTypingActions(
    'Hi, Ava. 👋',
    (text) => values.push(text),
    1200
  );
  for (const action of actions) action.run();
  expect(values).toEqual([
    'H',
    'Hi',
    'Hi,',
    'Hi, ',
    'Hi, A',
    'Hi, Av',
    'Hi, Ava',
    'Hi, Ava.',
    'Hi, Ava. ',
    'Hi, Ava. 👋',
  ]);
  expect(actions[0].delay).toBe(1200);
  expect(actions[3].delay).toBeGreaterThan(actions[2].delay);
  expect(actions[8].delay).toBeGreaterThan(actions[3].delay);
  expect(demoTypingActions('', () => {})).toEqual([]);
});
