import GithubIcon from '@icon/mcp-github.svg';
import { GenericItemLayout } from './GenericItemLayout';
import { type InboxItemLayoutProps } from './shared';

/** GitHub PR/review notifications: generic layout with a GitHub source icon. */
export function GithubItemLayout(props: InboxItemLayoutProps) {
  return (
    <GenericItemLayout
      {...props}
      actionLeading={<GithubIcon class="size-3.5 shrink-0 text-ink-muted" />}
    />
  );
}
