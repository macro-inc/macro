import type { ProjectRowProps } from '../components/project-row';
import { ProjectRowColumns } from './shared/project-row-content';

export function DesktopProjectRow(props: ProjectRowProps) {
  return <ProjectRowColumns {...props} />;
}
