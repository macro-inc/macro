import { TextField } from '@ui';
import {
  conditionPlaceholder,
  type EventTriggerDraft,
  MAX_CONDITION_CHARS,
} from '../core/routine-triggers';

/** Optional yes/no question each event must pass before the routine runs. */
export function RoutineEventCondition(props: {
  trigger: EventTriggerDraft;
  onChange: (condition: string | undefined) => void;
}) {
  return (
    <TextField
      class="mt-3"
      value={props.trigger.condition ?? ''}
      onChange={(value) => props.onChange(value.trim() ? value : undefined)}
    >
      <TextField.Label>Only run if</TextField.Label>
      <TextField.TextArea
        autoResize
        rows={2}
        maxLength={MAX_CONDITION_CHARS}
        placeholder={conditionPlaceholder(props.trigger)}
      />
      <TextField.Description>
        A yes/no question about each event. Events that answer no are skipped.
      </TextField.Description>
    </TextField>
  );
}
