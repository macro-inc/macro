import type { ListView } from '@app/constants/list-views';
import { SortDropdown } from '@app/features/next-soup/soup-view/filters-bar/sort-dropdown';
import {
  CHANNEL_SORT_OPTIONS,
  DEFAULT_SORT_OPTIONS,
  DOCUMENT_SORT_OPTIONS,
  EMAIL_SORT_OPTIONS,
  type SortOption,
  type SystemSortOption,
  TASK_SORT_OPTIONS,
} from '@app/features/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Switch,
} from 'solid-js';

type SortOpenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hideLabel?: boolean;
};

export const SoupViewContextSort = (
  props: { hideLabel?: boolean } = {}
) => {
  const panel = useSplitPanelOrThrow();

  const [sortOpen, setSortOpen] = createSignal(false);

  const sortHotkeyRegistration = registerHotkey({
    hotkey: 's',
    scopeId: panel.splitHotkeyScope,
    description: 'Open sort menu',
    hotkeyToken: TOKENS.soup.sort,
    keyDownHandler: () => {
      setSortOpen(true);
      return true;
    },
  });

  onCleanup(sortHotkeyRegistration.dispose);

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  const openProps = (): SortOpenProps => ({
    open: sortOpen(),
    onOpenChange: setSortOpen,
    hideLabel: props.hideLabel,
  });

  return (
    <Switch>
      <Match when={isComponentListView('inbox')}>
        <InboxSort {...openProps()} />
      </Match>
      <Match when={isComponentListView('agents')}>
        <AgentsSort {...openProps()} />
      </Match>
      <Match when={isComponentListView('mail')}>
        <MailSort {...openProps()} />
      </Match>
      <Match when={isComponentListView('documents')}>
        <DocumentsSort {...openProps()} />
      </Match>
      <Match when={isComponentListView('tasks')}>
        <TasksSort {...openProps()} />
      </Match>
      <Match when={isComponentListView('channels')}>
        <ChannelsSort {...openProps()} />
      </Match>
      <Match when={isComponentListView('folders')}>
        <FilesSort {...openProps()} />
      </Match>
      <Match when={component() === 'tag'}>
        <FilesSort {...openProps()} />
      </Match>
    </Switch>
  );
};

const useSortDropdown = (options: SortOption[] = DEFAULT_SORT_OPTIONS) => {
  const { soup } = useSoupView();

  const value = createMemo(
    () => (soup.sort.active()[0]?.id as SystemSortOption) ?? 'updated_at'
  );

  const onChange = (sortOption: SystemSortOption) => {
    soup.sort.setAll([sortOption]);
  };

  return { value, onChange, options };
};

const ViewSort = (
  props: SortOpenProps & { options?: SortOption[] }
) => {
  const sort = useSortDropdown(props.options);

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
      open={props.open}
      onOpenChange={props.onOpenChange}
      hideLabel={props.hideLabel}
    />
  );
};

const InboxSort = (props: SortOpenProps) => <ViewSort {...props} />;
const AgentsSort = (props: SortOpenProps) => <ViewSort {...props} />;
const MailSort = (props: SortOpenProps) => (
  <ViewSort {...props} options={EMAIL_SORT_OPTIONS} />
);
const DocumentsSort = (props: SortOpenProps) => (
  <ViewSort {...props} options={DOCUMENT_SORT_OPTIONS} />
);
const TasksSort = (props: SortOpenProps) => (
  <ViewSort {...props} options={TASK_SORT_OPTIONS} />
);
const ChannelsSort = (props: SortOpenProps) => (
  <ViewSort {...props} options={CHANNEL_SORT_OPTIONS} />
);
const FilesSort = (props: SortOpenProps) => <ViewSort {...props} />;
