import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityEntityType } from '../core/event';
import type { OpenEntityTarget } from '../deps';
import {
  createMockActivityDeps,
  type MockActivityDeps,
} from '../testing/mock-deps';
import { createEntityOpener } from './entity-opener';

function click(shiftKey: boolean) {
  return { shiftKey, preventDefault() {} } as unknown as MouseEvent & {
    currentTarget: HTMLDivElement;
    target: Element;
  };
}

function setup(
  deps: MockActivityDeps,
  entityType: ActivityEntityType,
  onOpen?: (target: OpenEntityTarget) => void
) {
  return createRoot(() =>
    createEntityOpener(
      deps,
      () => 'doc-1',
      () => entityType,
      onOpen
    )
  );
}

describe('createEntityOpener', () => {
  it('hands the host a target, asking for a new split on shift-click', () => {
    const onOpen = vi.fn();
    const opener = setup(createMockActivityDeps(), 'document', onOpen);

    opener()?.handlers?.onClick(click(false));
    opener()?.handlers?.onClick(click(true));

    expect(onOpen.mock.calls.map(([target]) => target)).toEqual([
      { block: 'md', id: 'doc-1', params: undefined, newSplit: false },
      { block: 'md', id: 'doc-1', params: undefined, newSplit: true },
    ]);
    expect(opener()?.display.name()).toBe('Entity doc-1');
  });

  it('resolves display without handlers when the host does not open', () => {
    const opener = setup(createMockActivityDeps(), 'document');
    expect(opener()?.display.name()).toBe('Entity doc-1');
    expect(opener()?.handlers).toBeUndefined();
  });

  it('is undefined for entity kinds the app cannot link to', () => {
    const opener = setup(
      createMockActivityDeps(),
      { kind: 'unsupported', raw: 'TEAM' },
      vi.fn()
    );
    expect(opener()).toBeUndefined();
  });

  it('does nothing when the display has no block mapping', () => {
    const onOpen = vi.fn();
    const deps = createMockActivityDeps({
      entityDisplay: () => ({
        name: () => 'Team',
        icon: () => null,
        isLoading: () => false,
        blockOrFileType: () => null,
        linkParams: () => undefined,
      }),
    });

    setup(deps, 'document', onOpen)()?.handlers?.onClick(click(false));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
