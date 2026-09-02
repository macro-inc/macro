import { describe, expect, it } from 'vitest';
import { createFakeActivityDeps } from '../testing/fake-deps';
import { createEntityOpener } from './entity-opener';

function click(shiftKey: boolean) {
  return { shiftKey, preventDefault() {} } as unknown as MouseEvent & {
    currentTarget: HTMLDivElement;
    target: Element;
  };
}

describe('createEntityOpener', () => {
  it('opens the resolved block, in a new split on shift-click', () => {
    const deps = createFakeActivityDeps();
    const opener = createEntityOpener(
      deps,
      () => 'doc-1',
      () => 'DOCUMENT'
    );

    opener.handlers.onClick(click(false));
    opener.handlers.onClick(click(true));

    expect(deps.opened).toEqual([
      { block: 'md', id: 'doc-1', params: undefined, newSplit: false },
      { block: 'md', id: 'doc-1', params: undefined, newSplit: true },
    ]);
    expect(opener.display.name()).toBe('Entity doc-1');
  });

  it('does nothing for entities without a block mapping', () => {
    const deps = createFakeActivityDeps({
      entityDisplay: () => ({
        name: () => 'Team',
        icon: () => null,
        isLoading: () => false,
        blockOrFileType: () => null,
        linkParams: () => undefined,
      }),
    });
    const opener = createEntityOpener(
      deps,
      () => 'team-1',
      () => 'DOCUMENT'
    );

    opener.handlers.onClick(click(false));

    expect(deps.opened).toEqual([]);
  });
});
