import MacroLogo from '@icon/macro-logo.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Avatar } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { PolicyAgent, PolicyKind } from '../queries/references-view';

/** A policy's picture: its agent's avatar, Macro's logo, or a team glyph. */
export function PolicyAvatar(props: {
  kind: PolicyKind;
  agent?: PolicyAgent | null;
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
              <Match when={props.kind === 'team'}>
                <UsersIcon class={glyph()} />
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
