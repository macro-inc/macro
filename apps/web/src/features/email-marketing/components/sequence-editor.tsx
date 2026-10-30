import { t } from '@app/lib/i18n';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import { Button, Checkbox, ComposerSurface, Input } from '@ui';
import { For, Show } from 'solid-js';
import {
  type Campaign,
  DEFAULT_OPT_OUT_LINE,
  isReplyStep,
  replySubject,
  type Sender,
  type SequenceStep,
  threadSubject,
} from '../core/model';
import { OptionSelect } from './option-select';

const PERSONALIZATION = ['{{firstName}}', '{{name}}', '{{email}}'];

/** Whole days from 0 to 365; an emptied field reads as 0. */
function clampDelay(value: number) {
  return Number.isFinite(value)
    ? Math.min(365, Math.max(0, Math.trunc(value)))
    : 0;
}

export function SequenceEditor(props: {
  campaign: Campaign;
  senders: Sender[];
  disabled: boolean;
  onChange: (campaign: Campaign) => void;
  onPreview: (stepIndex: number) => void;
}) {
  const change = (patch: Partial<Campaign>) =>
    props.onChange({ ...props.campaign, ...patch });
  const changeStep = (id: string, patch: Partial<SequenceStep>) =>
    change({
      steps: props.campaign.steps.map((step) =>
        step.id === id ? { ...step, ...patch } : step
      ),
    });
  return (
    <div class="mx-auto w-full max-w-3xl space-y-7 pb-12">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="space-y-2 text-xs font-medium">
          {t('emailMarketing.campaignName')}
          <Input
            aria-label={t('emailMarketing.campaignName')}
            value={props.campaign.name}
            maxLength={120}
            disabled={props.disabled}
            onInput={(event) => change({ name: event.currentTarget.value })}
          />
        </label>
        <div class="space-y-2 text-xs font-medium">
          <span>{t('emailMarketing.sendFrom')}</span>
          <OptionSelect
            label={t('emailMarketing.sendFrom')}
            value={props.campaign.senderId || undefined}
            placeholder={t('emailMarketing.chooseInbox')}
            disabled={props.disabled}
            options={props.senders.map((sender) => ({
              value: sender.id,
              label: sender.ready
                ? sender.email
                : t('emailMarketing.inboxNeedsReconnect', {
                    email: sender.email,
                  }),
              disabled: !sender.ready,
            }))}
            onChange={(senderId) => change({ senderId })}
          />
        </div>
      </div>
      <label class="block space-y-2 text-xs font-medium">
        {t('emailMarketing.descriptionOptional')}
        <Input
          aria-label={t('emailMarketing.description')}
          value={props.campaign.description}
          maxLength={500}
          disabled={props.disabled}
          placeholder={t('emailMarketing.descriptionPlaceholder')}
          onInput={(event) =>
            change({ description: event.currentTarget.value })
          }
        />
      </label>
      <div class="flex items-center gap-3 rounded-lg border border-edge-muted px-4 py-3">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <FlowArrowIcon class="size-4" aria-hidden="true" />
        </span>
        <div>
          <p class="text-sm font-medium">
            {t('emailMarketing.sequenceStarts')}
          </p>
          <p class="text-xs text-ink-muted">
            {t('emailMarketing.sequenceStartsHint')}
          </p>
        </div>
      </div>
      <For each={props.campaign.steps.map((step) => step.id)}>
        {(id, index) => {
          const step = () =>
            props.campaign.steps.find((item) => item.id === id)!;
          const position = () => index() + 1;
          const reply = () => isReplyStep(props.campaign.steps, index());
          return (
            <div>
              <div class="ml-7 h-5 border-l border-dashed border-edge" />
              <article
                class="relative"
                aria-label={t('emailMarketing.emailNumber', {
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
                        {t('emailMarketing.emailNumber', {
                          position: position(),
                        })}
                      </h3>
                    </div>
                    <div class="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => props.onPreview(index())}
                      >
                        {t('emailMarketing.preview')}
                      </Button>
                      <Show when={!props.disabled}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t('emailMarketing.moveEmailUp', {
                            position: position(),
                          })}
                          tooltip={t('emailMarketing.moveUp')}
                          disabled={index() === 0}
                          onClick={() => {
                            const steps = [...props.campaign.steps];
                            const at = index();
                            [steps[at - 1], steps[at]] = [
                              steps[at],
                              steps[at - 1],
                            ];
                            change({ steps });
                          }}
                        >
                          <ArrowUpIcon aria-hidden="true" class="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="danger-ghost"
                          size="xs"
                          aria-label={t('emailMarketing.removeEmail', {
                            position: position(),
                          })}
                          disabled={props.campaign.steps.length === 1}
                          onClick={() =>
                            change({
                              steps: props.campaign.steps.filter(
                                (item) => item.id !== id
                              ),
                            })
                          }
                        >
                          {t('emailMarketing.remove')}
                        </Button>
                      </Show>
                    </div>
                  </div>
                  <div class="space-y-4 px-6 pt-4 pb-6">
                    <label class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      {t('emailMarketing.wait')}
                      <Input
                        aria-label={t('emailMarketing.delayDays', {
                          position: position(),
                        })}
                        type="number"
                        min="0"
                        max="365"
                        size="xs"
                        class="w-16"
                        value={step().delayDays}
                        disabled={props.disabled}
                        onInput={(event) =>
                          changeStep(id, {
                            delayDays: clampDelay(
                              event.currentTarget.valueAsNumber
                            ),
                          })
                        }
                      />
                      {index() === 0
                        ? t('emailMarketing.daysAfterStart', {
                            count: step().delayDays || 0,
                          })
                        : t('emailMarketing.daysAfterPrevious', {
                            count: step().delayDays || 0,
                          })}
                    </label>
                    <Show when={index() > 0}>
                      <Checkbox
                        checked={step().asReply === true}
                        disabled={props.disabled}
                        onChange={(checked: boolean) =>
                          changeStep(id, { asReply: checked })
                        }
                        class="text-xs text-ink-muted"
                      >
                        <Checkbox.Control />
                        <Checkbox.Label>
                          {t('emailMarketing.replyInThread')}
                        </Checkbox.Label>
                      </Checkbox>
                    </Show>
                    <label class="block space-y-2 text-xs font-medium">
                      {t('emailMarketing.subject')}
                      <Show
                        when={!reply()}
                        fallback={
                          <p class="text-sm font-normal text-ink-muted">
                            {replySubject(
                              threadSubject(props.campaign.steps, index())
                            )}
                          </p>
                        }
                      >
                        <input
                          aria-label={t('emailMarketing.subjectOf', {
                            position: position(),
                          })}
                          class="w-full rounded-md border-0 bg-transparent text-sm font-normal text-composer-ink outline-none placeholder:text-ink-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent/40 disabled:opacity-60"
                          placeholder={t('emailMarketing.subjectPlaceholder')}
                          maxLength={300}
                          value={step().subject}
                          disabled={props.disabled}
                          onInput={(event) =>
                            changeStep(id, {
                              subject: event.currentTarget.value.replace(
                                /[\r\n]+/g,
                                ' '
                              ),
                            })
                          }
                        />
                      </Show>
                    </label>
                    <label class="block space-y-2 text-xs font-medium">
                      {t('emailMarketing.message')}
                      <textarea
                        aria-label={t('emailMarketing.messageOf', {
                          position: position(),
                        })}
                        class="min-h-36 w-full resize-y rounded-md border-0 bg-transparent text-sm leading-6 font-normal text-composer-ink outline-none placeholder:text-ink-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent/40 disabled:opacity-60"
                        placeholder={t('emailMarketing.messagePlaceholder', {
                          tag: '{{firstName}}',
                        })}
                        maxLength={50_000}
                        value={step().body}
                        disabled={props.disabled}
                        onInput={(event) =>
                          changeStep(id, { body: event.currentTarget.value })
                        }
                      />
                    </label>
                    <p class="text-xs text-ink-muted">
                      {t('emailMarketing.personalizeHint', {
                        tags: PERSONALIZATION.join(', '),
                      })}
                    </p>
                  </div>
                </ComposerSurface>
              </article>
            </div>
          );
        }}
      </For>
      <Show when={!props.disabled}>
        <Button
          type="button"
          variant="secondary"
          fullWidth
          disabled={props.campaign.steps.length >= 20}
          onClick={() =>
            change({
              steps: [
                ...props.campaign.steps,
                {
                  id: crypto.randomUUID(),
                  delayDays: props.campaign.steps.length ? 2 : 0,
                  subject: '',
                  body: '',
                  asReply: props.campaign.steps.length > 0 || undefined,
                },
              ],
            })
          }
        >
          {t('emailMarketing.addEmail')}
        </Button>
      </Show>
      <div class="space-y-3 rounded-lg bg-panel/50 px-4 py-3">
        <div class="flex items-center gap-3">
          <CheckIcon class="size-4 text-success" aria-hidden="true" />
          <div>
            <p class="text-sm font-medium">
              {t('emailMarketing.sequenceEnds')}
            </p>
            <p class="text-xs text-ink-muted">
              {t('emailMarketing.sequenceEndsHint')}
            </p>
          </div>
        </div>
        <label class="block space-y-2 text-xs font-medium">
          {t('emailMarketing.optOutLine')}
          <Input
            aria-label={t('emailMarketing.optOutLine')}
            value={props.campaign.optOutLine ?? DEFAULT_OPT_OUT_LINE}
            maxLength={300}
            disabled={props.disabled}
            onInput={(event) =>
              change({ optOutLine: event.currentTarget.value })
            }
          />
        </label>
      </div>
    </div>
  );
}
