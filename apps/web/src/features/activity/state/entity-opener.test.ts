import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { ActivityEntityType } from '../core/event';
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

function setup(deps: MockActivityDeps, entityType: ActivityEntityType) {
  return createRoot(() =>
    createEntityOpener(
      deps,
      () => 'doc-1',
      () => entityType
    )
  );
}

describe('createEntityOpener', () => {
  it('opens the resolved block, in a new split on shift-click', () => {
    const deps = createMockActivityDeps();
    const opener = setup(deps, 'document');

    opener()?.handlers.onClick(click(false));
    opener()?.handlers.onClick(click(true));

    expect(deps.opened).toEqual([
      { block: 'md', id: 'doc-1', params: undefined, newSplit: false },
      { block: 'md', id: 'doc-1', params: undefined, newSplit: true },
    ]);
    expect(opener()?.display.name()).toBe('Entity doc-1');
  });

  it('is undefined for entity kinds the app cannot link to', () => {
    const deps = createMockActivityDeps();
    expect(setup(deps, { kind: 'unsupported', raw: 'TEAM' })()).toBeUndefined();
  });

  it('does nothing when the display has no block mapping', () => {
    const deps = createMockActivityDeps({
      entityDisplay: () => ({
        name: () => 'Team',
        icon: () => null,
        isLoading: () => false,
        blockOrFileType: () => null,
        linkParams: () => undefined,
      }),
    });
    const opener = setup(deps, 'document');

    opener()?.handlers.onClick(click(false));

    expect(deps.opened).toEqual([]);
  });
});
