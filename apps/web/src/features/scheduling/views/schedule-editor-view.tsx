import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { ScheduleEditorForm } from '../components/schedule-editor';
import { availabilityScheduleIssue } from '../core/availability';
import type { AvailabilitySchedule } from '../core/types';
import { ScheduleFields } from './schedule-fields-view';

export function ScheduleEditor(props: {
  schedule: AvailabilitySchedule;
  saving: boolean;
  topBarOwned?: boolean;
  creating?: boolean;
  onSave: (schedule: AvailabilitySchedule) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal(
    structuredClone(unwrap(props.schedule))
  );
  const [error, setError] = createSignal('');
  const [editingRange, setEditingRange] = createSignal(false);
  const update = (
    change: (schedule: AvailabilitySchedule) => AvailabilitySchedule
  ) => {
    setError('');
    setDraft(change);
  };
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (props.saving || editingRange()) return;
    const message = availabilityScheduleIssue(draft());
    setError(message ?? '');
    if (message) return;
    try {
      await props.onSave(draft());
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save schedule.'
      );
    }
  };
  return (
    <ScheduleEditorForm
      saving={props.saving}
      topBarOwned={props.topBarOwned}
      creating={props.creating}
      editingRange={editingRange()}
      error={error()}
      onSubmit={(event) => fireAndForget(save(event), 'scheduling')}
      onCancel={props.onCancel}
    >
      <ScheduleFields
        schedule={draft()}
        disabled={props.saving}
        onEditingChange={setEditingRange}
        onChange={update}
      />
    </ScheduleEditorForm>
  );
}
