import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { cleanup, render } from '@solidjs/testing-library';
import { type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoupEntityActionsMenu } from './SoupEntityActionsMenu';

type TestGroup = {
  items: { id: string; label: string; onClick: () => void }[];
};

const actions = vi.hoisted(() => ({
  groups: [] as TestGroup[],
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'channels', id: 'chat' }) },
  }),
}));
vi.mock('./createSoupEntityActions', () => ({
  createSoupEntityActions: () => ({
    buildActionGroups: () => actions.groups,
  }),
  viewedProjectIdFromContent: () => undefined,
}));
vi.mock('@core/component/ContextMenu', () => ({
  MenuItem: (props: { text: string }) => (
    <button type="button">{props.text}</button>
  ),
  MenuSeparator: () => <hr />,
}));

const group = (...labels: string[]): TestGroup => ({
  items: labels.map((label) => ({ id: label, label, onClick: () => {} })),
});

const viewContext: EntityActionViewContext = {
  supportsMarkDone: false,
  senderBucket: undefined,
};

const renderMenu = (extraItems?: () => JSX.Element) =>
  render(() => (
    <SoupEntityActionsMenu
      entities={[]}
      list={{} as EntityActionListState}
      viewContext={viewContext}
      extraItems={extraItems?.()}
    />
  ));

beforeEach(() => {
  actions.groups = [group('Favorite'), group('Delete')];
});
afterEach(cleanup);

describe('SoupEntityActionsMenu separators', () => {
  it('separates action groups without trailing the last one', () => {
    const view = renderMenu();

    expect(view.container.querySelectorAll('hr')).toHaveLength(1);
  });

  it('omits the separator when a host\u2019s extra items render nothing', () => {
    const view = renderMenu(() => (
      <Show when={false}>
        <button type="button">Move to label</button>
      </Show>
    ));

    expect(view.container.querySelectorAll('hr')).toHaveLength(1);
    expect(view.container.textContent).toBe('FavoriteDelete');
  });

  it('separates extra items that do render', () => {
    const view = renderMenu(() => (
      <Show when={true}>
        <button type="button">Move to label</button>
      </Show>
    ));

    expect(view.container.querySelectorAll('hr')).toHaveLength(2);
    expect(view.container.textContent).toBe('FavoriteDeleteMove to label');
  });

  it('leads with extra items alone when the entity has no actions', () => {
    actions.groups = [];
    const view = renderMenu(() => <button type="button">Move to label</button>);

    expect(view.container.querySelectorAll('hr')).toHaveLength(0);
    expect(view.container.textContent).toBe('Move to label');
  });
});
