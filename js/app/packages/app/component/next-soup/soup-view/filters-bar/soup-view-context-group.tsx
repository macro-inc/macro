import { GroupDropdown } from '@app/component/next-soup/soup-view/filters-bar/group-dropdown';
import {
  DEFAULT_GROUP_OPTIONS,
  EMAIL_GROUP_OPTIONS,
  type GroupOption,
  type GroupOptionId,
  INBOX_GROUP_OPTIONS,
  TASK_GROUP_OPTIONS,
} from '@app/component/next-soup/soup-view/group-options';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { createMemo, createSignal, Match, Switch } from 'solid-js';

type GroupOpenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const SoupViewContextGroup = () => {
  const panel = useSplitPanelOrThrow();

  const [groupOpen, setGroupOpen] = createSignal(false);

  registerHotkey({
    hotkey: 'g',
    scopeId: panel.splitHotkeyScope,
    description: 'Open group menu',
    keyDownHandler: () => {
      setGroupOpen(true);
      return true;
    },
  });

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  const openProps = (): GroupOpenProps => ({
    open: groupOpen(),
    onOpenChange: setGroupOpen,
  });

  return (
    <Switch>
      <Match when={isComponentListView('tasks')}>
        <TasksGroup {...openProps()} />
      </Match>
      <Match when={isComponentListView('inbox')}>
        <InboxGroup {...openProps()} />
      </Match>
      <Match when={isComponentListView('mail')}>
        <MailGroup {...openProps()} />
      </Match>
      <Match when={isComponentListView('documents')}>
        <DefaultGroup {...openProps()} />
      </Match>
      <Match when={isComponentListView('channels')}>
        <DefaultGroup {...openProps()} />
      </Match>
    </Switch>
  );
};

const useGroupDropdown = (options: GroupOption[] = DEFAULT_GROUP_OPTIONS) => {
  const { soup } = useSoupView();

  const value = createMemo(
    (): GroupOptionId =>
      (soup.grouping.activeGroupId() as GroupOptionId) ?? 'none'
  );

  const onChange = (groupOption: GroupOptionId) => {
    if (groupOption === 'none') {
      soup.grouping.setActiveGroupId(undefined);
    } else {
      soup.grouping.setActiveGroupId(groupOption);
      soup.grouping.expandAll();
    }
  };

  return { value, onChange, options };
};

const DefaultGroup = (props: GroupOpenProps) => {
  const group = useGroupDropdown();

  return (
    <GroupDropdown
      value={group.value}
      onChange={group.onChange}
      options={group.options}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  );
};

const TasksGroup = (props: GroupOpenProps) => {
  const group = useGroupDropdown(TASK_GROUP_OPTIONS);

  return (
    <GroupDropdown
      value={group.value}
      onChange={group.onChange}
      options={group.options}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  );
};

const MailGroup = (props: GroupOpenProps) => {
  const group = useGroupDropdown(EMAIL_GROUP_OPTIONS);

  return (
    <GroupDropdown
      value={group.value}
      onChange={group.onChange}
      options={group.options}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  );
};

const InboxGroup = (props: GroupOpenProps) => {
  const group = useGroupDropdown(INBOX_GROUP_OPTIONS);

  return (
    <GroupDropdown
      value={group.value}
      onChange={group.onChange}
      options={group.options}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  );
};
