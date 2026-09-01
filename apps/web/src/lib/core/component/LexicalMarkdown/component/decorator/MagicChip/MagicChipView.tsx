import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import ArrowRight from '@phosphor-icons/core/light/arrow-right-light.svg';
import ArrowsInSimple from '@phosphor-icons/core/light/arrows-in-simple-light.svg';
import { Tooltip } from '@ui';
import { type Component, Match, Show, Switch } from 'solid-js';
import { LeadIcon } from './activity-icon';
import type { MagicChipDisplay } from './display';
import {
  CHIP_ACTION_CLASS,
  ChipActionRow,
  ChipCopyButton,
  type MagicChipActions,
  MAGIC_CHIP_PILL_BLOCK_SIZE_PX,
  MagicChipPillView,
  stopChipActionEvent,
} from './MagicChipPillView';
import {
  MAGIC_CHIP_LOADING_ACTIVITY,
  type MagicChipActivity,
  type MagicChipPresentation,
} from './presentation';

export type { MagicChipActions } from './MagicChipPillView';

function pillBody(display: MagicChipDisplay) {
  return display.mode === 'pill' ? display.pill : undefined;
}

function openedPresentation(display: MagicChipDisplay) {
  return display.mode === 'opened' ? display.presentation : undefined;
}

function loading(presentation: MagicChipPresentation) {
  return presentation.kind === 'loading' ? presentation : undefined;
}

function working(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' ? presentation : undefined;
}

function answering(presentation: MagicChipPresentation) {
  return presentation.kind === 'answering' ? presentation : undefined;
}

function settled(presentation: MagicChipPresentation) {
  return presentation.kind === 'settled' ? presentation : undefined;
}

/** Fixed-height activity line — icon plus label in the flow. */
const ActivityLine: Component<{
  agentSessionId: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <button
    type="button"
    class="flex h-6 w-full min-w-0 items-center gap-1.5 text-left"
    data-magic-chip={props.agentSessionId}
    disabled={!props.onOpen}
    onMouseDown={(event) => event.preventDefault()}
    onClick={props.onOpen}
  >
    <LeadIcon icon={props.activity.icon} busy={props.activity.busy} />
    <span
      class="shrink-0 text-xs"
      classList={{
        'magic-chip-shimmer': props.activity.busy,
        'text-ink-muted': !props.activity.busy,
      }}
      aria-live="polite"
    >
      {props.activity.label}
    </span>
    <Show when={props.activity.detail}>
      {(detail) => (
        <span class="min-w-0 truncate text-xs text-ink-extra-muted">
          {detail()}
        </span>
      )}
    </Show>
  </button>
);

/** Answer markdown. Chrome lives on the opened frame, not on the body. */
const AnswerBody: Component<{ markdown: string }> = (props) => (
  <div class="max-w-full text-left text-sm leading-6">
    <StaticMarkdownContext theme={channelTheme}>
      <StaticMarkdown markdown={props.markdown} target="external" />
    </StaticMarkdownContext>
  </div>
);

/**
 * The answer as it is being written, with the activity line beneath it.
 *
 * The same quoted body the settled state uses, so the turn ending changes
 * only what is under the answer, not the answer itself — no reflow at the
 * moment the agent stops.
 */
const StreamingAnswer: Component<{
  agentSessionId: string;
  markdown: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <div
    class="grid w-full min-w-0 justify-items-start gap-1"
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} />
    <ActivityLine
      agentSessionId={props.agentSessionId}
      activity={props.activity}
      onOpen={props.onOpen}
    />
  </div>
);

/** The settled response, quoted as if the agent had answered inline. */
const SettledAnswer: Component<{
  agentSessionId: string;
  markdown: string;
  onOpen?: () => void;
}> = (props) => (
  <div
    class="grid w-full min-w-0 justify-items-start gap-1"
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} />
  </div>
);

const PresentationSwitch: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  onOpen?: () => void;
}> = (props) => (
  <Switch>
    <Match when={loading(props.presentation)}>
      <ActivityLine
        agentSessionId={props.agentSessionId}
        activity={MAGIC_CHIP_LOADING_ACTIVITY}
        onOpen={props.onOpen}
      />
    </Match>
    <Match when={working(props.presentation)}>
      {(presentation) => (
        <ActivityLine
          agentSessionId={props.agentSessionId}
          activity={presentation().activity}
          onOpen={props.onOpen}
        />
      )}
    </Match>
    <Match when={answering(props.presentation)}>
      {(presentation) => (
        <StreamingAnswer
          agentSessionId={props.agentSessionId}
          markdown={presentation().markdown}
          activity={presentation().activity}
          onOpen={props.onOpen}
        />
      )}
    </Match>
    <Match when={settled(props.presentation)}>
      {(presentation) => (
        <SettledAnswer
          agentSessionId={props.agentSessionId}
          markdown={presentation().markdown}
          onOpen={props.onOpen}
        />
      )}
    </Match>
  </Switch>
);

function copyableText(presentation: MagicChipPresentation): string {
  if (presentation.kind === 'loading') return MAGIC_CHIP_LOADING_ACTIVITY.label;
  if (presentation.kind === 'working') {
    return presentation.activity.detail || presentation.activity.label;
  }
  return presentation.markdown;
}

const OpenedFooter: Component<{
  copyText: string;
  onCollapse: () => void;
  onOpen: () => void;
}> = (props) => (
  <ChipActionRow class="w-full px-4">
    <Tooltip label="Collapse" as="span">
      <button
        type="button"
        class={CHIP_ACTION_CLASS}
        onMouseDown={stopChipActionEvent}
        onClick={(event) => {
          event.stopPropagation();
          props.onCollapse();
        }}
      >
        <ArrowsInSimple class="size-3" />
        Collapse
      </button>
    </Tooltip>
    <Tooltip label="Open session" as="span">
      <button
        type="button"
        class={CHIP_ACTION_CLASS}
        onMouseDown={stopChipActionEvent}
        onClick={(event) => {
          event.stopPropagation();
          props.onOpen();
        }}
      >
        <ArrowRight class="size-3" />
        Open session
      </button>
    </Tooltip>
    <ChipCopyButton text={props.copyText} />
  </ChipActionRow>
);

const MagicChipOpened: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  actions: MagicChipActions;
}> = (props) => (
  <div class="group/chip relative flex w-full min-w-0 flex-col items-start">
    <div
      class="relative flex w-full min-w-0 items-center px-4"
      style={{ 'min-block-size': `${MAGIC_CHIP_PILL_BLOCK_SIZE_PX}px` }}
    >
      <span
        class="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-full bg-thread-rail"
        aria-hidden="true"
      />
      <PresentationSwitch
        agentSessionId={props.agentSessionId}
        presentation={props.presentation}
        onOpen={props.actions.openSession}
      />
    </div>
    <div class="w-full pt-1 opacity-0 transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 hover:opacity-100 touch:opacity-100">
      <OpenedFooter
        copyText={copyableText(props.presentation)}
        onCollapse={() => props.actions.setOpened(false)}
        onOpen={props.actions.openSession}
      />
    </div>
  </div>
);

/**
 * Branch on `mode` as a boolean. Match treats two truthy objects as equal, so
 * `when={display}` would freeze the first `working` pill for the whole turn.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  display: MagicChipDisplay;
  actions: MagicChipActions;
}> = (props) => (
  <Switch>
    <Match when={props.display.mode === 'pill'}>
      <MagicChipPillView
        agentSessionId={props.agentSessionId}
        pill={pillBody(props.display) ?? { body: '', lead: undefined }}
        actions={props.actions}
      />
    </Match>
    <Match when={props.display.mode === 'opened'}>
      <MagicChipOpened
        agentSessionId={props.agentSessionId}
        presentation={
          openedPresentation(props.display) ?? {
            kind: 'working',
            activity: { icon: 'wait', label: '', busy: false },
          }
        }
        actions={props.actions}
      />
    </Match>
  </Switch>
);
