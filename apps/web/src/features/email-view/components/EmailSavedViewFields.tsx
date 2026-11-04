import { t } from '@app/lib/i18n';
import { RecipientSelector } from '@core/component/RecipientSelector';
import type {
  CombinedRecipientItem,
  WithCustomUserInput,
} from '@core/user/combinedRecipient';
import { Button, Checkbox, Input, Tabs } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Show,
} from 'solid-js';
import type { EmailSavedViewFilters } from '../filters/email-saved-view';
import {
  EMAIL_RECEIVED_WITHIN_DAYS,
  type EmailParticipant,
  type EmailParticipantField,
} from '../types';

type RecipientKind = 'user' | 'contact';

// Mirrors the codec's bare-domain rule so typed entries show as accepted.
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

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
export function EmailSavedViewFields(props: {
  filters: EmailSavedViewFilters;
  onChange: (filters: EmailSavedViewFilters) => void;
  inboxes: readonly { id: string; label: string }[];
  recipientOptions: Accessor<CombinedRecipientItem<RecipientKind>[]>;
}) {
  const lookInId = createUniqueId();
  const set = <K extends keyof EmailSavedViewFilters>(
    key: K,
    value: EmailSavedViewFilters[K]
  ) => props.onChange({ ...props.filters, [key]: value });
  const [domainsText, setDomainsText] = createSignal(
    props.filters.participants
      .flatMap((person) => (person.type === 'domain' ? [person.domain] : []))
      .join(', ')
  );
  const [subjectText, setSubjectText] = createSignal(
    props.filters.subject.join(', ')
  );
  const rejectedDomains = () =>
    splitList(domainsText()).filter((entry) => !DOMAIN_PATTERN.test(entry));

  const domains = () =>
    props.filters.participants.filter((person) => person.type === 'domain');
  // Other edits rebuild `filters`; keep the chips unless the people change.
  const addresses = createMemo(
    () =>
      props.filters.participants.flatMap((person) =>
        person.type === 'address' ? [person.email] : []
      ),
    undefined,
    { equals: sameList }
  );
  const setParticipants = (next: {
    addresses?: string[];
    domains?: string[];
  }) => {
    const people: EmailParticipant[] = [
      ...(next.addresses ?? addresses()).map((email) => ({
        type: 'address' as const,
        email,
      })),
      ...(next.domains ?? domains().map((person) => person.domain)).map(
        (domain) => ({ type: 'domain' as const, domain })
      ),
    ];
    set('participants', people);
  };

  // Addresses the picker doesn't know stay as typed entries.
  const selectedRecipients = createMemo(
    (): WithCustomUserInput<RecipientKind>[] =>
      addresses().map((email) => {
        const known = props
          .recipientOptions()
          .find((option) => option.data.email.toLowerCase() === email);
        return (
          known ?? {
            kind: 'custom' as const,
            id: email,
            data: { id: email, email, invalid: false },
          }
        );
      })
  );

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
    <div class="-mx-1 flex max-h-[min(56vh,32rem)] flex-col gap-5 overflow-y-auto px-1 mobile:max-h-none mobile:overflow-visible">
      <Section label={t('emailViews.people')}>
        <RecipientSelector<RecipientKind>
          options={props.recipientOptions}
          selectedOptions={selectedRecipients()}
          setSelectedOptions={(next) =>
            setParticipants({
              addresses: [
                ...new Set(
                  next.flatMap((option) =>
                    option.kind === 'custom' && option.data.invalid
                      ? []
                      : [option.data.email.toLowerCase()]
                  )
                ),
              ],
            })
          }
          placeholder={t('emailViews.peoplePlaceholder')}
          includeSelf
          allowCustomRecipients
          showChipAddresses
          portalScope="local"
        />
        <Input
          aria-label={t('emailViews.domains')}
          placeholder={t('emailViews.domainsPlaceholder')}
          value={domainsText()}
          onKeyDown={keepEnterInField}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setDomainsText(text);
            setParticipants({
              domains: splitList(text)
                .filter((entry) => DOMAIN_PATTERN.test(entry))
                .map((entry) => entry.toLowerCase()),
            });
          }}
        />
        <Show when={rejectedDomains().length}>
          <p role="alert" class="text-xs text-failure-ink">
            {t('emailViews.notDomains', {
              entries: rejectedDomains().join(', '),
            })}
          </p>
        </Show>
        <div class="flex flex-wrap items-center gap-1.5">
          <span id={lookInId} class="mr-1 text-xs text-ink-muted">
            {t('emailViews.lookIn')}
          </span>
          <div
            role="group"
            aria-labelledby={lookInId}
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
        onChange={(value) => set('read', value === 'any' ? undefined : value)}
      />
      <Choice
        label={t('emailViews.done')}
        value={props.filters.done ?? 'any'}
        options={[
          { value: 'not-done', label: t('emailViews.notDone') },
          { value: 'done', label: t('emailViews.doneOnly') },
        ]}
        onChange={(value) => set('done', value === 'any' ? undefined : value)}
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
            EMAIL_RECEIVED_WITHIN_DAYS.find((days) => String(days) === value)
          )
        }
      />

      <Show when={props.inboxes.length > 1}>
        <Section label={t('emailViews.inboxes')}>
          <p class="text-xs text-ink-muted">{t('emailViews.inboxesHint')}</p>
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
                      : props.filters.inboxIds.filter((id) => id !== inbox.id)
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
  );
}
