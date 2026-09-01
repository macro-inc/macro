import ArrowRight from '@phosphor-icons/core/light/arrow-right-light.svg';
import ArrowsOutSimple from '@phosphor-icons/core/light/arrows-out-simple-light.svg';
import Check from '@phosphor-icons/core/light/check-light.svg';
import CopySimple from '@phosphor-icons/core/light/copy-simple-light.svg';
import { Tooltip } from '@ui';
import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { AgentFace, LeadIcon } from './activity-icon';
import type { MagicChipPill } from './display';

/** Horizontal chrome around the face: `px-3` plus 1px border each side. */
const PILL_CHROME_INLINE = 'calc(1.5rem + 2px)';
/** Idle arrow sits in flow: `ml-1.5` plus the 14px icon. */
const PILL_IDLE_ARROW_INLINE = 'calc(0.375rem + 0.875rem)';

export const MAGIC_CHIP_PILL_BLOCK_SIZE_PX = 40;
/** Long answers ellipsize inside this, not across the message column. */
export const MAGIC_CHIP_PILL_MAX_INLINE_SIZE = 'min(100%, 20rem)';

export type MagicChipActions = {
  openSession: () => void;
  setOpened: (opened: boolean) => void;
};

export const CHIP_ACTION_CLASS =
  'inline-flex items-center gap-1 text-xxs text-ink-extra-muted hover:text-ink';

export function stopChipActionEvent(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export const ChipActionRow: Component<{
  class?: string;
  children: JSX.Element;
}> = (props) => (
  <div class={`flex items-center gap-2 ${props.class ?? ''}`}>
    {props.children}
  </div>
);

export const ChipCopyButton: Component<{ text: string }> = (props) => {
  const [copied, setCopied] = createSignal(false);
  let copiedReset: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(copiedReset));

  const copyText = async () => {
    if (!props.text) return;
    try {
      await navigator.clipboard.writeText(props.text);
    } catch (error) {
      console.error('[magic-chip] copy failed', error);
      return;
    }
    setCopied(true);
    clearTimeout(copiedReset);
    copiedReset = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip label={copied() ? 'Copied' : 'Copy'} as="span">
      <button
        type="button"
        class={CHIP_ACTION_CLASS}
        aria-label={copied() ? 'Copied' : 'Copy'}
        onMouseDown={stopChipActionEvent}
        onClick={(event) => {
          event.stopPropagation();
          void copyText();
        }}
      >
        <Show when={copied()} fallback={<CopySimple class="size-3" />}>
          <Check class="size-3" />
        </Show>
      </button>
    </Tooltip>
  );
};

/** Lead identity only — body chunks must not restart the swipe. */
function stateKey(pill: MagicChipPill): string {
  return pill.lead ? `${pill.lead.icon}:${pill.lead.label}` : 'settled';
}

function PillFace(props: { pill: MagicChipPill; clamp?: boolean }) {
  const copy = () => props.pill.body || props.pill.lead?.label || '';
  const clamp = () => props.clamp !== false;
  return (
    <span
      class="flex h-full items-center gap-1.5"
      classList={{
        'min-w-0 w-full': clamp(),
        'w-max': !clamp(),
      }}
    >
      <Show
        when={props.pill.agent}
        fallback={
          <Show when={props.pill.lead}>
            {(lead) => <LeadIcon icon={lead().icon} busy={lead().busy} />}
          </Show>
        }
      >
        {(agent) => <AgentFace name={agent().name} avatarUrl={agent().avatarUrl} />}
      </Show>
      <Show when={copy()}>
        {(text) => (
          <span
            class="text-xs text-ink-muted"
            classList={{
              'min-w-0 grow truncate': clamp(),
              'whitespace-nowrap': !clamp(),
            }}
          >
            {text()}
          </span>
        )}
      </Show>
    </span>
  );
}

const SWIPE_MS = 480;

function SwipeFace(props: { pill: MagicChipPill }) {
  let current = props.pill;
  const [shown, setShown] = createSignal(current);
  const [leaving, setLeaving] = createSignal<MagicChipPill>();
  const [swiping, setSwiping] = createSignal(false);
  let settle: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    clearTimeout(settle);
    settle = undefined;
    setLeaving(undefined);
    setSwiping(false);
  };

  createEffect(
    on(
      () => props.pill,
      (next) => {
        if (stateKey(next) === stateKey(current)) {
          current = next;
          setShown(next);
          return;
        }
        setLeaving(current);
        current = next;
        setShown(next);
        setSwiping(true);
        clearTimeout(settle);
        settle = setTimeout(finish, SWIPE_MS + 40);
      },
      { defer: true }
    )
  );

  onCleanup(() => clearTimeout(settle));

  return (
    <span class="relative grid h-full min-w-0 w-full overflow-hidden">
      <Show when={leaving()}>
        {(old) => (
          <span
            class="pointer-events-none absolute inset-y-0 left-0 magic-chip-swipe-out"
            aria-hidden="true"
          >
            <PillFace pill={old()} clamp={false} />
          </span>
        )}
      </Show>
      <span
        class="col-start-1 row-start-1 h-full min-w-0 w-full"
        classList={{ 'magic-chip-swipe-in': swiping() }}
      >
        <PillFace pill={shown()} />
      </span>
    </span>
  );
}

function pillText(pill: MagicChipPill): string {
  return pill.body || pill.lead?.label || '';
}

export const MagicChipPillView: Component<{
  agentSessionId: string;
  pill: MagicChipPill;
  actions: MagicChipActions;
}> = (props) => {
  const idle = () => !props.pill.lead?.busy;
  let sizer: HTMLSpanElement | undefined;
  const [faceWidth, setFaceWidth] = createSignal<number>();
  const [widthReady, setWidthReady] = createSignal(false);

  const measure = () => {
    if (!sizer) return;
    const next = sizer.scrollWidth || sizer.firstElementChild?.scrollWidth || 0;
    if (next > 0) setFaceWidth(next);
  };

  createEffect(
    on(
      () => props.pill,
      () => {
        measure();
        requestAnimationFrame(() => setWidthReady(true));
      }
    )
  );

  return (
    <div class="group/chip relative inline-flex min-w-0 max-w-full flex-col items-start">
      <div
        data-testid="magic-chip-frame"
        data-magic-chip={props.agentSessionId}
        class="group/pill inline-flex min-w-0 overflow-hidden contain-layout contain-paint"
        style={{
          'block-size': `${MAGIC_CHIP_PILL_BLOCK_SIZE_PX}px`,
          'min-block-size': `${MAGIC_CHIP_PILL_BLOCK_SIZE_PX}px`,
          'max-block-size': `${MAGIC_CHIP_PILL_BLOCK_SIZE_PX}px`,
          'max-inline-size': MAGIC_CHIP_PILL_MAX_INLINE_SIZE,
          'inline-size':
            faceWidth() !== undefined
              ? `calc(${faceWidth()}px + ${PILL_CHROME_INLINE}${idle() ? ` + ${PILL_IDLE_ARROW_INLINE}` : ''})`
              : undefined,
          transition: widthReady()
            ? `inline-size ${SWIPE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
            : undefined,
        }}
      >
        <span
          ref={(el) => {
            sizer = el;
            measure();
          }}
          class="pointer-events-none absolute overflow-hidden"
          style={{ width: '0', height: '0' }}
          aria-hidden="true"
        >
          <span class="flex w-max">
            <PillFace pill={props.pill} clamp={false} />
          </span>
        </span>
        <Tooltip label="Open session" as="span" class="h-full min-w-0 w-full">
          <button
            type="button"
            class="relative flex h-full min-w-0 w-full items-center overflow-hidden rounded-full border border-thread-rail bg-transparent px-3 text-left hover:bg-hover focus-within:bg-active"
            aria-label={props.pill.lead?.label ?? 'Open session'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={props.actions.openSession}
          >
            <SwipeFace pill={props.pill} />
            <Show
              when={idle()}
              fallback={
                <span class="absolute inset-y-0 right-0 z-1 flex items-center bg-surface pr-3 pl-1.5 opacity-0 transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/pill:opacity-100 group-focus-within/pill:opacity-100">
                  <span
                    class="pointer-events-none absolute inset-y-0 right-full w-8 bg-linear-to-l from-surface to-transparent"
                    aria-hidden="true"
                  />
                  <ArrowRight class="relative size-3.5 shrink-0 text-ink-muted" />
                </span>
              }
            >
              <span class="z-1 ml-1.5 flex shrink-0 items-center">
                <ArrowRight class="size-3.5 shrink-0 text-ink-muted" />
              </span>
            </Show>
          </button>
        </Tooltip>
      </div>
      <ChipActionRow class="w-full px-3 pt-1 opacity-0 transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 touch:opacity-100">
        <Tooltip label="Expand inline" as="span">
          <button
            type="button"
            class={CHIP_ACTION_CLASS}
            onMouseDown={stopChipActionEvent}
            onClick={(event) => {
              event.stopPropagation();
              props.actions.setOpened(true);
            }}
          >
            <ArrowsOutSimple class="size-3" />
            Expand inline
          </button>
        </Tooltip>
        <ChipCopyButton text={pillText(props.pill)} />
      </ChipActionRow>
    </div>
  );
};
