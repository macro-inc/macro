import type { ParentComponent } from 'solid-js';
import { TabsInset, type TabsInsetProps } from './TabsInset';

/** Full-width compatibility adapter for the shared inset segmented control. */
export const TabbedControl: ParentComponent<TabsInsetProps> = (props) => (
  <TabsInset {...props} fullWidth class="h-auto" labelClass="py-1.5" />
);
