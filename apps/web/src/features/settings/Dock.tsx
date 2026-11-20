import { t } from '@app/lib/i18n';
import {
  type DockAlignment,
  type DockPosition,
  type DockSize,
  dockAlignment,
  dockPosition,
  dockSize,
  setDockAlignment,
  setDockPosition,
  setDockSize,
} from '@components/app/dock-prefs';
import { CustomizeNavItems } from '@components/app/sidebar-next/customize-sidebar-modal';
import { useNavItemGates } from '@components/app/sidebar-next/use-nav-item-gates';
import { Tabs } from '@ui';
import { DockPositionPicker } from './components/dock-position-picker';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';
import { TeamLogoSettings } from './TeamLogoSettings';

/**
 * Settings → Dock: which window edge the app rail sits against, its size, where
 * its apps sit along it, and which apps it shows (the More menu's Customize
 * sidebar list), plus the team logo that replaces + on the dock. Edge, size,
 * alignment and showing the logo are saved on this device; the app list is
 * the rail's own preference; the logo belongs to the team.
 */
export function Dock() {
  const gates = useNavItemGates();

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

  const alignments = (): { value: DockAlignment; label: string }[] => [
    { value: 'start', label: t('settingsDock.alignStart') },
    { value: 'center', label: t('settingsDock.alignCenter') },
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
            <SettingsRow
              label={t('settingsDock.alignmentLabel')}
              description={t('settingsDock.alignmentDescription')}
            >
              <Tabs
                aria-label={t('settingsDock.alignmentLabel')}
                size="sm"
                options={alignments()}
                value={dockAlignment()}
                onChange={setDockAlignment}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection
          title={t('settingsDock.appsTitle')}
          target="Apps"
          description={t('settingsDock.appsDescription')}
        >
          <CustomizeNavItems gates={gates()} />
        </SettingsSection>

        <TeamLogoSettings />
      </SettingsPage>
    </div>
  );
}
