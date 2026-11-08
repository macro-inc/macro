import { type Accessor, createSignal } from 'solid-js';

export type RecordingContentTab = 'summary' | 'transcript' | 'chat';

export function createRecordingView(canDock: Accessor<boolean>) {
  const [contentTab, setContentTab] =
    createSignal<RecordingContentTab>('summary');
  const [requestedOpen, setRequestedOpen] = createSignal(false);
  const transcriptOpen = () => canDock() && requestedOpen();
  const toggleTranscript = () => {
    if (!canDock()) return;
    const open = !transcriptOpen();
    if (open && contentTab() === 'transcript') setContentTab('summary');
    setRequestedOpen(open);
  };
  return {
    contentTab,
    setContentTab,
    canDock,
    transcriptOpen,
    toggleTranscript,
  };
}
