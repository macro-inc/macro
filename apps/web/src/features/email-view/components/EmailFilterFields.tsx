import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { parseDomain } from '@core/util/domain';
import GlobeIcon from '@icon/system/regular/globe.svg';
import {
  Button,
  ChipCombobox,
  type ChipComboboxDisplay,
  type ChipComboboxOption,
  Input,
} from '@ui';
import * as EmailValidator from 'email-validator';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { EmailParticipantSuggestion } from '../queries/use-email-participant-suggestions';
import type { EmailParticipant, EmailParticipantField } from '../types';

// People and domains share one picker, so their values are tagged.
const PERSON = 'person:';
const DOMAIN = 'domain:';

export const participantValue = (person: EmailParticipant) =>
  person.type === 'address'
    ? `${PERSON}${person.email}`
    : `${DOMAIN}${person.domain}`;

export const participantOf = (value: string): EmailParticipant | undefined => {
  if (value.startsWith(PERSON))
    return { type: 'address', email: value.slice(PERSON.length) };
  if (value.startsWith(DOMAIN))
    return { type: 'domain', domain: value.slice(DOMAIN.length) };
  return undefined;
};

export const participantsOf = (values: readonly string[]) =>
  values.flatMap((value) => {
    const person = participantOf(value);
    return person ? [person] : [];
  });

/** An address is a person; a domain, `@domain` or website is a domain. */
export const parseParticipant = (text: string) => {
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
export const describeParticipant = (value: string): ChipComboboxDisplay => {
  const person = participantOf(value);
  if (!person) return { label: value };
  return person.type === 'address'
    ? { label: person.email, icon: personIcon(person.email) }
    : { label: person.domain, icon: domainIcon };
};

export const participantOption = (
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

export const PARTICIPANT_FIELDS: readonly EmailParticipantField[] = [
  'from',
  'to',
  'cc',
  'bcc',
];

export const participantFieldLabel = (field: EmailParticipantField) =>
  ({
    from: t('emailViews.fieldFrom'),
    to: t('emailViews.fieldTo'),
    cc: t('emailViews.fieldCc'),
    bcc: t('emailViews.fieldBcc'),
  })[field];

/** Looking nowhere matches nothing, so the last field stays on. */
export const toggleParticipantField = (
  fields: readonly EmailParticipantField[],
  field: EmailParticipantField
): EmailParticipantField[] | undefined => {
  const next = fields.includes(field)
    ? fields.filter((value) => value !== field)
    : [...fields, field];
  return next.length > 0
    ? PARTICIPANT_FIELDS.filter((value) => next.includes(value))
    : undefined;
};

/** Comma-separated subject phrases, at the length the server accepts. */
export const parseSubject = (text: string) =>
  text
    .split(',')
    .map((entry) => entry.trim().slice(0, 200))
    .filter(Boolean);

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

// Enter in a list field ends the entry, never submits the whole view.
const keepEnterInField = (event: KeyboardEvent) => {
  if (event.key === 'Enter') event.preventDefault();
};

/** Where to look for the chosen people: From, To, Cc and Bcc toggles. */
export function EmailMatchFromField(props: {
  fields: readonly EmailParticipantField[];
  onChange: (fields: EmailParticipantField[]) => void;
  size?: 'xs' | 'sm';
}) {
  const labelId = createUniqueId();
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <span id={labelId} class="mr-1 text-xs text-ink-muted">
        {t('emailViews.matchFrom')}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        class="flex flex-wrap gap-1.5"
      >
        <For each={PARTICIPANT_FIELDS}>
          {(field) => (
            <Button
              type="button"
              variant="secondary"
              size={props.size ?? 'sm'}
              aria-pressed={props.fields.includes(field)}
              onClick={() => {
                const next = toggleParticipantField(props.fields, field);
                if (next) props.onChange(next);
              }}
            >
              {participantFieldLabel(field)}
            </Button>
          )}
        </For>
      </div>
    </div>
  );
}

/** People and companies in one chip picker, with where to look for them. */
export function EmailParticipantsField(props: {
  participants: readonly EmailParticipant[];
  participantFields: readonly EmailParticipantField[];
  onParticipantsChange: (participants: EmailParticipant[]) => void;
  onFieldsChange: (fields: EmailParticipantField[]) => void;
  suggestions: Accessor<EmailParticipantSuggestion[]>;
}) {
  // Other edits rebuild the filters; keep the chips unless the people change.
  const values = createMemo(
    () => props.participants.map(participantValue),
    undefined,
    { equals: sameList }
  );
  const options = createMemo(() => props.suggestions().map(participantOption));

  return (
    <>
      <ChipCombobox
        aria-label={t('emailViews.people')}
        placeholder={t('emailViews.peoplePlaceholder')}
        values={values()}
        onChange={(next) => props.onParticipantsChange(participantsOf(next))}
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
      <EmailMatchFromField
        fields={props.participantFields}
        onChange={props.onFieldsChange}
      />
    </>
  );
}

/**
 * Subject phrases typed as one comma-separated line. What was typed stays
 * while it still describes the subject, so a trailing comma survives; an
 * outside change replaces it.
 */
export function EmailSubjectField(props: {
  subject: readonly string[];
  onChange: (subject: string[]) => void;
}) {
  const [draft, setDraft] = createSignal<string>();
  const text = () => {
    const typed = draft();
    return typed !== undefined && sameList(parseSubject(typed), props.subject)
      ? typed
      : props.subject.join(', ');
  };

  return (
    <Input
      aria-label={t('emailViews.subjectContains')}
      placeholder={t('emailViews.subjectPlaceholder')}
      value={text()}
      onKeyDown={keepEnterInField}
      maxLength={2000}
      onInput={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        props.onChange(parseSubject(value));
      }}
    />
  );
}
