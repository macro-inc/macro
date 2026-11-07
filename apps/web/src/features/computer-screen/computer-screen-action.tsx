import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import MonitorIcon from '@icon/system/regular/desktop.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useSettingsComputerScreen } from './context/settings-screen-context';
import { useSettingsScreenNavigation } from './context/settings-screen-navigation';

/** The shared settings entry, with the server deciding access when opened. */
export function ComputerScreenAction(props: {
  harnessId: string;
  available: boolean;
}) {
  const flag = useFeatureFlag(enableMacroComputers);
  const screen = useSettingsComputerScreen();
  return (
    <Show when={!flag().loading && flag().enabled && props.available}>
      <Show
        when={screen}
        fallback={
          <OutsideSettingsAction
            harnessId={props.harnessId}
            enabled={() => !flag().loading && flag().enabled}
          />
        }
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (!flag().loading && flag().enabled)
              screen?.openHarness(props.harnessId);
          }}
        >
          <MonitorIcon class="size-4" />
          {t('runtimeSharing.viewComputer')}
        </Button>
      </Show>
    </Show>
  );
}

function OutsideSettingsAction(props: {
  harnessId: string;
  enabled(): boolean;
}) {
  const settings = useSettingsState();
  const navigation = useSettingsScreenNavigation();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        if (!props.enabled()) return;
        const interaction = beginInteraction('computer.screen.open', {
          attributes: { 'harness.id': props.harnessId },
        });
        try {
          navigation.request(props.harnessId);
          settings.openSettings('Harness');
        } finally {
          interaction.end();
        }
      }}
    >
      <MonitorIcon class="size-4" />
      {t('runtimeSharing.viewComputer')}
    </Button>
  );
}
