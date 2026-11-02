import { MeetingReference } from '@app/features/calendar-notes/meeting-reference';
import type { DocumentReference } from '@app/features/calendar-notes/queries/notes-source';
import { documentLinksOptions } from '@app/features/calendar-notes/queries/notes-source';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { References } from '@core/component/References';
import { enableCalendarMeetingNotes } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import { useQuery } from '@tanstack/solid-query';
import { Button } from '@ui';
import { For, Show, Suspense } from 'solid-js';

/** Keep the meeting source unmounted while its rollout flag is off. */
export function MarkdownReferencesSection(props: { documentId: string }) {
  const flag = useFeatureFlag(enableCalendarMeetingNotes);
  const userId = useUserId();
  return (
    <Show
      when={flag().enabled && userId()}
      fallback={<ReferencesSection documentId={props.documentId} />}
    >
      <Suspense fallback={<ReferencesSection documentId={props.documentId} />}>
        <ReferencesWithMeetings documentId={props.documentId} />
      </Suspense>
    </Show>
  );
}

function ReferencesWithMeetings(props: { documentId: string }) {
  const userId = useUserId();
  const links = useQuery(() =>
    documentLinksOptions(userId(), props.documentId)
  );
  return (
    <ReferencesSection
      documentId={props.documentId}
      meetings={queryReadyGate(links) ? links.data : []}
      meetingError={links.isError}
      onRetry={() =>
        fireAndForget(links.refetch(), 'calendar.notes.references.retry')
      }
    />
  );
}

function ReferencesSection(props: {
  documentId: string;
  meetings?: DocumentReference[];
  meetingError?: boolean;
  onRetry?: () => void;
}) {
  const sidePanel = useSidePanel();
  const references = useAttachmentReferencesQuery(
    () => props.documentId,
    () => 'document'
  );
  const attachmentCount = () =>
    queryReadyGate(references) ? references.data.length : 0;
  const count = () => attachmentCount() + (props.meetings?.length ?? 0);
  return (
    <Show when={count() > 0 || props.meetingError}>
      <SidePanel.Section
        id="references"
        title={<SidePanel.CountTitle label="References" count={count()} />}
        order={33}
      >
        <div class="text-xs">
          <Show when={props.meetingError}>
            <div
              role="alert"
              class="flex items-center justify-between gap-2 py-2 text-ink-muted"
            >
              Couldn’t load meeting references.
              <Button variant="ghost" size="sm" onClick={props.onRetry}>
                Retry
              </Button>
            </div>
          </Show>
          <For each={props.meetings}>
            {(link) => (
              <MeetingReference
                documentId={props.documentId}
                link={link}
                onOpenCalendar={() => {
                  if (isMobile()) sidePanel?.setIsOpen(false);
                }}
              />
            )}
          </For>
          <Show when={attachmentCount() > 0}>
            <References documentId={props.documentId} />
          </Show>
        </div>
      </SidePanel.Section>
    </Show>
  );
}
