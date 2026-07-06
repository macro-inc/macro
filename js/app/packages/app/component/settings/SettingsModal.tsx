import { useSettingsState } from '@core/constant/SettingsState';
import { Dialog, Layer } from '@ui';
import { SettingsPanel } from './Settings';

/**
 * Settings rendered as a scrim-backed modal overlay (the default activation).
 * Use the "Open in split" control in its header to dock it into the split
 * layout instead — see {@link SettingsPanelComponentWrapper}.
 */
export function SettingsModal() {
  const { settingsModalOpen, closeModal } = useSettingsState();

  return (
    <Dialog
      open={settingsModalOpen()}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
      fullscreen
      class="bg-surface"
    >
      <Layer depth={0}>
        <SettingsPanel variant="modal" />
      </Layer>
    </Dialog>
  );
}
