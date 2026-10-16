import { getIconConfig } from '@core/component/EntityIcon';
import { TabsInset } from '@core/component/TabsInset';
import SquaresFourIcon from '@phosphor/squares-four.svg';
import UsersIcon from '@phosphor/users.svg';
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
  const list = () =>
    props.sections.map((section) => {
      const label = CRM_RECORD_SECTION_LABELS[section];
      if (!props.compact) return { value: section, label };
      const Icon = SECTION_ICONS[section];
      return {
        value: section,
        label: (
          <span class="flex items-center" title={label}>
            <Icon class="size-4" />
          </span>
        ),
      };
    });
  return (
    <TabsInset
      list={list()}
      value={props.value}
      onChange={(value) => props.onChange(value as S)}
      aria-label="Record sections"
      class="shrink-0 whitespace-nowrap"
    />
  );
}
