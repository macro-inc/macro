import { getIconConfig } from '@core/component/EntityIcon';
import SquaresFourIcon from '@phosphor/squares-four.svg';
import UsersIcon from '@phosphor/users.svg';
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
  return (
    <Tabs
      aria-label="Record sections"
      touch="inset"
      class="shrink-0"
      options={props.sections.map((section) => ({
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
