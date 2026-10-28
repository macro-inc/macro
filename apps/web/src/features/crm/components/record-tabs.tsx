import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { getIconConfig } from '@core/component/EntityIcon';
import { enableDatabases } from '@core/constant/featureFlags';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Tabs } from '@ui';
import type { Component, JSX } from 'solid-js';
import {
  CRM_RECORD_SECTION_LABELS,
  type CrmRecordSection,
} from '../core/record';

const SECTION_ICONS: Record<
  CrmRecordSection,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  overview: SquaresFourIcon,
  team: UsersIcon,
  emails: getIconConfig('email').icon,
  files: getIconConfig('files').icon,
  tasks: getIconConfig('task').icon,
  calls: getIconConfig('call').icon,
  databases: getIconConfig('database').icon,
};

/**
 * A CRM record's section tabs for its top bar, like a project's Overview /
 * Tasks tabs. `compact` swaps labels for icons when the bar runs out of room.
 */
export function RecordTabs<S extends CrmRecordSection>(props: {
  sections: readonly S[];
  value: S;
  onChange: (section: S) => void;
  compact?: boolean;
}) {
  const databasesFlag = useFeatureFlag(enableDatabases);
  return (
    <Tabs
      aria-label="Record sections"
      touch="inset"
      class="shrink-0"
      options={props.sections
        .filter((section) => section !== 'databases' || databasesFlag().enabled)
        .map((section) => ({
          value: section,
          label: CRM_RECORD_SECTION_LABELS[section],
          icon: props.compact ? SECTION_ICONS[section] : undefined,
        }))}
      iconOnly={props.compact}
      value={props.value}
      onChange={props.onChange}
    />
  );
}
