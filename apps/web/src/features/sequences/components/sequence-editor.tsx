import { ComposeFieldRow } from '@app/features/email-compose/components/compose-field-row';
import { t } from '@app/lib/i18n';
import { clamp } from '@core/util/math';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import BracesIcon from '@icon/system/regular/brackets-curly.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import type { Step } from '@service-email/generated/schemas';
import { Button, Checkbox, ComposerSurface, Dropdown, Input } from '@ui';
import { For, Index, Show } from 'solid-js';
import type { Sender } from '../context/sequences-context';
import {
  insertToken,
  isReplyStep,
  PERSONALIZATION_TOKENS,
  type PersonalizationToken,
  SEQUENCE_LIMITS,
  type SequenceDraft,
  stepSubject,
} from '../core/sequence';
import { OptionSelect } from './option-select';

const TOKEN_LABELS = {
  '{{firstName}}': 'sequences.tokenFirstName',
  '{{name}}': 'sequences.tokenName',
  '{{email}}': 'sequences.tokenEmail',
} as const satisfies Record<PersonalizationToken, string>;

/** Whole days within the limit; an emptied field reads as 0. */
function clampDelay(value: number) {
  return Number.isFinite(value)
    ? clamp(Math.trunc(value), 0, SEQUENCE_LIMITS.delayDays)
    : 0;
}

/** When a follow-up goes out and whether it replies in the thread. */
function StepTiming(props: {
  step: Step;
  position: number;
  disabled: boolean;
  onChange: (patch: Partial<Step>) => void;
}) {
  return (
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 py-3 text-xs text-ink-muted">
      <label class="flex items-center gap-2">
        {t('sequences.wait')}
        <Input
          aria-label={t('sequences.delayDays', { position: props.position })}
          type="number"
          min="0"
          max={SEQUENCE_LIMITS.delayDays}
          size="xs"
          class="w-14"
          value={props.step.delayDays}
          disabled={props.disabled}
          onInput={(event) =>
            props.onChange({
              delayDays: clampDelay(event.currentTarget.valueAsNumber),
            })
          }
        />
        {t('sequences.days', { count: props.step.delayDays })}
      </label>
      <Checkbox
        class="flex items-center gap-2 text-xs"
        checked={props.step.asReply === true}
        disabled={props.disabled}
        onChange={(checked: boolean) => props.onChange({ asReply: checked })}
      >
        <Checkbox.Control />
        <Checkbox.Label>{t('sequences.replyInThread')}</Checkbox.Label>
      </Checkbox>
    </div>
  );
}

function StepCard(props: {
  steps: readonly Step[];
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<Step>) => void;
  onMoveUp: () => void;
  onRemove: () => void;
}) {
  let subjectEl: HTMLInputElement | undefined;
  let bodyEl: HTMLTextAreaElement | undefined;
  let lastField: 'subject' | 'body' = 'body';
  let inserted = false;
  const step = () => props.steps[props.index];
  const position = () => props.index + 1;
  const reply = () => isReplyStep(props.steps, props.index);

  // Personalization goes where the caret last was, in the subject or message.
  const insert = (token: PersonalizationToken) => {
    const field = lastField === 'subject' && !reply() ? 'subject' : 'body';
    const el = field === 'subject' ? subjectEl : bodyEl;
    if (!el) return;
    const next = insertToken(
      el.value,
      el.selectionStart ?? el.value.length,
      el.selectionEnd ?? el.value.length,
      token
    );
    props.onChange({ [field]: next.value });
    inserted = true;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <article aria-label={t('sequences.emailNumber', { position: position() })}>
      <ComposerSurface
        as="div"
        class="relative overflow-clip touch:rounded-xl touch:border touch:border-edge-muted"
      >
        <div class="flex min-h-11 items-center justify-between gap-2 px-4 pt-2">
          <h3 class="text-sm font-medium">
            {t('sequences.emailNumber', { position: position() })}
          </h3>
          <Show when={!props.disabled}>
            <div class="flex items-center gap-1">
              <Dropdown placement="bottom-end">
                <Dropdown.Trigger
                  variant="ghost"
                  size="sm"
                  aria-label={t('sequences.insertInto', {
                    position: position(),
                  })}
                >
                  <BracesIcon class="size-4" aria-hidden="true" />
                  {t('sequences.insert')}
                </Dropdown.Trigger>
                <Dropdown.Content
                  class="min-w-40"
                  onCloseAutoFocus={(event: Event) => {
                    if (!inserted) return;
                    inserted = false;
                    event.preventDefault();
                  }}
                >
                  <Dropdown.Group>
                    <For each={PERSONALIZATION_TOKENS}>
                      {(token) => (
                        <Dropdown.Item onSelect={() => insert(token)}>
                          {t(TOKEN_LABELS[token])}
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('sequences.moveEmailUp', {
                  position: position(),
                })}
                tooltip={t('sequences.moveUp')}
                disabled={props.index === 0}
                onClick={() => props.onMoveUp()}
              >
                <ArrowUpIcon class="size-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('sequences.removeEmail', {
                  position: position(),
                })}
                tooltip={t('sequences.remove')}
                disabled={props.steps.length === 1}
                onClick={() => props.onRemove()}
              >
                <XIcon class="size-4" aria-hidden="true" />
              </Button>
            </div>
          </Show>
        </div>
        <div class="px-4 pb-3">
          <ComposeFieldRow label={t('sequences.subject')}>
            <Show
              when={!reply()}
              fallback={
                <p class="ph-no-capture truncate text-sm text-ink-muted">
                  {stepSubject(props.steps, props.index)}
                </p>
              }
            >
              <input
                ref={subjectEl}
                type="text"
                aria-label={t('sequences.subjectOf', { position: position() })}
                class="ph-no-capture w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
                placeholder={t('sequences.subjectPlaceholder')}
                maxLength={SEQUENCE_LIMITS.subject}
                value={step()?.subject ?? ''}
                disabled={props.disabled}
                onFocus={() => (lastField = 'subject')}
                onInput={(event) =>
                  props.onChange({
                    subject: event.currentTarget.value.replace(/[\r\n]+/g, ' '),
                  })
                }
              />
            </Show>
          </ComposeFieldRow>
          <textarea
            ref={bodyEl}
            aria-label={t('sequences.messageOf', { position: position() })}
            class="ph-no-capture field-sizing-content block min-h-40 w-full resize-none bg-transparent py-3 text-sm leading-6 text-ink outline-none placeholder:text-ink-placeholder"
            placeholder={t('sequences.messagePlaceholder', {
              token: PERSONALIZATION_TOKENS[0],
            })}
            maxLength={SEQUENCE_LIMITS.body}
            value={step()?.body ?? ''}
            disabled={props.disabled}
            onFocus={() => (lastField = 'body')}
            onInput={(event) =>
              props.onChange({ body: event.currentTarget.value })
            }
          />
        </div>
      </ComposerSurface>
    </article>
  );
}

export function SequenceEditor(props: {
  draft: SequenceDraft;
  senders: readonly Sender[];
  disabled: boolean;
  onChange: (draft: SequenceDraft) => void;
}) {
  const change = (patch: Partial<SequenceDraft>) =>
    props.onChange({ ...props.draft, ...patch });
  const changeStep = (index: number, patch: Partial<Step>) =>
    change({
      steps: props.draft.steps.map((step, at) =>
        at === index ? { ...step, ...patch } : step
      ),
    });
  const moveUp = (index: number) => {
    const steps = [...props.draft.steps];
    [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
    change({ steps });
  };
  return (
    <div class="mx-auto w-full max-w-3xl pb-12">
      <ComposeFieldRow label={t('sequences.from')}>
        <OptionSelect
          label={t('sequences.sendFrom')}
          value={props.draft.linkId ?? undefined}
          placeholder={
            props.senders.length
              ? t('sequences.chooseInbox')
              : t('sequences.noInbox')
          }
          disabled={props.disabled}
          personal
          options={props.senders.map((sender) => ({
            value: sender.id,
            label: sender.ready
              ? sender.email
              : t('sequences.inboxNeedsReconnect', { email: sender.email }),
            disabled: !sender.ready,
          }))}
          onChange={(linkId) => change({ linkId })}
        />
      </ComposeFieldRow>
      <div class="pt-5">
        <Index each={props.draft.steps}>
          {(step, index) => (
            <>
              <Show when={index > 0}>
                <StepTiming
                  step={step()}
                  position={index + 1}
                  disabled={props.disabled}
                  onChange={(patch) => changeStep(index, patch)}
                />
              </Show>
              <StepCard
                steps={props.draft.steps}
                index={index}
                disabled={props.disabled}
                onChange={(patch) => changeStep(index, patch)}
                onMoveUp={() => moveUp(index)}
                onRemove={() =>
                  change({
                    steps: props.draft.steps.filter((_, at) => at !== index),
                  })
                }
              />
            </>
          )}
        </Index>
      </div>
      <Show when={!props.disabled}>
        <Button
          type="button"
          variant="secondary"
          class="mt-4"
          disabled={props.draft.steps.length >= SEQUENCE_LIMITS.steps}
          onClick={() =>
            change({
              steps: [
                ...props.draft.steps,
                { delayDays: 2, subject: '', body: '', asReply: true },
              ],
            })
          }
        >
          <PlusIcon class="size-4" aria-hidden="true" />
          {t('sequences.addEmail')}
        </Button>
      </Show>
      <div class="mt-6">
        <ComposeFieldRow label={t('sequences.footer')}>
          <input
            type="text"
            aria-label={t('sequences.footer')}
            class="ph-no-capture w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
            value={props.draft.footer}
            maxLength={SEQUENCE_LIMITS.footer}
            disabled={props.disabled}
            placeholder={t('sequences.footerPlaceholder')}
            onInput={(event) => change({ footer: event.currentTarget.value })}
          />
        </ComposeFieldRow>
      </div>
    </div>
  );
}
