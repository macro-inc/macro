import { ViewBreadcrumbs } from '@app/components/view-shell';
import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { callsCallRoute } from '@app/routes/routes';
import { callDetailSearch } from '@block-call/call-route';
import { CallDetailView } from '@block-call/views/CallDetailView';
import PhoneCallIcon from '@phosphor/phone-call.svg';

export function CallsCallDetail() {
  const params = useRouteParams(callsCallRoute);
  const [search] = createSearchParams(callDetailSearch);

  return (
    <CallDetailView
      callId={params.callId}
      transcriptId={search.transcriptId}
      messageId={search.messageId}
      seek={search.seek}
      header={(data) => (
        <>
          <ViewBreadcrumbs.Item
            value={`call:${params.callId}`}
            order={1}
            metadata={{ type: 'call', id: params.callId }}
          >
            {(item) => (
              <ViewBreadcrumbs.Button
                class="gap-1.5"
                isActive={item.isActive()}
                onClick={item.onSelect}
                tooltip={data()?.name ?? 'Call Recording'}
              >
                <PhoneCallIcon class="size-4 shrink-0" />
                <span class="truncate">{data()?.name ?? 'Call Recording'}</span>
              </ViewBreadcrumbs.Button>
            )}
          </ViewBreadcrumbs.Item>
          <ViewBreadcrumbs.Outlet aria-label="Call location" />
        </>
      )}
    />
  );
}
