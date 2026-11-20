import { t } from '@app/lib/i18n';
import { getIconConfig } from '@core/component/EntityIcon';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import { Tabs } from '@ui';
import type { Accessor } from 'solid-js';
import type { ProjectSection } from '../../core/project';

export function ProjectSectionTabs(props: {
  compact: Accessor<boolean>;
  section: ProjectSection;
  onChange(section: ProjectSection): void;
}) {
  return (
    <Tabs
      aria-label={t('tabs.projectSections')}
      touch="inset"
      class="shrink-0"
      options={[
        {
          value: 'overview',
          label: t('tabs.project-overview'),
          icon: props.compact() ? SquaresFourIcon : undefined,
        },
        {
          value: 'tasks',
          label: t('tabs.project-tasks'),
          icon: props.compact() ? getIconConfig('task').icon : undefined,
        },
      ]}
      iconOnly={props.compact()}
      value={props.section}
      onChange={props.onChange}
    />
  );
}
