import { fireAndForget } from '@core/util/fireAndForget';
import { Button, DatePicker } from '@ui';
import { createSignal, Show } from 'solid-js';
import { Field, SelectInput, TimeZoneInput } from './fields';

export function RescheduleForm(props: {
  load: (
    date: string,
    timeZone: string
  ) => Promise<{ startsAt: string; endsAt: string }[]>;
  submit: (startsAt: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [zone, setZone] = createSignal(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [date, setDate] = createSignal('');
  const [slots, setSlots] = createSignal<
    { startsAt: string; endsAt: string }[]
  >([]);
  const [selected, setSelected] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  let request = 0;
  const load = async (value: string) => {
    const current = ++request;
    setDate(value);
    setSlots([]);
    setSelected('');
    setError('');
    if (!value) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const times = await props.load(value, zone());
      if (current === request) {
        setSlots(times);
        setSelected(times[0]?.startsAt ?? '');
      }
    } catch {
      if (current === request) setError('Could not load replacement times.');
    } finally {
      if (current === request) setLoading(false);
    }
  };
  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!date() || !selected() || saving() || loading()) return;
    setError('');
    setSaving(true);
    try {
      await props.submit(selected());
    } catch {
      setError(
        'Could not reschedule this meeting. Refresh before trying again.'
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      class="mt-6 flex flex-col gap-4 border-t border-edge-muted pt-5"
      onSubmit={(e) => fireAndForget(save(e), 'scheduling')}
    >
      <h2 class="font-semibold">Choose a new time</h2>
      <Field label="Your time zone">
        <TimeZoneInput
          value={zone()}
          disabled={saving()}
          onChange={(value) => {
            request++;
            setZone(value);
            setDate('');
            setSlots([]);
            setSelected('');
            setLoading(false);
            setError('');
          }}
        />
      </Field>
      <Field label="Date">
        <DatePicker
          aria-label="Date"
          disabled={saving()}
          required
          value={date()}
          onChange={(value) => fireAndForget(load(value), 'scheduling')}
        />
      </Field>
      <Show
        when={!loading()}
        fallback={
          <p role="status" class="text-sm text-ink-muted">
            Checking availability…
          </p>
        }
      >
        <Show
          when={slots().length}
          fallback={
            <Show when={date()}>
              <p class="text-sm text-ink-muted">
                No available times on this date.
              </p>
            </Show>
          }
        >
          <Field label="Time">
            <SelectInput
              label="Time"
              disabled={saving()}
              value={selected()}
              onChange={setSelected}
              options={slots().map((s) => ({
                value: s.startsAt,
                label: new Date(s.startsAt).toLocaleTimeString([], {
                  timeZone: zone(),
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              }))}
            />
          </Field>
        </Show>
      </Show>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure">
          {error()}
        </p>
      </Show>
      <div class="flex gap-2">
        <Button
          variant="strong"
          type="submit"
          disabled={!selected() || saving() || loading()}
        >
          {saving() ? 'Rescheduling…' : 'Confirm new time'}
        </Button>
        <Button variant="ghost" disabled={saving()} onClick={props.onCancel}>
          Keep current time
        </Button>
      </div>
    </form>
  );
}
