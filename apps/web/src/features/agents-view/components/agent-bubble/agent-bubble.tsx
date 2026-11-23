import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { RosterAgent } from '../../core/roster';
import { AgentIcon } from '../AgentGlyph';

export function AgentBubble(props: {
  agent?: RosterAgent;
  onSelect: () => void;
  size?: 'selector' | 'selector-phone';
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      appearance={props.size ? 'bare' : undefined}
      disabled={props.disabled}
      aria-pressed={props.selected}
      class={
        props.size
          ? 'flex h-auto shrink-0 flex-col items-center gap-1.5 px-0 pb-1 pt-1.5 text-ink-muted'
          : 'flex h-auto w-28 shrink-0 flex-col items-center gap-2 p-0 text-ink-muted'
      }
      classList={{
        'w-[52px]': props.size === 'selector',
        'w-16': props.size === 'selector-phone',
      }}
      onClick={props.onSelect}
    >
      <span
        class="grid shrink-0 place-items-center overflow-hidden rounded-full bg-ink-extra-muted text-surface"
        style={
          props.selected
            ? {
                outline: '2px solid var(--color-accent)',
                'outline-offset': '2px',
              }
            : undefined
        }
        classList={{
          'border border-edge bg-transparent': !props.agent,
          'size-10': props.size === 'selector',
          'size-12': props.size === 'selector-phone',
          'size-22': !props.size,
        }}
      >
        <Show
          when={props.agent}
          fallback={<PlusIcon class={props.size ? 'size-5' : 'size-7'} />}
        >
          {(agent) => (
            <Show
              when={agent().avatarUrl}
              fallback={
                <AgentIcon
                  agent={agent()}
                  class={props.size ? 'size-5 touch:size-[22px]' : 'size-9'}
                />
              }
            >
              {(url) => (
                <img src={url()} alt="" class="size-full object-cover" />
              )}
            </Show>
          )}
        </Show>
      </span>
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
