import type { SplitId } from '@components/app/split-layout/layoutManager';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  activeSplitId: (): string | undefined => undefined,
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ activeSplitId: () => host.activeSplitId() }),
}));

import {
  activeCreateDestination,
  type CreateDestination,
  createMenuHint,
  registerCreateDestination,
} from './create-destination';

const projectSplit = 'project-split' as SplitId;
const otherSplit = 'other-split' as SplitId;

function destination(label = 'Launch'): CreateDestination {
  return { label, taskComposer: {} };
}

const cleanups: (() => void)[] = [];
function register(
  splitId: SplitId,
  value: () => CreateDestination | undefined
) {
  const unregister = registerCreateDestination(splitId, value);
  cleanups.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  host.activeSplitId = () => undefined;
});

describe('create destinations', () => {
  it('belong to the active split only', () => {
    const launch = destination();
    register(projectSplit, () => launch);

    host.activeSplitId = () => projectSplit;
    expect(activeCreateDestination()).toBe(launch);

    host.activeSplitId = () => otherSplit;
    expect(activeCreateDestination()).toBeUndefined();

    host.activeSplitId = () => undefined;
    expect(activeCreateDestination()).toBeUndefined();
  });

  it('are withdrawn when their split stops showing them', () => {
    host.activeSplitId = () => projectSplit;
    const unregister = register(projectSplit, () => destination());
    unregister();
    expect(activeCreateDestination()).toBeUndefined();
  });

  it('keep a remounted destination when the previous one cleans up late', () => {
    host.activeSplitId = () => projectSplit;
    const previous = register(projectSplit, () => destination('Old'));
    const next = destination('New');
    register(projectSplit, () => next);
    previous();
    expect(activeCreateDestination()).toBe(next);
  });

  it('follow registration, the destination and the active split reactively', () => {
    const [active, setActive] = createSignal<string | undefined>(otherSplit);
    const [label, setLabel] = createSignal<string | undefined>(undefined);
    host.activeSplitId = active;

    createRoot((dispose) => {
      const current = createMemo(() => activeCreateDestination()?.label);
      expect(current()).toBeUndefined();
      setActive(projectSplit);
      expect(current()).toBeUndefined();
      const unregister = register(projectSplit, () => {
        const name = label();
        return name ? destination(name) : undefined;
      });
      expect(current()).toBeUndefined();
      setLabel('Launch');
      expect(current()).toBe('Launch');
      setLabel('Renamed');
      expect(current()).toBe('Renamed');
      setActive(otherSplit);
      expect(current()).toBeUndefined();
      setActive(projectSplit);
      expect(current()).toBe('Renamed');
      unregister();
      expect(current()).toBeUndefined();
      dispose();
    });
  });
});

describe('create menu hints', () => {
  const launcherHint = 'Something to do';

  it('say where an entry creates in place of its launcher hint', () => {
    expect(
      createMenuHint({ launcherHint, destinationHint: () => 'In Launch' })
    ).toBe('In Launch');
  });

  it('fall back to the launcher hint without a destination', () => {
    expect(
      createMenuHint({ launcherHint, destinationHint: () => undefined })
    ).toBe(launcherHint);
    expect(createMenuHint({})).toBeUndefined();
  });
});
