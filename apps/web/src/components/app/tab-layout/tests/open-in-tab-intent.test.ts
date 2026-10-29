import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeOpenInNewTabIntent,
  disarmOpenInNewTabIntent,
  installOpenInNewTabIntentTracker,
} from '../open-in-tab-intent';

// IS_MAC is false under jsdom, so the modifier is ctrl.
function press(options: { ctrl?: boolean; shift?: boolean } = {}) {
  document.body.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      ctrlKey: options.ctrl ?? true,
      shiftKey: options.shift ?? false,
    })
  );
}

function click(options: { ctrl?: boolean; shift?: boolean } = {}) {
  document.body.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      button: 0,
      ctrlKey: options.ctrl ?? true,
      shiftKey: options.shift ?? false,
    })
  );
}

let uninstall: () => void;

beforeEach(() => {
  uninstall = installOpenInNewTabIntentTracker();
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('open-in-new-tab intent', () => {
  it('a ctrl+click arms once and consuming is one-shot', () => {
    press();
    click();
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: false });
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });

  it('shift asks for the new tab to be activated', () => {
    press({ shift: true });
    click({ shift: true });
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: true });
  });

  it('a click without the modifier does not arm', () => {
    press({ ctrl: false });
    click({ ctrl: false });
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });

  it('the trailing click cannot re-arm a gesture whose press was consumed', () => {
    // Sidebar list rows navigate on the press and ignore the click
    // (list-nav.tsx): the middleware consumes between the two events.
    press();
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: false });

    click();
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });

  it('a new press after a consumed gesture arms again', () => {
    press();
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: false });
    click();

    press();
    click();
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: false });
  });

  it('a keyboard-generated click after a consumed press gesture still arms', () => {
    // Press gesture: navigate on the press, trailing click suppressed.
    press();
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: false });
    click();
    expect(consumeOpenInNewTabIntent()).toBeUndefined();

    // A click with no pointerdown (keyboard activation) is a new intent.
    click();
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: false });
  });

  it('disarm clears a pending intent', () => {
    press();
    click();
    disarmOpenInNewTabIntent();
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });

  it('an intent expires', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1_000);
    press();
    click();
    now.mockReturnValue(2_000);
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });

  it('clicks inside the tab strip never arm', () => {
    const strip = document.createElement('div');
    strip.setAttribute('data-desktop-tab-strip', '');
    document.body.appendChild(strip);
    strip.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true })
    );
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
    strip.remove();
  });
});
