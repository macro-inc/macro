import type { OpenReportTask } from '../../components/time-breakdown';
import type { PersonLabel } from '../../components/time-key-label';
import type {
  ProjectTimeClock,
  SaveCsv,
} from '../../primitives/create-project-time';

/** What a project's Time view needs from the app around it. */
export type ProjectTimeViewProps = {
  project: { id: string; name: string };
  clock: ProjectTimeClock;
  person: PersonLabel;
  onOpenTask: OpenReportTask;
  /** Saves the CSV export; phones offer no export. */
  save: SaveCsv;
};
