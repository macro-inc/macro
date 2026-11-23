import MacroLogo from '@icon/macro-logo.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import type {
  ToolPermissionPolicyKind,
  ToolPermissionSourceAgent,
} from '@service-agent-harness/generated/schemas';
import { Avatar } from '@ui';
import { Match, Show, Switch } from 'solid-js';

/** A policy's picture: its agent's avatar, or Macro's logo for the persona. */
export function PolicyAvatar(props: {
  kind?: ToolPermissionPolicyKind | null;
  agent?: ToolPermissionSourceAgent | null;
  size?: 'md' | 'lg';
}) {
  const glyph = () => (props.size === 'md' ? 'size-3.5' : 'size-5');
  return (
    <Avatar
      size={props.size ?? 'lg'}
      class="shrink-0 bg-surface text-accent ring ring-edge-muted"
    >
      <Show
        when={props.agent?.avatarUrl}
        fallback={
          <Avatar.Fallback>
            <Switch fallback={<AgentIcon class={glyph()} />}>
              <Match when={props.kind === 'persona'}>
                <MacroLogo class={glyph()} />
              </Match>
            </Switch>
          </Avatar.Fallback>
        }
      >
        {(url) => <Avatar.Image src={url()} alt="" />}
      </Show>
    </Avatar>
  );
}
