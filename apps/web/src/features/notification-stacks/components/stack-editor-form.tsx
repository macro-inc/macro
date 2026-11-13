import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Checkbox, Input } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  STACK_ENTITY_KINDS,
  STACK_KINDS,
  type StackDraft,
  type StackEntityKind,
  type StackKind,
  type StackSource,
} from '../core/stack';
import { stackKindLabel } from '../primitives/describe-stack';

export const entityKindLabel = (kind: StackEntityKind) =>
  match(kind)
    .with('channel', () => t('notificationStacks.kindChannel'))
    .with('document', () => t('notificationStacks.kindDocument'))
    .with('folder', () => t('notificationStacks.kindFolder'))
    .with('project', () => t('notificationStacks.kindProject'))
    .with('person', () => t('notificationStacks.kindPerson'))
    .exhaustive();

function Chip(props: {
  children: JSX.Element;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span class="flex max-w-full min-w-0 items-center gap-1 rounded-full border border-edge-muted bg-surface py-0.5 pr-0.5 pl-2.5 text-sm text-ink">
      <span class="flex min-w-0 items-center gap-1.5 truncate">
        {props.children}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t('notificationStacks.removeItem')}
        disabled={props.disabled}
        onClick={() => props.onRemove()}
      >
        <XIcon class="size-3.5" />
      </Button>
    </span>
  );
}

function Field(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="mb-2 flex flex-col gap-0.5">
        <span class="text-sm font-medium text-ink">{props.label}</span>
        <Show when={props.hint}>
          <span class="text-xs leading-5 text-ink-muted">{props.hint}</span>
        </Show>
      </legend>
      {props.children}
    </fieldset>
  );
}

/**
 * The fields of a stack: its name, where and whom it captures from, which
 * kinds, and what still comes through. Picking channels, documents and people
 * is the host's: `onPick` asks for it, and `picker` shows it under the chips.
 */
export function StackEditorForm(props: {
  draft: StackDraft;
  disabled: boolean;
  EntityLabel: Component<{ kind: StackEntityKind; id: string }>;
  /** The open picker, shown under the chosen places; undefined when closed. */
  picker?: JSX.Element;
  onNameChange: (name: string) => void;
  onPick: (kind: StackEntityKind) => void;
  /** Returns whether the text was added, so the field clears only then. */
  onAddNameText: (text: string) => boolean;
  onRemoveSource: (source: StackSource) => void;
  onRemoveSender: (id: string) => void;
  onKindChange: (kind: StackKind, captured: boolean) => void;
  onReleaseMentionsChange: (released: boolean) => void;
  onReleaseRepliesChange: (released: boolean) => void;
}) {
  const [nameText, setNameText] = createSignal('');
  const addNameText = () => {
    if (props.onAddNameText(nameText())) setNameText('');
  };
  const nothingChosen = () =>
    props.draft.sources.length === 0 && props.draft.senders.length === 0;

  return (
    <div class="flex flex-col gap-5">
      <Input
        aria-label={t('notificationStacks.name')}
        placeholder={t('notificationStacks.namePlaceholder')}
        readOnly={props.disabled}
        maxLength={100}
        value={props.draft.name}
        onInput={(event) => props.onNameChange(event.currentTarget.value)}
      />

      <Field label={t('notificationStacks.captureFrom')}>
        <div class="flex min-w-0 flex-wrap gap-1.5">
          <Show when={nothingChosen()}>
            <span class="text-sm text-ink-muted">
              {t('notificationStacks.captureEmpty')}
            </span>
          </Show>
          <For each={props.draft.sources}>
            {(source) => (
              <Chip
                disabled={props.disabled}
                onRemove={() => props.onRemoveSource(source)}
              >
                <Show
                  when={source.type !== 'channelNameContains' && source}
                  fallback={
                    <span class="truncate">
                      {t('notificationStacks.nameContainsChip', {
                        text:
                          source.type === 'channelNameContains'
                            ? source.text
                            : '',
                      })}
                    </span>
                  }
                >
                  {(entity) => (
                    <props.EntityLabel kind={entity().type} id={entity().id} />
                  )}
                </Show>
              </Chip>
            )}
          </For>
          <For each={props.draft.senders}>
            {(sender) => (
              <Chip
                disabled={props.disabled}
                onRemove={() => props.onRemoveSender(sender)}
              >
                <props.EntityLabel kind="person" id={sender} />
              </Chip>
            )}
          </For>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <For each={STACK_ENTITY_KINDS}>
            {(kind) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={props.disabled}
                onClick={() => props.onPick(kind)}
              >
                <PlusIcon class="size-3.5" />
                {entityKindLabel(kind)}
              </Button>
            )}
          </For>
        </div>
        {props.picker}
        <div class="flex flex-col gap-1.5 text-xs text-ink-muted">
          <span>{t('notificationStacks.nameContains')}</span>
          <span class="flex items-center gap-2">
            <Input
              class="min-w-0 flex-1"
              aria-label={t('notificationStacks.nameContains')}
              placeholder={t('notificationStacks.nameContainsPlaceholder')}
              readOnly={props.disabled}
              maxLength={100}
              value={nameText()}
              onInput={(event) => setNameText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Enter adds the text; it must not submit the stack.
                event.preventDefault();
                addNameText();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={props.disabled || nameText().trim() === ''}
              onClick={addNameText}
            >
              {t('notificationStacks.addNameText')}
            </Button>
          </span>
          <span>{t('notificationStacks.nameContainsHint')}</span>
        </div>
      </Field>

      <Field
        label={t('notificationStacks.kinds')}
        hint={t('notificationStacks.kindsHint')}
      >
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 mobile:grid-cols-1">
          <For each={STACK_KINDS}>
            {(kind) => (
              <Checkbox
                class="flex items-center gap-2 py-1 touch:min-h-11"
                checked={props.draft.kinds.includes(kind)}
                disabled={props.disabled}
                onChange={(checked) => props.onKindChange(kind, checked)}
              >
                <Checkbox.Control />
                <Checkbox.Label class="text-sm text-ink">
                  {stackKindLabel(kind)}
                </Checkbox.Label>
              </Checkbox>
            )}
          </For>
        </div>
      </Field>

      <Field label={t('notificationStacks.release')}>
        <Checkbox
          class="flex items-center gap-2 py-1 touch:min-h-11"
          checked={props.draft.releaseMentions}
          disabled={props.disabled}
          onChange={props.onReleaseMentionsChange}
        >
          <Checkbox.Control />
          <Checkbox.Label class="text-sm text-ink">
            {t('notificationStacks.releaseMentions')}
          </Checkbox.Label>
        </Checkbox>
        <Checkbox
          class="flex items-center gap-2 py-1 touch:min-h-11"
          checked={props.draft.releaseReplies}
          disabled={props.disabled}
          onChange={props.onReleaseRepliesChange}
        >
          <Checkbox.Control />
          <Checkbox.Label class="text-sm text-ink">
            {t('notificationStacks.releaseReplies')}
          </Checkbox.Label>
        </Checkbox>
      </Field>
    </div>
  );
}
