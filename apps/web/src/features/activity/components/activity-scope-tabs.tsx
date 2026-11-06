import { PillTabs } from '@components/app/mobile/PillTabs';
import { Tabs } from '@ui';
import type { ActivityScope } from '../core/event';

const SCOPE_TABS: { value: ActivityScope; label: string }[] = [
  { value: 'mine', label: 'You' },
  { value: 'team', label: 'Team' },
];

/** The You / Team switch, as view tabs after the split header title. */
export function ActivityScopeTabs(props: {
  value: ActivityScope;
  onChange: (scope: ActivityScope) => void;
}) {
  return (
    <Tabs
      aria-label="Whose activity"
      options={SCOPE_TABS}
      value={props.value}
      onChange={props.onChange}
    />
  );
}

/** The same switch as the touch pill strip, under the floating header. */
export function ActivityScopePills(props: {
  value: ActivityScope;
  onChange: (scope: ActivityScope) => void;
}) {
  return (
    <PillTabs
      items={SCOPE_TABS}
      value={props.value}
      onChange={props.onChange}
    />
  );
}
