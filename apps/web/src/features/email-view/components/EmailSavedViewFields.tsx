import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { TagDot } from '@property/tags/TagDot';
import type { TagOptionSummary } from '@property/tags/tag-options';
import {
  Button,
  Checkbox,
  ChipCombobox,
  type ChipComboboxOption,
  Tabs,
} from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Show,
} from 'solid-js';
import {
  type EmailSavedViewFilters,
  hasAdvancedEmailFilters,
} from '../filters/email-saved-view';
import type { EmailParticipantSuggestion } from '../queries/use-email-participant-suggestions';
import { EMAIL_RECEIVED_WITHIN_DAYS } from '../types';
import { EmailParticipantsField, EmailSubjectField } from './EmailFilterFields';

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function Section(props: { label: string; children: JSX.Element }) {
  return (
    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="mb-2 text-sm text-ink">{props.label}</legend>
      {props.children}
    </fieldset>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox checked={props.checked} onChange={props.onChange}>
      <Checkbox.Control />
      <Checkbox.Label class="text-sm">{props.label}</Checkbox.Label>
    </Checkbox>
  );
}

/** One optional choice; `any` stands for no restriction. */
function Choice<T extends string>(props: {
  label: string;
  value: T | 'any';
  options: readonly { value: T; label: string }[];
  onChange: (value: T | 'any') => void;
}) {
  return (
    <Section label={props.label}>
      <Tabs<T | 'any'>
        aria-label={props.label}
        size="sm"
        wrap
        options={[
          { value: 'any', label: t('emailViews.any') },
          ...props.options,
        ]}
        value={props.value}
        onChange={props.onChange}
      />
    </Section>
  );
}

/** Shown under a new view's name: an agent can make the view from a request. */
export function EmailSavedViewAgentHint() {
  return (
    <p class="flex items-start gap-2 rounded-md border border-edge-muted bg-input/50 px-3 py-2 text-sm text-ink-muted">
      <SparkleIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t('emailViews.agentHint')}
    </p>
  );
}

/** Edits every condition of an email view; the dialog around it owns saving. */
export function EmailSavedViewFields(props: {
  filters: EmailSavedViewFilters;
  onChange: (filters: EmailSavedViewFilters) => void;
  inboxes: readonly { id: string; label: string }[];
  suggestions: Accessor<EmailParticipantSuggestion[]>;
  tags: readonly TagOptionSummary[];
}) {
  const advancedId = createUniqueId();
  // Starts open when the view already uses one, so nothing set is hidden.
  const [advancedOpen, setAdvancedOpen] = createSignal(
    hasAdvancedEmailFilters(props.filters)
  );
  const set = <K extends keyof EmailSavedViewFilters>(
    key: K,
    value: EmailSavedViewFilters[K]
  ) => props.onChange({ ...props.filters, [key]: value });
  const tagValues = createMemo(
    () => props.filters.tags.map((tag) => tag.optionId),
    undefined,
    { equals: sameList }
  );
  const tagOptions = createMemo(() =>
    props.tags.map(
      (tag): ChipComboboxOption => ({
        value: tag.id,
        label: tag.label,
        icon: () => <TagDot color={tag.color} />,
      })
    )
  );
  // A chosen tag keeps its stored binding, even one the viewer can't see now.
  const setTags = (ids: string[]) => {
    const bindings = new Map([
      ...props.tags.map((tag) => [tag.id, tag.propertyDefinitionId] as const),
      ...props.filters.tags.map(
        (tag) => [tag.optionId, tag.propertyDefinitionId] as const
      ),
    ]);
    set(
      'tags',
      ids.flatMap((optionId) => {
        const propertyDefinitionId = bindings.get(optionId);
        return propertyDefinitionId ? [{ optionId, propertyDefinitionId }] : [];
      })
    );
  };

  const toggleAttachment = (
    id: EmailSavedViewFilters['attachments'][number],
    checked: boolean
  ) =>
    set(
      'attachments',
      checked
        ? [...props.filters.attachments, id]
        : props.filters.attachments.filter((value) => value !== id)
    );

  return (
    <div class="flex flex-col gap-5">
      <Section label={t('emailViews.people')}>
        <EmailParticipantsField
          participants={props.filters.participants}
          participantFields={props.filters.participantFields}
          onParticipantsChange={(participants) =>
            set('participants', participants)
          }
          onFieldsChange={(fields) => set('participantFields', fields)}
          suggestions={props.suggestions}
        />
      </Section>

      <Section label={t('emailViews.subjectContains')}>
        <EmailSubjectField
          subject={props.filters.subject}
          onChange={(subject) => set('subject', subject)}
        />
      </Section>

      <Show when={props.tags.length > 0 || props.filters.tags.length > 0}>
        <Section label={t('emailViews.tags')}>
          <ChipCombobox
            aria-label={t('emailViews.tags')}
            placeholder={t('emailViews.tagsPlaceholder')}
            values={tagValues()}
            onChange={setTags}
            options={tagOptions()}
            describeValue={() => ({ label: t('emailViews.unavailableTag') })}
            addLabel={(value) => t('emailViews.addEntry', { entry: value })}
            removeLabel={(entry) => t('emailViews.removeEntry', { entry })}
            portalScope="local"
          />
        </Section>
      </Show>

      <div class="flex flex-col">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Line the label up with the field labels above it.
          class="-ml-2 self-start"
          aria-expanded={advancedOpen()}
          aria-controls={advancedId}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {t('emailViews.advancedSettings')}
          <CaretDownIcon
            class={cn(
              'size-3 transition-transform',
              !advancedOpen() && '-rotate-90'
            )}
          />
        </Button>
        <CollapseTransition open={advancedOpen()}>
          <div id={advancedId} class="flex flex-col gap-5 pt-4">
            <Choice
              label={t('emailViews.importance')}
              value={props.filters.importance ?? 'any'}
              options={[
                { value: 'signal', label: t('emailViews.signal') },
                { value: 'noise', label: t('emailViews.noise') },
              ]}
              onChange={(value) =>
                set('importance', value === 'any' ? undefined : value)
              }
            />
            <Choice
              label={t('emailViews.status')}
              value={props.filters.read ?? 'any'}
              options={[
                { value: 'unread', label: t('emailViews.unread') },
                { value: 'read', label: t('emailViews.read') },
              ]}
              onChange={(value) =>
                set('read', value === 'any' ? undefined : value)
              }
            />
            <Choice
              label={t('emailViews.done')}
              value={props.filters.done ?? 'any'}
              options={[
                { value: 'not-done', label: t('emailViews.notDone') },
                { value: 'done', label: t('emailViews.doneOnly') },
              ]}
              onChange={(value) =>
                set('done', value === 'any' ? undefined : value)
              }
            />
            <Choice
              label={t('emailViews.received')}
              value={String(props.filters.receivedWithinDays ?? 'any')}
              options={EMAIL_RECEIVED_WITHIN_DAYS.map((days) => ({
                value: String(days),
                label: t('emailViews.lastDays', { count: days }),
              }))}
              onChange={(value) =>
                set(
                  'receivedWithinDays',
                  EMAIL_RECEIVED_WITHIN_DAYS.find(
                    (days) => String(days) === value
                  )
                )
              }
            />

            <Show when={props.inboxes.length > 1}>
              <Section label={t('emailViews.inboxes')}>
                <p class="text-xs text-ink-muted">
                  {t('emailViews.inboxesHint')}
                </p>
                <For each={props.inboxes}>
                  {(inbox) => (
                    <Toggle
                      label={inbox.label}
                      checked={props.filters.inboxIds.includes(inbox.id)}
                      onChange={(checked) =>
                        set(
                          'inboxIds',
                          checked
                            ? [...props.filters.inboxIds, inbox.id]
                            : props.filters.inboxIds.filter(
                                (id) => id !== inbox.id
                              )
                        )
                      }
                    />
                  )}
                </For>
              </Section>
            </Show>

            <Section label={t('emailViews.also')}>
              <Toggle
                label={t('emailViews.starred')}
                checked={props.filters.starred}
                onChange={(checked) => set('starred', checked)}
              />
              <Toggle
                label={t('emailViews.calendarInvite')}
                checked={props.filters.calendarInvite}
                onChange={(checked) => set('calendarInvite', checked)}
              />
              <For
                each={
                  [
                    ['attachment-pdf', t('emailViews.hasPdf')],
                    ['attachment-image', t('emailViews.hasImage')],
                    ['attachment-document', t('emailViews.hasDocument')],
                  ] as const
                }
              >
                {([id, label]) => (
                  <Toggle
                    label={label}
                    checked={props.filters.attachments.includes(id)}
                    onChange={(checked) => toggleAttachment(id, checked)}
                  />
                )}
              </For>
            </Section>
          </div>
        </CollapseTransition>
      </div>
    </div>
  );
}
