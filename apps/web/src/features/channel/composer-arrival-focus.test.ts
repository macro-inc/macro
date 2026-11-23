import type {
  NavigationCause,
  ReferredFrom,
} from '@components/app/split-layout/layoutManager';
import { setLastExecutedCommand } from '@core/hotkey/state';
import type { ValidHotkey } from '@core/hotkey/types';
import { afterEach, describe, expect, it } from 'vitest';
import { arrivalFocusesComposer } from './composer-arrival-focus';

const arrival = (
  source: ReferredFrom = null,
  cause: NavigationCause = 'fresh'
) => ({
  lastNavigationSource: () => source,
  lastNavigationCause: () => cause,
});

const lastPressed = (hotkey: ValidHotkey) =>
  setLastExecutedCommand({
    scopeId: 'list',
    hotkeys: [hotkey],
    description: 'Test command',
    runWithInputFocused: false,
  });

const setModality = (modality: 'mouse' | 'keyboard' | 'touch') => {
  document.documentElement.dataset.modality = modality;
};

afterEach(() => {
  delete document.documentElement.dataset.modality;
  setLastExecutedCommand(undefined);
});

describe('composer focus when a conversation opens', () => {
  it('focuses the composer of a conversation opened with a click', () => {
    setModality('mouse');
    expect(arrivalFocusesComposer(arrival())).toBe(true);
    expect(arrivalFocusesComposer(arrival('search'))).toBe(true);
  });

  it('focuses the composer of a conversation opened with Enter', () => {
    setModality('keyboard');
    lastPressed('enter');
    expect(arrivalFocusesComposer(arrival())).toBe(true);
    lastPressed('shift+enter');
    expect(arrivalFocusesComposer(arrival('home'))).toBe(true);
  });

  it('leaves focus in the list while arrowing or j/k previews', () => {
    setModality('keyboard');
    lastPressed('j');
    expect(arrivalFocusesComposer(arrival())).toBe(false);
    lastPressed('arrowdown');
    expect(arrivalFocusesComposer(arrival())).toBe(false);
  });

  it('focuses the composer after Cmd+K, whatever key closed the menu', () => {
    setModality('keyboard');
    expect(arrivalFocusesComposer(arrival('kommand-menu'))).toBe(true);
  });

  it('never focuses the composer after a tap', () => {
    setModality('touch');
    expect(arrivalFocusesComposer(arrival())).toBe(false);
    expect(arrivalFocusesComposer(arrival('kommand-menu'))).toBe(false);
  });

  it('leaves focus alone on Back and Forward', () => {
    setModality('mouse');
    expect(arrivalFocusesComposer(arrival(null, 'history-back'))).toBe(false);
    expect(arrivalFocusesComposer(arrival(null, 'history-forward'))).toBe(
      false
    );
  });

  it('leaves focus alone when switching to a view restores its conversation', () => {
    setModality('mouse');
    expect(arrivalFocusesComposer(arrival('sidebar'))).toBe(false);
    setModality('keyboard');
    expect(arrivalFocusesComposer(arrival('hotkey'))).toBe(false);
  });

  it('leaves focus alone on a page load before any input', () => {
    expect(arrivalFocusesComposer(arrival())).toBe(false);
  });
});
