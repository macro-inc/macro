import type { ComponentProps } from 'solid-js';
import { useMobileSettings } from '../settings/context/mobile-settings';
import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { Crm as View } from './views/crm-settings';
export function CrmSettings(props: ComponentProps<typeof View>) {
  const settings = useMobileSettings();
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View
        {...props}
        onOpenThread={() => {
          settings.close();
          props.onOpenThread?.();
        }}
      />
    </CrmProvider>
  );
}
