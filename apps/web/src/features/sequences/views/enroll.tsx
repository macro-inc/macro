import { t } from '@app/lib/i18n';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { addMinutes, format, isValid, roundToNearestMinutes } from 'date-fns';
import { createSignal, Show } from 'solid-js';
import { EnrollDialog, type EnrollOutcome } from '../components/enroll-dialog';
import { failureMessage } from '../components/failure-message';
import { OptionSelect } from '../components/option-select';
import { type Person, useSequences } from '../context/sequences-context';
import { SEQUENCE_LIMITS } from '../core/sequence';

const SURFACE = 'sequences.enroll';

/** The next five-minute mark, as a `datetime-local` value in local time. */
function defaultStart() {
  return format(
    roundToNearestMinutes(addMinutes(new Date(), 5), {
      nearestTo: 5,
      roundingMethod: 'ceil',
    }),
    "yyyy-MM-dd'T'HH:mm"
  );
}

/** Choose a sequence among the owner's sending ones. */
function SequencePicker(props: {
  value: string | undefined;
  onChange: (sequenceId: string) => void;
}) {
  const list = useSequences().createSequenceList();
  const active = () =>
    list.sequences().filter((sequence) => sequence.status === 'active');
  return (
    <Show
      when={list.pending() || active().length}
      fallback={
        <p class="text-xs text-ink-muted">{t('sequences.noActiveSequences')}</p>
      }
    >
      <OptionSelect
        label={t('sequences.sequence')}
        placeholder={t('sequences.chooseSequence')}
        value={props.value}
        options={active().map((sequence) => ({
          value: sequence.id,
          label: sequence.name || t('sequences.untitled'),
        }))}
        onChange={props.onChange}
      />
    </Show>
  );
}

/**
 * Enroll CRM People into a sequence. With no `sequence` the dialog asks for
 * one, as "Add to sequence" on selected people does.
 */
export function EnrollView(props: {
  sequence?: { id: string; name: string };
  initial?: readonly Person[];
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const context = useSequences();
  const [search, setSearch] = createSignal('');
  const people = context.createPeople(debouncedDependent(search, 250));
  const enroller = context.createEnroller();
  const [picked, setPicked] = createSignal<string>();
  const sequenceId = () => props.sequence?.id ?? picked();
  const [selected, setSelected] = createSignal<readonly Person[]>(
    props.initial?.slice(0, SEQUENCE_LIMITS.contacts) ?? []
  );
  const [start, setStart] = createSignal(defaultStart());
  const [consent, setConsent] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [outcome, setOutcome] = createSignal<EnrollOutcome>();
  const select = (person: Person, checked: boolean) => {
    setError(undefined);
    setSelected((current) => [
      ...current.filter((item) => item.id !== person.id),
      ...(checked ? [person] : []),
    ]);
  };

  async function enroll() {
    const id = sequenceId();
    const startAt = new Date(start());
    if (!id) return;
    if (!isValid(startAt)) {
      setError(t('sequences.errorInvalidStart'));
      return;
    }
    const chosen = selected();
    const result = await enroller.enroll(id, {
      crmContactIds: chosen.map((person) => person.id),
      start: startAt.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (result.isErr()) {
      setError(failureMessage(result.error));
      return;
    }
    const byId = new Map(chosen.map((person) => [person.id, person]));
    const enrolled = result.value.filter((item) => item.enrollmentId).length;
    const skipped = result.value.flatMap((item) =>
      item.skipped
        ? [
            {
              person: byId.get(item.crmContactId) ?? {
                id: item.crmContactId,
                name: '',
                email: '',
              },
              skip: item.skipped,
            },
          ]
        : []
    );
    if (enrolled)
      context.feedback.success(
        t('sequences.enrolledCount', { count: enrolled })
      );
    if (skipped.length) setOutcome({ enrolled, skipped });
    else props.onClose();
  }

  return (
    <EnrollDialog
      sequence={
        props.sequence ? (
          <p class="truncate text-xs text-ink-muted">
            {t('sequences.enrollInto', {
              name: props.sequence.name || t('sequences.untitled'),
            })}
          </p>
        ) : (
          <SequencePicker
            value={picked()}
            onChange={(id) => {
              setError(undefined);
              setPicked(id);
            }}
          />
        )
      }
      search={search()}
      onSearch={setSearch}
      people={people.people()}
      peoplePending={people.pending()}
      peopleFailed={people.failed()}
      selected={selected()}
      onSelect={select}
      start={start()}
      onStart={(value) => {
        setError(undefined);
        setStart(value);
      }}
      consent={consent()}
      onConsent={setConsent}
      canEnroll={!!sequenceId()}
      busy={enroller.pending()}
      error={error()}
      outcome={outcome()}
      onEnroll={() => fireAndForget(enroll(), SURFACE)}
      onClose={props.onClose}
      onCloseAutoFocus={props.onCloseAutoFocus}
    />
  );
}
