import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createRecordingView } from './recording-view';

describe('recording view navigation', () => {
  it('opens the transcript panel on Summary without disabling the Transcript tab', () => {
    createRoot((dispose) => {
      const view = createRecordingView(() => true);
      view.setContentTab('transcript');
      view.toggleTranscript();
      expect(view.transcriptOpen()).toBe(true);
      expect(view.contentTab()).toBe('summary');
      view.setContentTab('transcript');
      expect(view.contentTab()).toBe('transcript');
      expect(view.transcriptOpen()).toBe(true);
      view.toggleTranscript();
      expect(view.transcriptOpen()).toBe(false);
      expect(view.contentTab()).toBe('transcript');
      dispose();
    });
  });

  it('keeps the panel out of narrow panes while retaining reading tab navigation', () => {
    createRoot((dispose) => {
      const [wide, setWide] = createSignal(false);
      const view = createRecordingView(wide);
      view.setContentTab('transcript');
      view.toggleTranscript();
      expect(view.transcriptOpen()).toBe(false);
      expect(view.contentTab()).toBe('transcript');
      setWide(true);
      view.toggleTranscript();
      expect(view.transcriptOpen()).toBe(true);
      setWide(false);
      expect(view.transcriptOpen()).toBe(false);
      view.setContentTab('transcript');
      expect(view.contentTab()).toBe('transcript');
      dispose();
    });
  });
});
