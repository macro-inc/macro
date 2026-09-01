/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

function renderCheckbox(as?: 'label') {
  const onChange = vi.fn<(checked: boolean) => void>();
  const { container } = render(() => (
    <Checkbox as={as} checked={false} onChange={onChange}>
      <span>Holidays in United States</span>
      <Checkbox.Control />
    </Checkbox>
  ));
  const control = container.querySelector('[id$="-control"]');
  if (!control) throw new Error('missing checkbox control');
  return { control, onChange };
}

describe('Checkbox', () => {
  it('toggles once when the control is clicked', () => {
    const { control, onChange } = renderCheckbox();
    fireEvent.click(control);
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it('toggles once when the control is clicked inside a label root', () => {
    const { control, onChange } = renderCheckbox('label');
    fireEvent.click(control);
    expect(onChange.mock.calls).toEqual([[true]]);
  });
});
