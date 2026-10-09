import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import { cleanup, render } from '@solidjs/testing-library';
import { type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoupEntityActionsMenu } from './SoupEntityActionsMenu';

type TestGroup = {
  items: { id: string; label: string; onClick: () => void }[];
};

const actions = vi.hoisted(() => ({
  groups: [] as TestGroup[],
  options: undefined as
    | { markDoneDelegate?: () => MarkDoneDelegate | undefined }
    | undefined,
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'channels', id: 'chat' }) },
  }),
}));
vi.mock('./createSoupEntityActions', () => ({
  createSoupEntityActions: (options?: typeof actions.options) => {
    actions.options = options;
    return { buildActionGroups: () => actions.groups };
  },
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
  supportsOpenInNewSplit: true,
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
  actions.options = undefined;
});

describe('SoupEntityActionsMenu mark done', () => {
  it('completes rows through the list that owns them', () => {
    const delegate = {
      canComplete: () => true,
      prepare: () => undefined,
    } satisfies MarkDoneDelegate;
    render(() => (
      <SoupEntityActionsMenu
        entities={[]}
        list={{} as EntityActionListState}
        viewContext={viewContext}
        markDoneDelegate={() => delegate}
      />
    ));

    expect(actions.options?.markDoneDelegate?.()).toBe(delegate);
  });
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
