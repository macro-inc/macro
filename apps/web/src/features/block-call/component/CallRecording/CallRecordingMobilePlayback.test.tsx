// @vitest-environment jsdom
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { CallRecordingMobilePlayback } from './CallRecordingMobilePlayback';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@app/features/command/mobile/mobileSearchState', () => ({
  SearchState: { isOpen: () => false },
}));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('./CallRecordingPinnedPlayer', () => ({
  CallRecordingPinnedPlayer: () => <button>Recording controls</button>,
}));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

it('replaces the dock only when scrolling down and restores navigation on teardown', () => {
  const dock = document.createElement('div');
  const accessory = document.createElement('div');
  document.body.append(dock, accessory);
  FloatRegions.setMount('dock', dock);
  FloatRegions.setMount('accessory', accessory);
  render(() => (
    <FloatRegion region="dock">
      <button>Navigation</button>
    </FloatRegion>
  ));
  const [down, setDown] = createSignal(false);
  const [active, setActive] = createSignal(false);
  const player = render(() => (
    <CallRecordingMobilePlayback
      playback={createRecordingPlayback(() => undefined)}
      speaker="Speaker"
      active={active()}
      scrollingDown={down()}
      onShowVideo={() => {}}
    />
  ));
  expect(screen.getByRole('button', { name: 'Navigation' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Recording controls' })
  ).toBeNull();
  setActive(true);
  expect(
    accessory.contains(
      screen.getByRole('button', { name: 'Recording controls' })
    )
  ).toBe(true);
  expect(screen.getByRole('button', { name: 'Navigation' })).toBeTruthy();
  setDown(true);
  expect(
    dock.contains(screen.getByRole('button', { name: 'Recording controls' }))
  ).toBe(true);
  expect(screen.queryByRole('button', { name: 'Navigation' })).toBeNull();
  setDown(false);
  expect(screen.getByRole('button', { name: 'Navigation' })).toBeTruthy();
  player.unmount();
  expect(
    screen.queryByRole('button', { name: 'Recording controls' })
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Navigation' })).toBeTruthy();
});
