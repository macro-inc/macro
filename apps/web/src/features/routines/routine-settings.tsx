import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useMobileSettings } from '@app/features/settings/context/mobile-settings';
import { SettingsPage } from '@app/features/settings/primitives';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getErrorMessage } from './core/routine-draft';
import { createRoutineListSource } from './queries/routine-sources';
import { createRoutineTargetDisplay } from './queries/routine-target-display';
import { RoutinesListView } from './views/routines-list';

/** Settings → Routines: the touch entry to the list the Agents sidebar links on desktop. */
export function RoutineSettings() {
  const layout = useSplitLayout();
  const settings = useMobileSettings();
  const userId = useUserId();
  const display = createRoutineTargetDisplay();
  const source = createRoutineListSource((error) =>
    toast.alert('Could not update routine', { subtext: getErrorMessage(error) })
  );
  const open = (id: string) => {
    settings.close();
    openAgentsPage(layout, 'routines', { routineId: id });
  };
  const create = () => {
    settings.close();
    layout.popoverSplit({
      type: 'component',
      id: 'routine-compose',
      params: { onCreated: open },
    });
  };
  return (
    <SettingsPage title="Routines" bodyClass="[--mobile-content-inset-top:0px]">
      <RoutinesListView
        source={source}
        userId={userId}
        targetLabel={display.targetLabel}
        targetModel={display.targetModel}
        showTitle={false}
        onCreate={create}
        onOpen={open}
      />
    </SettingsPage>
  );
}
