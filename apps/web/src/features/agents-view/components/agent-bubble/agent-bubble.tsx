import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import type { RosterAgent } from '../../core/roster';
import { AgentAvatar } from '../AgentGlyph';

export function AgentBubble(props: {
  agent?: RosterAgent;
  onSelect: () => void;
  size?: 'selector' | 'selector-phone';
  selected?: boolean;
  disabled?: boolean;
}) {
  const avatarSize = () => {
    if (props.size === 'selector') return 'size-10';
    if (props.size === 'selector-phone') return 'size-12';
    return 'size-22';
  };
  return (
    <Button
      variant="ghost"
      appearance={props.size ? 'bare' : undefined}
      disabled={props.disabled}
      aria-pressed={props.selected}
      class={
        props.size
          ? 'flex h-auto shrink-0 flex-col items-center gap-1.5 rounded-xl px-0 pb-0 pt-1.5 text-ink-muted not-touch:hover:bg-hover active:bg-active'
          : 'flex h-auto w-28 shrink-0 flex-col items-center gap-2 p-0 text-ink-muted'
      }
      classList={{
        'w-[52px]': props.size === 'selector',
        'w-16': props.size === 'selector-phone',
      }}
      onClick={props.onSelect}
    >
      <Show
        when={props.agent}
        fallback={
          <span
            class={cn(
              'grid shrink-0 place-items-center rounded-full border border-edge bg-transparent text-ink-muted',
              avatarSize()
            )}
          >
            <PlusIcon class={props.size ? 'size-5' : 'size-7'} />
          </span>
        }
      >
        {(agent) => (
          <AgentAvatar
            agent={agent()}
            coder={false}
            class={cn(
              avatarSize(),
              props.selected && 'outline-2 outline-offset-2 outline-accent'
            )}
            iconClass={props.size ? 'size-5 touch:size-[22px]' : 'size-9'}
          />
        )}
      </Show>
      <span
        class="w-full px-1 text-xs font-normal"
        classList={{
          'line-clamp-2 whitespace-normal text-center': Boolean(props.size),
          truncate: !props.size,
        }}
      >
        {props.agent?.name ??
          (props.size ? t('create.new') : t('agentWork.newAgent'))}
      </span>
    </Button>
  );
}
