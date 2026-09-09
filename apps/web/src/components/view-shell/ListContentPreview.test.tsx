/** @vitest-environment jsdom */

import { RightPanelOwnerContext } from '@components/app/right-panel-owner';
import type { EntityData } from '@entity';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: { isControllerSplit: () => false },
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: mocks.handle }),
}));
vi.mock('@components/app/PreviewPanel', () => ({
  PreviewPanel: (props: any) => (
    <article>
      {props.headerPrefix}
      <h2>{props.selectedEntity.name}</h2>
    </article>
  ),
}));

import { ListContentPreview } from './ListContentPreview';
import { openListPreview } from './list-preview-navigation';

afterEach(cleanup);
it('keeps sidebar navigation, replaces the list, and restores it from the breadcrumb', () => {
  let listDisposed = false;
  let owner: (() => string) | undefined;
  const screen = render(() => {
    const [view, setView] = createSignal('Drafts');
    return (
      <>
        <button onClick={() => setView('Sent')}>Sent sidebar</button>
        <RightPanelOwnerContext.Provider
          value={(value) => {
            owner = value;
            return () => {
              owner = undefined;
            };
          }}
        >
          <ListContentPreview title={view()} viewKey={view()}>
            {() => {
              onCleanup(() => {
                listDisposed = true;
              });
              return (
                <button
                  onClick={() =>
                    openListPreview(
                      {
                        type: 'email',
                        id: 'draft',
                        name: 'Proposal',
                      } as EntityData,
                      { splitHandle: mocks.handle as any }
                    )
                  }
                >
                  Open item
                </button>
              );
            }}
          </ListContentPreview>
        </RightPanelOwnerContext.Provider>
      </>
    );
  });
  expect(owner?.()).toBe('list:Drafts');
  fireEvent.click(screen.getByText('Open item'));
  expect(owner?.()).toBe('email:draft');
  expect(screen.getByText('Sent sidebar')).toBeTruthy();
  expect(screen.queryByText('Open item')).toBeNull();
  expect(listDisposed).toBe(true);
  expect(screen.getByRole('heading').textContent).toBe('Proposal');
  fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
  expect(owner?.()).toBe('list:Drafts');
  expect(screen.getByText('Open item')).toBeTruthy();
  fireEvent.click(screen.getByText('Open item'));
  fireEvent.click(screen.getByText('Sent sidebar'));
  expect(owner?.()).toBe('list:Sent');
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByText('Open item')).toBeTruthy();
});
