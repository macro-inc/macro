import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import MonitorIcon from '@icon/system/regular/desktop.svg';
import { ButtonGroup } from '@ui';
import { Show } from 'solid-js';
import { useOptionalScreen } from '../context/screen-context';

export function ScreenToggle() {
  const screen = useOptionalScreen();
  if (!screen) return null;
  return (
    <Show when={screen.available()}>
      <HeaderActionGroup label={t('computers.screenTitle')}>
        <ButtonGroup.Button
          size="sm"
          variant="ghost"
          aria-label={t('computers.screen')}
          aria-pressed={screen.open()}
          onClick={() => screen.setOpen(!screen.open())}
        >
          <MonitorIcon class="size-3.5" />
          <span class="@max-[28rem]/split-header:hidden">
            {t('computers.screen')}
          </span>
        </ButtonGroup.Button>
      </HeaderActionGroup>
    </Show>
  );
}
