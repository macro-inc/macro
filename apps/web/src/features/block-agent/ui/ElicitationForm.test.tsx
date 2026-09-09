/** @vitest-environment jsdom */

import type { ElicitationSchema } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialValues, toContent, validate } from '../state/elicitation-form';
import { ElicitationForm } from './ElicitationForm';

// These cases exercise the real radio and text inputs, without loading the
// unrelated checkbox's UI dependencies.
vi.mock('@ui', () => ({ Checkbox: () => null }));

afterEach(cleanup);

function question(customField: string | null): ElicitationSchema {
  return {
    title: null,
    description: null,
    required: ['colour'],
    properties: [
      {
        name: 'colour',
        title: 'Colour',
        description: null,
        schema: {
          type: 'string',
          minLength: null,
          maxLength: null,
          pattern: null,
          format: null,
          default: 'red',
          options: [
            { value: 'red', title: 'Red', description: null },
            { value: '__custom', title: 'A literal option', description: null },
          ],
          customField,
        },
      },
    ],
  };
}

function form(schema: ElicitationSchema) {
  return render(() => {
    const [values, setValues] = createStore(initialValues(schema));
    return (
      <>
        <ElicitationForm
          schema={schema}
          values={values}
          errors={validate(schema, values)}
          onChange={(name, value) => setValues(name, value)}
        />
        <output data-testid="answer">
          {JSON.stringify(toContent(schema, values))}
        </output>
      </>
    );
  });
}

describe('single-choice elicitation', () => {
  it('switches from the default option to empty Other, custom text, and back', () => {
    const view = form(question('colour_custom'));
    const red = view.getByRole('radio', { name: 'Red' }) as HTMLInputElement;
    const other = view.getByRole('radio', {
      name: 'Other',
    }) as HTMLInputElement;
    const text = view.getByPlaceholderText(
      'Type your own answer'
    ) as HTMLInputElement;
    const answer = () => JSON.parse(view.getByTestId('answer').textContent!);

    expect(red.checked).toBe(true);
    expect(answer()).toEqual({ colour: 'red' });

    fireEvent.click(other);
    expect(other.checked).toBe(true);
    expect(red.checked).toBe(false);
    expect(view.getByText('Required')).toBeTruthy();
    expect(answer()).toEqual({});

    fireEvent.input(text, { target: { value: 'teal' } });
    expect(other.checked).toBe(true);
    expect(view.queryByText('Required')).toBeNull();
    expect(answer()).toEqual({ colour_custom: 'teal' });

    fireEvent.click(red);
    expect(red.checked).toBe(true);
    expect(other.checked).toBe(false);
    expect(text.value).toBe('');
    expect(answer()).toEqual({ colour: 'red' });
  });

  it('typing directly selects Other and keeps an empty Other selected', () => {
    const view = form(question('colour_custom'));
    const text = view.getByPlaceholderText('Type your own answer');
    const other = view.getByRole('radio', {
      name: 'Other',
    }) as HTMLInputElement;
    fireEvent.input(text, { target: { value: 'teal' } });
    expect(other.checked).toBe(true);
    fireEvent.input(text, { target: { value: '' } });
    expect(other.checked).toBe(true);
    expect(view.getByText('Required')).toBeTruthy();
    expect(view.getByTestId('answer').textContent).toBe('{}');
  });

  it('only renders Other when allowed, and treats __custom as an ordinary option value', () => {
    const view = form(question(null));
    expect(view.queryByRole('radio', { name: 'Other' })).toBeNull();
    expect(view.queryByPlaceholderText('Type your own answer')).toBeNull();
    fireEvent.click(view.getByRole('radio', { name: 'A literal option' }));
    expect(JSON.parse(view.getByTestId('answer').textContent!)).toEqual({
      colour: '__custom',
    });
  });
});
