import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { onMount } from 'solid-js';
import { SettingsPanelComponentWrapper } from './Settings';

export function SettingsRouteView() {
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.setDisplayName(t('nav.settings')));
  return <SettingsPanelComponentWrapper />;
}
