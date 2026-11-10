import { beginInteraction } from '@app/observability/flow';
import { isMobile } from '@core/mobile/isMobile';
import { createWritableMemo } from '@solid-primitives/memo';
import { createEffect, on } from 'solid-js';
import type { CallTranscriptTarget } from '../constants';

type RecordingTab = 'summary' | 'transcript' | 'chat';
type RecordingNavigationOptions = {
  callId: string;
  transcriptTarget?: CallTranscriptTarget;
  messageTarget?: string;
  messageTargetRequestKey?: string | number;
  goToTranscriptSegment: (transcriptId: string) => void;
};

/** Derive linked reading tabs while retaining explicit user tab selections. */
export function createRecordingNavigation(options: RecordingNavigationOptions) {
  const request = () =>
    [
      options.transcriptTarget,
      options.messageTarget,
      options.messageTargetRequestKey,
    ] as const;
  const [contentTab, setContentTab] = createWritableMemo<RecordingTab>(
    on(
      request,
      (
        [target, message],
        _previousRequest,
        previousTab: RecordingTab | undefined
      ): RecordingTab => {
        if (message) return isMobile() ? 'chat' : 'summary';
        if (target) return 'transcript';
        return previousTab ?? 'summary';
      }
    ),
    'summary'
  );

  // Navigation seeks the existing media element; tab selection stays derived.
  createEffect(
    on(request, ([target, message]) => {
      if (target && !message)
        options.goToTranscriptSegment(target.transcriptId);
    })
  );

  return {
    selectedTab: () =>
      !isMobile() && contentTab() === 'chat' ? 'summary' : contentTab(),
    selectTab: (tab: RecordingTab) => {
      const interaction = beginInteraction('call.detail.tab', {
        attributes: { 'call.id': options.callId, 'call.tab': tab },
      });
      try {
        setContentTab(tab);
      } finally {
        interaction.end();
      }
    },
  };
}
