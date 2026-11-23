import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import MacroLogo from '@icon/macro-logo.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { MACRO_PERSONA_ID } from '../core/roster';

/** What an agent's avatar shows when it has no picture of its own. */
export type GlyphAgent = {
  id: string;
  botId?: string;
  name: string;
  avatarUrl?: string;
};

const MACRO_IDS: ReadonlySet<string> = new Set([
  MACRO_PERSONA_ID,
  MACRO_AGENT_BOT_ID,
  MACRO_CODER_BOT_ID,
]);

/** The mark for an agent: Macro's own logo, Cursor's, or a robot. */
export function AgentIcon(props: {
  agent: Pick<GlyphAgent, 'id' | 'botId'>;
  class?: string;
}) {
  const id = () => props.agent.botId ?? props.agent.id;
  return (
    <Show
      when={MACRO_IDS.has(id())}
      fallback={
        <Show
          when={id() === CURSOR_BOT_ID}
          fallback={<RobotIcon class={props.class ?? 'ph'} />}
        >
          <CursorIcon class={props.class ?? 'ph'} />
        </Show>
      }
    >
      <MacroLogo class={props.class ?? 'ph'} />
    </Show>
  );
}

/** The `</>` mark a coder wears on its avatar. */
export function CodeMark(props: { hidden?: boolean }) {
  return (
    <span class="codemark" aria-hidden="true" hidden={props.hidden}>
      <CodeIcon class="ph" />
    </span>
  );
}

/**
 * Avatar with the coder mark. `cls` names the avatar shape the design uses
 * where it sits: `av` in cards and rows, `bigav` in the editor.
 */
export function AgentAvatar(props: {
  agent: GlyphAgent;
  coder: boolean;
  cls?: 'av' | 'bigav';
  /** Size override for compact identity surfaces; material stays agent-owned. */
  class?: string;
  iconClass?: string;
  children?: JSX.Element;
}) {
  return (
    <span class="avw relative inline-grid shrink-0">
      <span
        data-agent-avatar
        class={cn(
          props.cls ?? 'av',
          'flex shrink-0 items-center justify-center overflow-hidden rounded-full',
          props.cls !== 'bigav' && 'bg-surface-1 text-ink-muted',
          props.class
        )}
      >
        <Show
          when={props.agent.avatarUrl}
          fallback={<AgentIcon agent={props.agent} class={props.iconClass} />}
        >
          {(url) => (
            <img
              src={url()}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                'object-fit': 'cover',
                'border-radius': 'inherit',
              }}
            />
          )}
        </Show>
      </span>
      <Show when={props.coder}>
        <CodeMark />
      </Show>
      {props.children}
    </span>
  );
}
