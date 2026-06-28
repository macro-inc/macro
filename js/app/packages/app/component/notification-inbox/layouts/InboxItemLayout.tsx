import { Match, Show, Switch } from 'solid-js';
import { ChannelThreadGroupLayout } from './ChannelThreadGroupLayout';
import { GenericItemLayout } from './GenericItemLayout';
import { GithubItemLayout } from './GithubItemLayout';
import { type InboxItemLayoutProps } from './shared';
import { TaskItemLayout } from './TaskItemLayout';
import { getNotificationTag } from './utils';

/**
 * Picks the right layout for an inbox item. Grouped items (those with
 * sub-items) render as a thread group; otherwise we dispatch by notification
 * type. Types without a dedicated layout (email, document, ai, channel, …)
 * fall through to the generic layout until they need their own.
 */
export function InboxItemLayout(props: InboxItemLayoutProps) {
  const grouped = () => !props.nested && Boolean(props.item.subItems?.length);
  const tag = () => getNotificationTag(props.item);

  return (
    <Show when={!grouped()} fallback={<ChannelThreadGroupLayout {...props} />}>
      <Switch>
        <Match when={tag()?.startsWith('github_')}>
          <GithubItemLayout {...props} />
        </Match>
        <Match when={tag() === 'task_assigned'}>
          <TaskItemLayout {...props} />
        </Match>
        <Match when={true}>
          <GenericItemLayout {...props} />
        </Match>
      </Switch>
    </Show>
  );
}
