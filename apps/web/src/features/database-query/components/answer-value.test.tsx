import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { type ResultCell, unknownNames } from '../core/answer-cell';
import { plainAnswerRenderers } from '../tests/plain-answer-display';
import { ResultValue } from './answer-value';

it('shows a live answer’s new value when its text or markdown cell changes', () => {
  const [cell, setCell] = createSignal<ResultCell>({ kind: 'text', text: '7' });
  const result = render(() => (
    <ResultValue
      cell={cell()}
      names={unknownNames}
      display={plainAnswerRenderers}
    />
  ));
  expect(result.container.textContent).toBe('7');

  setCell({ kind: 'text', text: '8' });
  expect(result.container.textContent).toBe('8');

  setCell({ kind: 'markdown', markdown: 'Summer BBQ' });
  expect(result.container.textContent).toBe('Summer BBQ');
  setCell({ kind: 'markdown', markdown: 'Winter Gala' });
  expect(result.container.textContent).toBe('Winter Gala');
});
