import { t } from '@app/lib/i18n';
import {
  type DockPosition,
  type DockSize,
  dockPosition,
  dockSize,
  setDockPosition,
  setDockSize,
} from '@components/app/dock-prefs';
import { Tabs } from '@ui';
import { DockPositionPicker } from './components/dock-position-picker';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

/**
 * Settings → Dock: which window edge the app rail sits against, and its size.
 * Changes apply to the rail at once; the choice is saved on this device.
 */
export function Dock() {
  const positions = (): { value: DockPosition; label: string }[] => [
    { value: 'left', label: t('settingsDock.left') },
    { value: 'top', label: t('settingsDock.top') },
    { value: 'right', label: t('settingsDock.right') },
    { value: 'bottom', label: t('settingsDock.bottom') },
  ];

  const sizes = (): { value: DockSize; label: string }[] => [
    { value: 'large', label: t('settingsDock.large') },
    { value: 'small', label: t('settingsDock.small') },
  ];

  return (
    <div class="h-full">
      <SettingsPage
        title={t('settingsDock.title')}
        description={t('settingsDock.description')}
      >
        <SettingsSection
          title={t('settingsDock.positionTitle')}
          target="Position"
          description={t('settingsDock.positionDescription')}
          class="@container"
        >
          <DockPositionPicker
            label={t('settingsDock.positionLabel')}
            options={positions()}
            value={dockPosition()}
            onChange={setDockPosition}
          />
        </SettingsSection>

        <SettingsSection target="Size">
          <SettingsCard>
            <SettingsRow
              label={t('settingsDock.sizeLabel')}
              description={t('settingsDock.sizeDescription')}
            >
              <Tabs
                aria-label={t('settingsDock.sizeLabel')}
                size="sm"
                options={sizes()}
                value={dockSize()}
                onChange={setDockSize}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </SettingsPage>
    </div>
  );
}
