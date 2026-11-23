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
      class="grid gap-1.5"
      value={props.trigger.condition ?? ''}
      onChange={(value) => props.onChange(value.trim() ? value : undefined)}
    >
      <TextField.Label class="text-xs font-medium text-ink-muted">
        Only run if AI says yes
      </TextField.Label>
      <TextField.TextArea
        autoResize
        rows={2}
        maxLength={MAX_CONDITION_CHARS}
        placeholder={conditionPlaceholder(props.trigger)}
      />
      <TextField.Description class="text-xs leading-4 text-ink-muted">
        AI checks each event with this question. A no skips the run.
      </TextField.Description>
    </TextField>
  );
}
