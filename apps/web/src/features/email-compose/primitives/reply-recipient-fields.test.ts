import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailFormRecipients,
  EmailRecipient,
} from '../core/email-recipient';
import { createReplyRecipientFields } from './reply-recipient-fields';

const alice: EmailRecipient = {
  kind: 'custom',
  id: 'alice',
  data: { id: 'alice', email: 'alice@example.com', invalid: false },
};
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});

function setup(initial: EmailFormRecipients) {
  const container = document.createElement('div');
  document.body.append(container);
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [values, setValues] = createSignal(initial);
    const onChange = vi.fn();
    const fields = createReplyRecipientFields({
      values,
      container: () => container,
      disabled: () => false,
      onChange,
      setValues: (field, recipients) =>
        setValues((prev) => ({ ...prev, [field]: recipients })),
    });
    return { dispose, fields, values, onChange, container };
  });
}

describe('reply recipient fields', () => {
  it('moves recipients without duplicating the destination and schedules the change', () => {
    const state = setup({ to: [alice], cc: [alice], bcc: [] });
    state.fields.handleRecipientDrop('cc', alice, 'to');
    expect(state.values()).toEqual({ to: [], cc: [alice], bcc: [] });
    expect(state.fields.showCc()).toBe(true);
    expect(state.onChange).toHaveBeenCalledOnce();
    state.fields.setRecipients('bcc', [alice]);
    expect(state.values().bcc).toEqual([alice]);
    expect(state.onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps the panel open for recipient popovers and releases its outside listener', () => {
    const state = setup({ to: [alice], cc: [alice], bcc: [] });
    const otherPopover = document.createElement('div');
    otherPopover.dataset.popperPositioner = '';
    document.body.append(otherPopover);
    const popover = document.createElement('div');
    popover.dataset.popperPositioner = '';
    document.body.append(popover);
    state.fields.setShowExpandedRecipients(true);
    state.container.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    popover.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(state.fields.showExpandedRecipients()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(state.fields.showExpandedRecipients()).toBe(false);
    expect(state.fields.showCc()).toBe(true);
    expect(state.fields.showBcc()).toBe(false);
    state.dispose();
    state.fields.setShowExpandedRecipients(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(state.fields.showExpandedRecipients()).toBe(true);
  });
});
