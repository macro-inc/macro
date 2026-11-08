import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSidePanel } from '@components/app/side-panel';
import TranscriptIcon from '@icon/system/regular/subtitles.svg';
import { ButtonGroup } from '@ui';
import { Show } from 'solid-js';
import { useRecordingView } from '../../context/recording-view';

export function CallTranscriptButton() {
  const view = useRecordingView();
  const details = useSidePanel();
  return (
    <Show when={view.canDock()}>
      <HeaderActionGroup label={t('calls.detailTranscript')}>
        <ButtonGroup.Button
          variant="ghost"
          size="sm"
          aria-pressed={view.transcriptOpen()}
          onClick={() => {
            const interaction = beginInteraction('call.transcript.panel', {
              attributes: { 'call.id': view.callId },
            });
            try {
              if (!view.transcriptOpen()) details?.setIsOpen(false);
              view.toggleTranscript();
            } finally {
              interaction.end();
            }
          }}
        >
          <TranscriptIcon class="size-4" />
          {t('calls.detailTranscript')}
        </ButtonGroup.Button>
      </HeaderActionGroup>
    </Show>
  );
}
