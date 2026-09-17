import type { CalendarEvent } from '@app/features/calendar/types';
import {
  meetingNotesContent,
  meetingNotesTitle,
} from '@app/features/calendar/utils/meeting-notes';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { createMarkdownFile } from '@core/util/create';

/**
 * Creates a "Notes on <event> <date>" document that opens with a mention of
 * the event and an empty line to type into, then opens it: in a new split
 * beside the calendar on desktop (a loading split holds the place while the
 * document is created), full screen on phones, where `openWithSplit`
 * navigates in place and returns no handle to swap.
 */
export function useTakeMeetingNotes() {
  const { openWithSplit } = useSplitLayout();

  return async (event: CalendarEvent) => {
    const loadingSplit = isMobile()
      ? undefined
      : openWithSplit(
          { type: 'component', id: 'loading' },
          { preferNewSplit: true, activate: true }
        );

    const documentId = await createMarkdownFile({
      title: meetingNotesTitle(event),
      content: meetingNotesContent(event),
      source: 'calendar-meeting-notes',
    });

    if (!documentId) {
      loadingSplit?.goBack();
      toast.failure('Failed to create meeting notes');
      return;
    }

    if (loadingSplit) {
      loadingSplit.replace({
        next: { type: 'md', id: documentId },
        mergeHistory: true,
      });
    } else {
      openWithSplit(
        { type: 'md', id: documentId },
        { preferNewSplit: true, activate: true }
      );
    }
  };
}
