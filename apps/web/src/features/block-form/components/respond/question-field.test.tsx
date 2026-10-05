import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import type { FormCellValue } from '../../core/form-model';
import { QuestionField } from './question-field';

afterEach(cleanup);

it('records a checkbox answer as true or an explicit false once touched, and keeps a saved false', () => {
  const [value, setValue] = createSignal<FormCellValue | undefined>({
    type: 'boolean',
    value: false,
  });
  const changes: (FormCellValue | undefined)[] = [];
  render(() => (
    <QuestionField
      scope="respond-1"
      question={{
        id: 'q-vegan',
        columnId: 'vegan',
        helpText: '',
        required: true,
        widget: null,
      }}
      column={{
        id: 'vegan',
        name: 'Vegan?',
        kind: { type: 'boolean' },
        options: [],
      }}
      widget={null}
      number={1}
      value={value()}
      problem={undefined}
      disabled={false}
      compact={false}
      upload={async () => undefined}
      renderEntityPicker={() => null}
      renderRelationPicker={() => null}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  ));
  const box = screen.getByRole<HTMLInputElement>('checkbox');
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  fireEvent.click(box);
  expect(changes).toEqual([
    { type: 'boolean', value: true },
    { type: 'boolean', value: false },
  ]);
});
