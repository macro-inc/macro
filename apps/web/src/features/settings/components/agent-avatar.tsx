import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import MacroLogo from '@icon/macro-logo.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import { Avatar, cn } from '@ui';
import { Show } from 'solid-js';
import {
  type AgentFaceLook,
  agentFaceColor,
  agentFaceLook,
} from '../core/agent-face';
import { AgentFace, createDarkTheme } from './agent-face';

/**
 * An agent's uploaded picture, the Macro mark for the built-in agent, or the
 * agent's Mark face derived from its @tag.
 */
export function AgentAvatar(props: {
  id: string;
  name: string;
  tag: string;
  avatarUrl?: string;
}) {
  return (
    <Show
      when={props.avatarUrl || props.id === MACRO_AGENT_BOT_ID}
      fallback={
        <AgentFaceBadge
          look={agentFaceLook(props.tag || props.name)}
          class="size-10"
        />
      }
    >
      <Avatar size="lg" class="bg-surface text-accent ring ring-edge-muted">
        <Show
          when={props.avatarUrl}
          fallback={
            <Avatar.Fallback>
              <Show
                when={props.id === MACRO_AGENT_BOT_ID}
                fallback={<AgentIcon class="size-5" />}
              >
                <MacroLogo class="size-5" />
              </Show>
            </Avatar.Fallback>
          }
        >
          {(avatarUrl) => (
            <Avatar.Image src={avatarUrl()} alt={`${props.name} avatar`} />
          )}
        </Show>
      </Avatar>
    </Show>
  );
}

/** A face in a round wash of its own color, sized by `class`. */
export function AgentFaceBadge(props: { look: AgentFaceLook; class?: string }) {
  const dark = createDarkTheme();
  const swatch = () =>
    agentFaceColor(props.look.color).swatch[dark() ? 'dark' : 'light'];
  return (
    <span
      class={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        props.class
      )}
      style={{
        background: `radial-gradient(circle at 50% 42%, ${swatch()}3d, ${swatch()}17 70%)`,
      }}
    >
      <AgentFace look={props.look} class="size-[78%] -translate-y-[6%]" />
    </span>
  );
}
