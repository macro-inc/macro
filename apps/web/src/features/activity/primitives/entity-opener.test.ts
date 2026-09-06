import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { OpenEntityTarget } from '../context/activity-context';
import type { ActivityEntityType } from '../core/event';
import {
  createMockActivityContext,
  type MockActivityContext,
} from '../tests/mock-context';
import { createEntityOpener } from './entity-opener';

function click(shiftKey: boolean) {
  return { shiftKey, preventDefault() {} } as unknown as MouseEvent & {
    currentTarget: HTMLDivElement;
    target: Element;
  };
}

function setup(
  context: MockActivityContext,
  entityType: ActivityEntityType,
  onOpen?: (target: OpenEntityTarget) => void
) {
  return createRoot(() =>
    createEntityOpener(
      context,
      () => 'doc-1',
      () => entityType,
      onOpen
    )
  );
}

describe('createEntityOpener', () => {
  it('hands the host a target, asking for a new split on shift-click', () => {
    const onOpen = vi.fn();
    const opener = setup(createMockActivityContext(), 'document', onOpen);

    opener()?.handlers?.onClick(click(false));
    opener()?.handlers?.onClick(click(true));

    expect(onOpen.mock.calls.map(([target]) => target)).toEqual([
      { block: 'md', id: 'doc-1', params: undefined, newSplit: false },
      { block: 'md', id: 'doc-1', params: undefined, newSplit: true },
    ]);
    expect(opener()?.display.name()).toBe('Entity doc-1');
  });

  it('resolves display without handlers when the host does not open', () => {
    const opener = setup(createMockActivityContext(), 'document');
    expect(opener()?.display.name()).toBe('Entity doc-1');
    expect(opener()?.handlers).toBeUndefined();
  });

  it('is undefined for entity kinds the app cannot link to', () => {
    const opener = setup(
      createMockActivityContext(),
      { kind: 'unsupported', raw: 'TEAM' },
      vi.fn()
    );
    expect(opener()).toBeUndefined();
  });

  it('does nothing when the display has no block mapping', () => {
    const onOpen = vi.fn();
    const context = createMockActivityContext({
      entityDisplay: () => ({
        name: () => 'Team',
        icon: () => null,
        isLoading: () => false,
        blockOrFileType: () => null,
        linkParams: () => undefined,
      }),
    });

    setup(context, 'document', onOpen)()?.handlers?.onClick(click(false));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
