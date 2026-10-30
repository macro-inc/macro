import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { triggerScope } from '../core/step-catalog';
import { FieldText } from './routine-field-text';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

function mount(value: string) {
  const onChange = vi.fn();
  render(() => (
    <FieldText
      label="Title"
      value={value}
      scope={triggerScope('email')}
      onChange={onChange}
    />
  ));
  return { box: screen.getByRole('textbox', { name: 'Title' }), onChange };
}

function selectAll(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('field text', () => {
  it('shows fields as chips and copies them as their placeholders', () => {
    const { box } = mount('Pay {{trigger.email.subject}} now');
    expect(box.textContent).toContain('Email subject');
    selectAll(box);
    const setData = vi.fn();
    fireEvent.copy(box, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      'Pay {{trigger.email.subject}} now'
    );
  });

  it('keeps pasted placeholders as fields, not their labels', () => {
    const { box, onChange } = mount('');
    selectAll(box);
    fireEvent.paste(box, {
      clipboardData: { getData: () => 'Due {{trigger.email.subject}}' },
    });
    expect(onChange).toHaveBeenLastCalledWith('Due {{trigger.email.subject}}');
  });
});
