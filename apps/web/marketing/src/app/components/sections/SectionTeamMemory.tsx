import { BaseSection } from '../base/BaseSection';
import { SceneTeam } from '../scenes/SceneTeam';

export function SectionTeamMemory() {
  return (
    <BaseSection
      title="Team Memory"
      body="Macro's signal / noise filters make sure only important things land on your desk. Your high priority messages, meetings, & tasks are surfaced front & center, while less important items are still easily accessible but out of the way."
      scene={<SceneTeam />}
      left={true}
    />
  );
}
