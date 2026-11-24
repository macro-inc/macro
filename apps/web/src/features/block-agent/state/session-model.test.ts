import { Model } from '@core/component/AI/constant/model';
import { expect, it } from 'vitest';
import { shownSessionModel, shownSessionModels } from './session-model';

it.each([
  ['openai/gpt-5.6', 'in-memory', Model.gpt62Sol],
  ['anthropic/claude-haiku-4-5', 'macro-inmem', Model.haiku55],
  [Model.gpt62Sol, 'in-memory', Model.gpt62Sol],
  ['openai/gpt-5.6', 'macrod', 'openai/gpt-5.6'],
  ['openai/gpt-5.6', undefined, 'openai/gpt-5.6'],
])('shows %s on %s as %s', (model, harness, shown) => {
  expect(shownSessionModel(model, harness)).toBe(shown);
});

it('offers a replacement once when the runtime still lists retired models', () => {
  const models = [
    { id: 'openai/gpt-5.6' },
    { id: 'openai/gpt-6.1-sol' },
    { id: Model.sonnet55 },
  ];
  expect(shownSessionModels(models, 'in-memory').map(({ id }) => id)).toEqual([
    Model.gpt62Sol,
    Model.sonnet55,
  ]);
  expect(shownSessionModels(models, 'macrod')).toEqual(models);
});
