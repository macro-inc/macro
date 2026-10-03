import {
  useRoutineQuery,
  useShareRoutineMutation,
} from '@queries/agent-schedule/routines';
import { useUserTeamsQuery } from '@queries/team/teams';
import { For, Show, Suspense } from 'solid-js';
import { getErrorMessage } from './component/automationUtils';

function Sharing(props: { id: string }) {
  const routine = useRoutineQuery(() => props.id);
  const teams = useUserTeamsQuery();
  const mutation = useShareRoutineMutation();
  const teamId = () => (routine.isSuccess ? (routine.data.team_id ?? '') : '');
  const options = () => (teams.isSuccess ? (teams.data ?? []) : []);
  return (
    <div class="grid gap-2">
      <label class="grid gap-2 text-sm text-ink">
        Share with your team
        <select
          aria-label="Routine visibility"
          class="max-w-sm rounded-md border border-edge-muted bg-input p-2 text-sm text-ink"
          value={teamId()}
          disabled={
            !routine.isSuccess || !teams.isSuccess || mutation.isPending
          }
          onChange={(e) =>
            mutation.mutate({
              id: props.id,
              teamId: e.currentTarget.value || null,
            })
          }
        >
          <option value="">Only me</option>
          <For each={options()}>
            {(team) => <option value={team.id}>{team.name}</option>}
          </For>
        </select>
      </label>
      <p class="text-xs leading-relaxed text-ink-muted">
        Team members can view the instructions and run history. You control
        editing and execution. Run conversations keep their existing access.
      </p>
      <Show when={mutation.isError}>
        <p role="alert" class="text-xs text-failure">
          Could not update sharing. {getErrorMessage(mutation.error)}
        </p>
      </Show>
      <Show when={routine.isError || teams.isError}>
        <p role="alert" class="text-xs text-failure">
          Could not load sharing options.{' '}
          <button
            class="underline"
            onClick={() => {
              void routine.refetch();
              void teams.refetch();
            }}
          >
            Retry
          </button>
        </p>
      </Show>
    </div>
  );
}
export function RoutineSharing(props: { id: string }) {
  return (
    <Suspense fallback={<p class="text-xs text-ink-muted">Loading sharing…</p>}>
      <Sharing id={props.id} />
    </Suspense>
  );
}
