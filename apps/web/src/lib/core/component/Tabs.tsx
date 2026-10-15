import { TabsInset, type TabsInsetProps } from '@ui/components/TabsInset';
import { splitProps } from 'solid-js';

export type { InsetTabItem as TabItem } from '@ui/components/TabsInset';

/** Compatibility adapter; the old underline now uses the shared inset toggle. */
export const Tabs = (
  props: TabsInsetProps & { indicatorPosition?: 'top' | 'bottom' }
) => {
  const [, rest] = splitProps(props, ['indicatorPosition']);
  return <TabsInset {...rest} />;
};
