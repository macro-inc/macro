import { t } from '@app/lib/i18n';
import { getIconConfig } from '@core/component/EntityIcon';
import ClockIcon from '@icon/system/regular/clock.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import { Tabs } from '@ui';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { ProjectSection } from '../../core/project';

export function projectSectionLabel(section: ProjectSection): string {
  return match(section)
    .with('overview', () => t('tabs.project-overview'))
    .with('tasks', () => t('tabs.project-tasks'))
    .with('time', () => t('tabs.project-time'))
    .exhaustive();
}

function sectionIcon(section: ProjectSection) {
  return match(section)
    .with('overview', () => SquaresFourIcon)
    .with('tasks', () => getIconConfig('task').icon)
    .with('time', () => ClockIcon)
    .exhaustive();
}

export function ProjectSectionTabs(props: {
  compact: Accessor<boolean>;
  sections: readonly ProjectSection[];
  section: ProjectSection;
  onChange(section: ProjectSection): void;
  ref?: (element: HTMLElement) => void;
}) {
  return (
    <Tabs
      ref={props.ref}
      aria-label={t('tabs.projectSections')}
      touch="inset"
      class="shrink-0"
      options={props.sections.map((section) => ({
        value: section,
        label: projectSectionLabel(section),
        icon: props.compact() ? sectionIcon(section) : undefined,
      }))}
      iconOnly={props.compact()}
      value={props.section}
      onChange={props.onChange}
    />
  );
}
