import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { parseDomain } from '@core/util/domain';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import {
  Button,
  Checkbox,
  ChipCombobox,
  type ChipComboboxDisplay,
  type ChipComboboxOption,
  Input,
  Tabs,
} from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { cn } from '@ui/utils/classname';
import * as EmailValidator from 'email-validator';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type EmailSavedViewFilters,
  hasAdvancedEmailFilters,
} from '../filters/email-saved-view';
import type { EmailParticipantSuggestion } from '../queries/use-email-participant-suggestions';
import {
  EMAIL_RECEIVED_WITHIN_DAYS,
  type EmailParticipant,
  type EmailParticipantField,
} from '../types';

// People and domains share one picker, so their values are tagged.
const PERSON = 'person:';
const DOMAIN = 'domain:';

const participantValue = (person: EmailParticipant) =>
  person.type === 'address'
    ? `${PERSON}${person.email}`
    : `${DOMAIN}${person.domain}`;

const participantOf = (value: string): EmailParticipant | undefined => {
  if (value.startsWith(PERSON))
    return { type: 'address', email: value.slice(PERSON.length) };
  if (value.startsWith(DOMAIN))
    return { type: 'domain', domain: value.slice(DOMAIN.length) };
  return undefined;
};

/** An address is a person; a domain, `@domain` or website is a domain. */
const parseParticipant = (text: string) => {
  const entry = text.trim().toLowerCase();
  if (EmailValidator.validate(entry)) return `${PERSON}${entry}`;
  const domain = parseDomain(entry);
  return domain ? `${DOMAIN}${domain}` : undefined;
};

const personIcon = (email: string) => () => (
  <UserIcon email={email} size="sm" suppressClick showTooltip={false} />
);
const domainIcon = () => (
  <GlobeIcon class="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
);

/** A chosen person or domain no suggestion describes, such as a typed one. */
const describeParticipant = (value: string): ChipComboboxDisplay => {
  const person = participantOf(value);
  if (!person) return { label: value };
  return person.type === 'address'
    ? { label: person.email, icon: personIcon(person.email) }
    : { label: person.domain, icon: domainIcon };
};

const participantOption = (
  suggestion: EmailParticipantSuggestion
): ChipComboboxOption =>
  match(suggestion)
    .with({ type: 'domain' }, ({ domain, company, contacts }) => ({
      value: `${DOMAIN}${domain}`,
      label: company ?? domain,
      detail: company
        ? domain
        : contacts
          ? t('emailViews.domainContacts', { count: contacts })
          : undefined,
      chipLabel: domain,
      icon: domainIcon,
    }))
    .with({ type: 'address' }, ({ email, name }) => ({
      value: `${PERSON}${email}`,
      label: name ?? email,
      detail: name ? email : undefined,
      icon: personIcon(email),
    }))
    .exhaustive();

// Enter in a list field ends the entry, never submits the whole view.
const keepEnterInField = (event: KeyboardEvent) => {
  if (event.key === 'Enter') event.preventDefault();
};

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const splitList = (text: string) =>
  text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

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

const participantFieldLabel = (field: EmailParticipantField) =>
  ({
    from: t('emailViews.fieldFrom'),
    to: t('emailViews.fieldTo'),
    cc: t('emailViews.fieldCc'),
    bcc: t('emailViews.fieldBcc'),
  })[field];

const PARTICIPANT_FIELDS: readonly EmailParticipantField[] = [
  'from',
  'to',
  'cc',
  'bcc',
];

/**
 * Edits every condition of an email view; the dialog around it owns saving.
 * Typed lists keep their own text, so remount it to show new filters.
 */
/** Shown under a new view's name: an agent can make the view from a request. */
export function EmailSavedViewAgentHint() {
  return (
    <p class="flex items-start gap-2 rounded-md border border-edge-muted bg-input/50 px-3 py-2 text-sm text-ink-muted">
      <SparkleIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t('emailViews.agentHint')}
    </p>
  );
}

export function EmailSavedViewFields(props: {
  filters: EmailSavedViewFilters;
  onChange: (filters: EmailSavedViewFilters) => void;
  inboxes: readonly { id: string; label: string }[];
  suggestions: Accessor<EmailParticipantSuggestion[]>;
}) {
  const matchFromId = createUniqueId();
  const advancedId = createUniqueId();
  // Starts open when the view already uses one, so nothing set is hidden.
  const [advancedOpen, setAdvancedOpen] = createSignal(
    hasAdvancedEmailFilters(props.filters)
  );
  const set = <K extends keyof EmailSavedViewFilters>(
    key: K,
    value: EmailSavedViewFilters[K]
  ) => props.onChange({ ...props.filters, [key]: value });
  const [subjectText, setSubjectText] = createSignal(
    props.filters.subject.join(', ')
  );
  // Other edits rebuild `filters`; keep the chips unless the people change.
  const participants = createMemo(
    () => props.filters.participants.map(participantValue),
    undefined,
    { equals: sameList }
  );
  const options = createMemo(() => props.suggestions().map(participantOption));

  const toggleField = (field: EmailParticipantField) => {
    const fields = props.filters.participantFields.includes(field)
      ? props.filters.participantFields.filter((value) => value !== field)
      : [...props.filters.participantFields, field];
    // Looking nowhere matches nothing; keep at least one field.
    if (fields.length > 0) set('participantFields', fields);
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
        <ChipCombobox
          aria-label={t('emailViews.people')}
          placeholder={t('emailViews.peoplePlaceholder')}
          values={participants()}
          onChange={(next) =>
            set(
              'participants',
              next.flatMap((value) => {
                const person = participantOf(value);
                return person ? [person] : [];
              })
            )
          }
          options={options()}
          describeValue={describeParticipant}
          parseValue={parseParticipant}
          addLabel={(value) =>
            t('emailViews.addEntry', {
              entry: describeParticipant(value).label,
            })
          }
          removeLabel={(entry) => t('emailViews.removeEntry', { entry })}
          portalScope="local"
        />
        <div class="flex flex-wrap items-center gap-1.5">
          <span id={matchFromId} class="mr-1 text-xs text-ink-muted">
            {t('emailViews.matchFrom')}
          </span>
          <div
            role="group"
            aria-labelledby={matchFromId}
            class="flex flex-wrap gap-1.5"
          >
            <For each={PARTICIPANT_FIELDS}>
              {(field) => (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-pressed={props.filters.participantFields.includes(field)}
                  onClick={() => toggleField(field)}
                >
                  {participantFieldLabel(field)}
                </Button>
              )}
            </For>
          </div>
        </div>
      </Section>

      <Section label={t('emailViews.subjectContains')}>
        <Input
          aria-label={t('emailViews.subjectContains')}
          placeholder={t('emailViews.subjectPlaceholder')}
          value={subjectText()}
          onKeyDown={keepEnterInField}
          maxLength={2000}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setSubjectText(text);
            set(
              'subject',
              splitList(text).map((keyword) => keyword.slice(0, 200))
            );
          }}
        />
      </Section>

      <div class="flex flex-col">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="self-start"
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
