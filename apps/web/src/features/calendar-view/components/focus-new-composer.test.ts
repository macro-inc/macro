/**
 * @vitest-environment jsdom
 */

import { EMAIL_COMPOSE_TO_INPUT_ID } from '@app/features/email-compose/core/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusNewComposerTo } from './focus-new-composer';

const mocks = vi.hoisted(() => ({ triggerFocusInput: vi.fn() }));

vi.mock('@core/directive/focusInput', () => ({
  triggerFocusInput: mocks.triggerFocusInput,
}));

function mountToInput() {
  const input = document.createElement('input');
  input.id = EMAIL_COMPOSE_TO_INPUT_ID;
  document.body.append(input);
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('focusNewComposerTo', () => {
  it('waits for the new composer instead of focusing one already open', () => {
    mountToInput();

    focusNewComposerTo();
    const target = mocks.triggerFocusInput.mock.calls[0][0];
    expect(target()).toBeUndefined();

    const opened = mountToInput();
    expect(target()).toBe(opened);
  });
});
