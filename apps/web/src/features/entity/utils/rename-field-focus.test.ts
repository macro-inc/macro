/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENAME_FIELD_ATTRIBUTE,
  raiseKeyboardForRenameField,
} from './rename-field-focus';

const mocks = vi.hoisted(() => ({
  triggerFocusInput: vi.fn(),
  isTouchDevice: vi.fn(() => true),
}));

vi.mock('@core/directive/focusInput', () => ({
  focusStandInActive: () => false,
  triggerFocusInput: mocks.triggerFocusInput,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: mocks.isTouchDevice,
}));

function mountRenameField() {
  const input = document.createElement('input');
  input.setAttribute(RENAME_FIELD_ATTRIBUTE, '');
  document.body.append(input);
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('raiseKeyboardForRenameField', () => {
  it('waits for the opening dialog’s field, not one already on the page', () => {
    mountRenameField();

    raiseKeyboardForRenameField();
    const target = mocks.triggerFocusInput.mock.calls[0][0];
    expect(target()).toBeUndefined();

    const opened = mountRenameField();
    expect(target()).toBe(opened);
  });

  it('leaves focus alone without a touch screen', () => {
    mocks.isTouchDevice.mockReturnValueOnce(false);

    raiseKeyboardForRenameField();

    expect(mocks.triggerFocusInput).not.toHaveBeenCalled();
  });
});
