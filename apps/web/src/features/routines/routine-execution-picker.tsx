import { requestRuntimeAccess } from '@app/features/runtime-sharing/core/request-access';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, type JSX } from 'solid-js';
import type { RosterAgent } from '../agents-view/core/roster';
import { openAgentsPage } from '../agents-view/primitives/open-page';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import { createComposerModels } from '../agents-view/queries/composer-models';
import {
  RoutineExecutionPickerBoundary,
  type RoutineExecutionPickerProps,
  RoutineExecutionPickerView,
} from './views/routine-execution-picker';

export function RoutineExecutionPicker(
  props: RoutineExecutionPickerProps
): JSX.Element {
  return (
    <RoutineExecutionPickerBoundary target={props.target}>
      <ConnectedPicker {...props} />
    </RoutineExecutionPickerBoundary>
  );
}

function ConnectedPicker(props: RoutineExecutionPickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const roster = createAgentRosterSource(
    () => open() || props.target.kind === 'agent'
  );
  const layout = useSplitLayout();
  const { openSettings } = useSettingsState();

  function connect(agent: RosterAgent): void {
    if (agent.needsRuntimeAccess && agent.harnessId) {
      fireAndForget(
        requestRuntimeAccess(agent.harnessId),
        'runtime-sharing.request'
      );
      return;
    }
    if (agent.harness === 'cursor') openSettings('Harness');
  }

  return (
    <RoutineExecutionPickerView
      {...props}
      roster={roster.roster()}
      rosterLoading={roster.loading()}
      rosterError={roster.error()}
      availabilityLoading={roster.availabilityLoading()}
      onOpenChange={setOpen}
      createModels={createComposerModels}
      onConnect={connect}
      onCreate={() => openAgentsPage(layout, 'agents')}
    />
  );
}
