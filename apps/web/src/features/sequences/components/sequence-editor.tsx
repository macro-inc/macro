import { t } from '@app/lib/i18n';
import { clamp } from '@core/util/math';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import type { Step } from '@service-email/generated/schemas';
import { Button, Checkbox, ComposerSurface, Input, TextField } from '@ui';
import { Index, Show } from 'solid-js';
import type { Sender } from '../context/sequences-context';
import {
  isReplyStep,
  PERSONALIZATION_TOKENS,
  SEQUENCE_LIMITS,
  type SequenceDraft,
  stepSubject,
} from '../core/sequence';
import { OptionSelect } from './option-select';

/** Whole days within the limit; an emptied field reads as 0. */
function clampDelay(value: number) {
  return Number.isFinite(value)
    ? clamp(Math.trunc(value), 0, SEQUENCE_LIMITS.delayDays)
    : 0;
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
    <div class="mx-auto w-full max-w-3xl space-y-7 pb-12">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="space-y-2 text-xs font-medium">
          {t('sequences.name')}
          <Input
            value={props.draft.name}
            maxLength={SEQUENCE_LIMITS.name}
            disabled={props.disabled}
            onInput={(event) => change({ name: event.currentTarget.value })}
          />
        </label>
        <div class="space-y-2 text-xs font-medium">
          <span>{t('sequences.sendFrom')}</span>
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
        </div>
      </div>
      <div class="flex items-center gap-3 rounded-lg border border-edge-muted px-4 py-3">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <FlowArrowIcon class="size-4" aria-hidden="true" />
        </span>
        <div>
          <p class="text-sm font-medium">{t('sequences.starts')}</p>
          <p class="text-xs text-ink-muted">{t('sequences.startsHint')}</p>
        </div>
      </div>
      <Index each={props.draft.steps}>
        {(step, index) => {
          const position = () => index + 1;
          const reply = () => isReplyStep(props.draft.steps, index);
          return (
            <div>
              <div class="ml-7 h-5 border-l border-dashed border-edge" />
              <article
                aria-label={t('sequences.emailNumber', {
                  position: position(),
                })}
              >
                <ComposerSurface
                  as="div"
                  class="relative overflow-clip touch:rounded-xl touch:border touch:border-edge-muted touch:bg-composer"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-edge-muted px-6 py-4">
                    <div class="flex items-center gap-3">
                      <span class="flex size-7 items-center justify-center rounded-lg border border-edge text-ink-muted">
                        <EnvelopeIcon class="size-4" aria-hidden="true" />
                      </span>
                      <h3 class="text-sm font-medium">
                        {t('sequences.emailNumber', { position: position() })}
                      </h3>
                    </div>
                    <Show when={!props.disabled}>
                      <div class="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t('sequences.moveEmailUp', {
                            position: position(),
                          })}
                          tooltip={t('sequences.moveUp')}
                          disabled={index === 0}
                          onClick={() => moveUp(index)}
                        >
                          <ArrowUpIcon aria-hidden="true" class="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="danger-ghost"
                          size="xs"
                          aria-label={t('sequences.removeEmail', {
                            position: position(),
                          })}
                          disabled={props.draft.steps.length === 1}
                          onClick={() =>
                            change({
                              steps: props.draft.steps.filter(
                                (_, at) => at !== index
                              ),
                            })
                          }
                        >
                          {t('sequences.remove')}
                        </Button>
                      </div>
                    </Show>
                  </div>
                  <div class="space-y-4 px-6 pt-4 pb-6">
                    <label class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      {index === 0
                        ? t('sequences.delayAfterStart')
                        : t('sequences.delayAfterPrevious')}
                      <Input
                        aria-label={t('sequences.delayDays', {
                          position: position(),
                        })}
                        type="number"
                        min="0"
                        max={SEQUENCE_LIMITS.delayDays}
                        size="xs"
                        class="w-16"
                        value={step().delayDays}
                        disabled={props.disabled}
                        onInput={(event) =>
                          changeStep(index, {
                            delayDays: clampDelay(
                              event.currentTarget.valueAsNumber
                            ),
                          })
                        }
                      />
                    </label>
                    <Show when={index > 0}>
                      <Checkbox
                        checked={step().asReply === true}
                        disabled={props.disabled}
                        onChange={(checked: boolean) =>
                          changeStep(index, { asReply: checked })
                        }
                        class="text-xs text-ink-muted"
                      >
                        <Checkbox.Control />
                        <Checkbox.Label>
                          {t('sequences.replyInThread')}
                        </Checkbox.Label>
                      </Checkbox>
                    </Show>
                    <Show
                      when={!reply()}
                      fallback={
                        <div class="space-y-2 text-xs font-medium">
                          <p>{t('sequences.subject')}</p>
                          <p class="ph-no-capture text-sm font-normal text-ink-muted">
                            {stepSubject(props.draft.steps, index)}
                          </p>
                        </div>
                      }
                    >
                      <TextField
                        class="gap-2"
                        value={step().subject}
                        disabled={props.disabled}
                        onChange={(value) =>
                          changeStep(index, {
                            subject: value.replace(/[\r\n]+/g, ' '),
                          })
                        }
                      >
                        <TextField.Label class="text-xs">
                          {t('sequences.subject')}
                        </TextField.Label>
                        <TextField.Input
                          class="ph-no-capture"
                          aria-label={t('sequences.subjectOf', {
                            position: position(),
                          })}
                          placeholder={t('sequences.subjectPlaceholder')}
                          maxLength={SEQUENCE_LIMITS.subject}
                        />
                      </TextField>
                    </Show>
                    <TextField
                      class="gap-2"
                      value={step().body}
                      disabled={props.disabled}
                      onChange={(value) => changeStep(index, { body: value })}
                    >
                      <TextField.Label class="text-xs">
                        {t('sequences.message')}
                      </TextField.Label>
                      <TextField.TextArea
                        class="ph-no-capture min-h-36"
                        autoResize
                        aria-label={t('sequences.messageOf', {
                          position: position(),
                        })}
                        placeholder={t('sequences.messagePlaceholder', {
                          token: PERSONALIZATION_TOKENS[0],
                        })}
                        maxLength={SEQUENCE_LIMITS.body}
                      />
                    </TextField>
                    <p class="text-xs text-ink-muted">
                      {t('sequences.personalizeHint', {
                        tokens: PERSONALIZATION_TOKENS.join(', '),
                      })}
                    </p>
                  </div>
                </ComposerSurface>
              </article>
            </div>
          );
        }}
      </Index>
      <Show when={!props.disabled}>
        <Button
          type="button"
          variant="secondary"
          fullWidth
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
          {t('sequences.addEmail')}
        </Button>
      </Show>
      <div class="space-y-3 rounded-lg bg-panel/50 px-4 py-3">
        <div class="flex items-center gap-3">
          <CheckIcon class="size-4 text-success" aria-hidden="true" />
          <div>
            <p class="text-sm font-medium">{t('sequences.ends')}</p>
            <p class="text-xs text-ink-muted">{t('sequences.endsHint')}</p>
          </div>
        </div>
        <label class="block space-y-2 text-xs font-medium">
          {t('sequences.footer')}
          <Input
            class="ph-no-capture"
            value={props.draft.footer}
            maxLength={SEQUENCE_LIMITS.footer}
            disabled={props.disabled}
            placeholder={t('sequences.footerPlaceholder')}
            onInput={(event) => change({ footer: event.currentTarget.value })}
          />
          <span class="block font-normal text-ink-muted">
            {t('sequences.footerHint')}
          </span>
        </label>
      </div>
    </div>
  );
}
