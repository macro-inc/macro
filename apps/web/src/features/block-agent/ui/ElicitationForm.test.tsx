/** @vitest-environment jsdom */

import type { ElicitationSchema } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it } from 'vitest';
import { initialValues, toContent, validate } from '../state/elicitation-form';
import { ElicitationForm } from './ElicitationForm';

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

function regions(customField: string | null): ElicitationSchema {
  return {
    title: null,
    description: null,
    required: [],
    properties: [
      {
        name: 'regions',
        title: 'Regions',
        description: null,
        schema: {
          type: 'multi_select',
          minItems: null,
          maxItems: null,
          default: ['us'],
          options: [
            { value: 'us', title: 'US', description: null },
            { value: 'eu', title: 'EU', description: null },
          ],
          customField,
        },
      },
    ],
  };
}

function form(schema: ElicitationSchema) {
  const view = render(() => {
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
  const answer = () => JSON.parse(view.getByTestId('answer').textContent!);
  const checked = (element: HTMLElement) =>
    element.getAttribute('aria-checked') === 'true';
  return { ...view, answer, checked };
}

describe('single-choice elicitation', () => {
  it('switches from the default option to empty Other, custom text, and back', () => {
    const view = form(question('colour_custom'));
    const red = view.getByRole('radio', { name: 'Red' });
    const other = view.getByRole('radio', { name: 'Other' });
    const text = view.getByPlaceholderText(
      'Type your own answer'
    ) as HTMLInputElement;

    expect(view.checked(red)).toBe(true);
    expect(view.answer()).toEqual({ colour: 'red' });

    fireEvent.click(other);
    expect(view.checked(other)).toBe(true);
    expect(view.checked(red)).toBe(false);
    expect(view.getByText('Required')).toBeTruthy();
    expect(view.answer()).toEqual({});

    fireEvent.input(text, { target: { value: 'teal' } });
    expect(view.checked(other)).toBe(true);
    expect(view.queryByText('Required')).toBeNull();
    expect(view.answer()).toEqual({ colour_custom: 'teal' });

    // Pressing Other again keeps what was typed.
    fireEvent.click(other);
    expect(text.value).toBe('teal');

    fireEvent.click(red);
    expect(view.checked(red)).toBe(true);
    expect(view.checked(other)).toBe(false);
    expect(text.value).toBe('');
    expect(view.answer()).toEqual({ colour: 'red' });
  });

  it('is one tab stop whose arrow keys move the choice, Other included', () => {
    const view = form(question('colour_custom'));
    const red = view.getByRole('radio', { name: 'Red' });
    const literal = view.getByRole('radio', { name: 'A literal option' });
    const other = view.getByRole('radio', { name: 'Other' });
    expect(red.tabIndex).toBe(0);
    expect(literal.tabIndex).toBe(-1);
    expect(other.tabIndex).toBe(-1);
    expect(view.getByRole('radiogroup').getAttribute('aria-labelledby')).toBe(
      view.getByText('Colour').id
    );

    fireEvent.keyDown(red, { key: 'ArrowDown' });
    expect(view.checked(literal)).toBe(true);
    expect(literal.tabIndex).toBe(0);
    expect(red.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(literal);

    fireEvent.keyDown(literal, { key: 'ArrowDown' });
    expect(view.checked(other)).toBe(true);
    expect(view.answer()).toEqual({});

    // Wraps, and the Other text box keeps its own arrows.
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(view.checked(red)).toBe(true);
    fireEvent.click(other);
    fireEvent.keyDown(view.getByPlaceholderText('Type your own answer'), {
      key: 'ArrowUp',
    });
    expect(view.checked(other)).toBe(true);
  });

  it('typing directly selects Other and keeps an empty Other selected', () => {
    const view = form(question('colour_custom'));
    const text = view.getByPlaceholderText('Type your own answer');
    const other = view.getByRole('radio', { name: 'Other' });
    fireEvent.input(text, { target: { value: 'teal' } });
    expect(view.checked(other)).toBe(true);
    fireEvent.input(text, { target: { value: '' } });
    expect(view.checked(other)).toBe(true);
    expect(view.getByText('Required')).toBeTruthy();
    expect(view.getByTestId('answer').textContent).toBe('{}');
  });

  it('only renders Other when allowed, and treats __custom as an ordinary option value', () => {
    const view = form(question(null));
    expect(view.queryByRole('radio', { name: 'Other' })).toBeNull();
    expect(view.queryByPlaceholderText('Type your own answer')).toBeNull();
    fireEvent.click(view.getByRole('radio', { name: 'A literal option' }));
    expect(view.answer()).toEqual({ colour: '__custom' });
  });
});

describe('multi-choice elicitation', () => {
  it('toggles options and never sends them alongside a custom answer', () => {
    const view = form(regions('regions_custom'));
    const us = view.getByRole('checkbox', { name: 'US' });
    const eu = view.getByRole('checkbox', { name: 'EU' });
    const other = view.getByRole('checkbox', { name: 'Other' });
    const text = view.getByPlaceholderText('Type your own answer');

    expect(view.checked(us)).toBe(true);
    expect(view.answer()).toEqual({ regions: ['us'] });

    fireEvent.click(eu);
    expect(view.answer()).toEqual({ regions: ['us', 'eu'] });

    fireEvent.input(text, { target: { value: 'mars' } });
    expect(view.checked(other)).toBe(true);
    expect(view.checked(us)).toBe(false);
    expect(view.answer()).toEqual({ regions_custom: 'mars' });

    fireEvent.click(us);
    expect(view.checked(other)).toBe(false);
    expect(view.answer()).toEqual({ regions: ['us'] });
  });

  it('has no Other row when the schema allows none', () => {
    const view = form(regions(null));
    expect(view.queryByRole('checkbox', { name: 'Other' })).toBeNull();
  });
});
