import { IS_MAC } from '@core/constant/isMac';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Select, Tooltip } from '@ui';
import {
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { TypeIcon } from '../components/type-icon';
import type { InputDisplay, InputLayout } from '../context/capabilities';
import { AiDraft } from './ai-draft';
import { CalendarDraft } from './calendar-draft';
import { EmailDraft } from './email-draft';
import { MessageDraft } from './message-draft';
import { type DocumentTags, NoteDraft } from './note-draft';
import { TaskDraft } from './task-draft';
import '../universal-input.css';
import {
  actionLabels,
  type Intent,
  intentLabels,
  intents,
  rankIntents,
} from '../core/input';
import type { UniversalInputController } from '../primitives/universal-input';

type TypeOption = { value: Intent | 'auto'; label: string };
const TYPE_OPTIONS: TypeOption[] = [
  { value: 'auto', label: 'Auto' },
  ...intents.map((value) => ({ value, label: intentLabels[value] })),
];

function ComposerFooter(props: {
  state: UniversalInputController;
  statusId: string;
}) {
  const s = props.state;
  const action = () => {
    if (s.sending() && !s.savingEmailDraft()) return 'Working…';
    const intent = s.draft().intent;
    return intent ? actionLabels[intent] : 'Continue';
  };
  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span id={props.statusId} class="text-xs text-ink-muted">
        {s.validation()}
      </span>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={s.draft().intent === 'email'}>
          <Button
            variant="secondary"
            size="lg"
            disabled={s.sending() || s.pending() || !!s.emailDraftValidation()}
            onClick={() => fireAndForget(s.saveEmailDraft(), 'universal-input')}
          >
            {s.savingEmailDraft() ? 'Saving…' : 'Save as draft'}
          </Button>
        </Show>
        <Button
          variant="primary"
          aria-label={action()}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          size="lg"
          disabled={s.sending() || s.pending() || !!s.validation()}
          onClick={() => fireAndForget(s.submit(), 'universal-input')}
        >
          {action()}
          <Show when={!isTouchDevice()}>
            <kbd
              aria-hidden="true"
              data-testid="submit-shortcut"
              class="ml-2 font-sans text-xs opacity-70"
            >
              {IS_MAC ? '⌘' : 'Ctrl'} ↵
            </kbd>
          </Show>
        </Button>
      </div>
    </div>
  );
}

export function UniversalComposer(props: {
  state: UniversalInputController;
  actions: InputDisplay;
  layout: InputLayout;
  taskFields: JSX.Element;
  editor: JSX.Element;
  noteTags?: DocumentTags;
  search?: (scopeId: string) => JSX.Element;
}) {
  const s = props.state;
  const a = props.actions;
  const type = () => s.draft().intent;
  const [typeMenuOpen, setTypeMenuOpen] = createSignal(false);
  const listId = createUniqueId();
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('universal-input');
  const cycleType = (direction: 1 | -1, event?: KeyboardEvent) => {
    if (event?.isComposing) return false;
    s.cycle(direction);
    return true;
  };
  const typeHotkeys = {
    scopeId: hotkeyScope,
    condition: () => !s.sending() && s.scores().length > 1,
    runWithInputFocused: true,
    hide: true,
  };
  registerHotkey({
    ...typeHotkeys,
    hotkey: 'shift+cmd+arrowright',
    description: 'Next content type',
    keyDownHandler: (event) => cycleType(1, event),
  });
  registerHotkey({
    ...typeHotkeys,
    hotkey: 'shift+cmd+arrowleft',
    description: 'Previous content type',
    keyDownHandler: (event) => cycleType(-1, event),
  });
  const fields = () => (
    <Show when={s.draft().text.trim() || a.attachmentCount()}>
      <fieldset
        disabled={s.sending()}
        class="universal-input-fields flex max-h-(--universal-input-max-height) min-h-0 min-w-0 flex-col gap-4 rounded-2xl border border-edge-muted bg-panel px-5 py-4 shadow-sm sm:px-6 sm:py-5"
      >
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <Select<TypeOption>
            options={TYPE_OPTIONS}
            optionValue="value"
            optionTextValue="label"
            value={TYPE_OPTIONS.find(
              (option) =>
                option.value ===
                (s.draft().locked ? (type() ?? 'auto') : 'auto')
            )}
            onChange={(option) => {
              if (option)
                s.choose(option.value === 'auto' ? undefined : option.value);
            }}
            onOpenChange={setTypeMenuOpen}
            disabled={s.sending()}
            disallowEmptySelection
          >
            <Select.Label class="sr-only">Content type</Select.Label>
            <Tooltip
              as="span"
              label={`Change type · ${IS_MAC ? '⌘' : 'Ctrl'} + Shift + ←/→`}
              disabled={typeMenuOpen()}
            >
              <Select.Trigger class="h-9 w-auto max-w-full px-3 text-sm font-medium">
                <TypeIcon intent={type()} class="size-4 shrink-0" />
                <Select.Value<TypeOption>>
                  {(selection) => {
                    const selected = selection.selectedOption();
                    return selected.value === 'auto'
                      ? `Auto${type() ? ` · ${intentLabels[type()!]}` : ''}`
                      : selected.label;
                  }}
                </Select.Value>
                <Select.Icon />
              </Select.Trigger>
            </Tooltip>
            <Select.Content portalScope="local">
              <Select.Listbox />
            </Select.Content>
          </Select>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={!type()}>
              <For each={rankIntents(s.scores()).slice(0, 2)}>
                {(candidate) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => s.choose(candidate.intent)}
                  >
                    {intentLabels[candidate.intent]}
                  </Button>
                )}
              </For>
            </Show>
            <Show when={s.pending() && type() !== 'search'}>
              <span role="status" class="text-xs text-ink-muted">
                {type() ? 'Updating fields…' : 'Finding the shape…'}
              </span>
            </Show>
          </div>
        </div>
        <div
          role="region"
          aria-label="Suggested fields"
          class="min-h-0 space-y-4 overscroll-contain [overflow-y:var(--universal-input-body-overflow,visible)] empty:hidden"
        >
          <Show when={a.attachmentCount()}>
            <div class="flex items-center gap-2 text-xs text-ink-muted">
              <span>{a.attachmentCount()} attached item(s) · AI context</span>
              <Button size="sm" variant="ghost" onClick={a.clearAttachments}>
                Remove
              </Button>
            </div>
          </Show>
          <Show
            when={
              (type() === 'email' && !a.inboxes().length) ||
              (type() === 'calendar' && !a.calendars().length)
            }
          >
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2.5">
              <p class="text-xs text-ink-muted">
                Connect Google to send email and create calendar events. Then
                return here to compose.
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={s.sending() || a.connectingGoogle()}
                onClick={() =>
                  fireAndForget(a.connectGoogle(), 'universal-input')
                }
              >
                Connect Google
              </Button>
            </div>
          </Show>
          <Show when={type() === 'ai'}>
            <AiDraft state={s} actions={a} />
          </Show>
          <Show when={type() === 'search'}>{props.search?.(hotkeyScope)}</Show>
          <Show when={type() === 'note'}>
            <NoteDraft state={s} actions={a} tags={props.noteTags} />
          </Show>
          <Show when={type() === 'task'}>
            <TaskDraft
              state={s}
              properties={
                <Suspense
                  fallback={
                    <span class="text-xs text-ink-muted">
                      Loading task properties…
                    </span>
                  }
                >
                  {props.taskFields}
                </Suspense>
              }
            />
          </Show>
          <Show when={type() === 'email'}>
            <EmailDraft state={s} actions={a} />
          </Show>
          <Show when={type() === 'message'}>
            <MessageDraft state={s} actions={a} />
          </Show>
          <Show when={type() === 'calendar'}>
            <CalendarDraft state={s} actions={a} />
          </Show>
        </div>
        <Show
          when={type() !== 'search' || !isTouchDevice()}
          fallback={
            <p role="status" class="text-xs text-ink-muted">
              {s.validation()}
            </p>
          }
        >
          <div class="shrink-0 border-t border-edge-muted pt-4">
            <ComposerFooter state={s} statusId={`${listId}-status`} />
          </div>
        </Show>
        <Show when={s.error()}>
          <p role="alert" class="shrink-0 text-sm text-failure">
            {s.error()}
          </p>
        </Show>
      </fieldset>
    </Show>
  );
  const result = () => (
    <Show when={s.result()}>
      {(result) => (
        <div
          role="status"
          class="mt-3 flex items-center gap-3 text-sm text-ink-muted"
        >
          {result().message}
          <Show when={result().open}>
            <Button size="sm" variant="ghost" onClick={() => result().open?.()}>
              Open
            </Button>
          </Show>
        </div>
      )}
    </Show>
  );
  return (
    <section
      class="contents"
      aria-label="Create or find something"
      ref={attachHotkeys}
    >
      {props.layout({
        editor: props.editor,
        fields: fields(),
        result: result(),
      })}
    </section>
  );
}
