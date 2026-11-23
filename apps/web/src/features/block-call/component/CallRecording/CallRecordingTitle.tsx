import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import { InlineFetchedEntityTagsPill } from '@property/tags';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { createRecordingIdentity } from '../../primitives/recording-identity';
import {
  CallRecordingAvatars,
  CallRecordingParticipantsSection,
} from './CallRecordingParticipants';

export function CallRecordingTitle(props: { record: CallRecord }) {
  const [participantsOpen, setParticipantsOpen] = createSignal(false);
  const { title, dateRange } = createRecordingIdentity(() => props.record);

  return (
    <header class="flex min-w-0 flex-col gap-1 @container/call-title">
      <Show when={props.record.channelName}>
        {(channel) => (
          <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
            <HashIcon class="size-4 shrink-0" />
            <span class="truncate">{channel()}</span>
          </div>
        )}
      </Show>
      <h1 class="text-2xl font-semibold tracking-tight text-ink text-balance">
        {title()}
      </h1>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
        <Show
          when={isMobile()}
          fallback={<CallRecordingAvatars record={props.record} />}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('calls.detailParticipants')}
            onClick={() => setParticipantsOpen(true)}
          >
            <CallRecordingAvatars record={props.record} suppressClick />
            <CaretRightIcon class="size-4" />
          </Button>
        </Show>
        <span class="mr-auto">{dateRange()}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <Suspense fallback={null}>
          <InlineFetchedEntityTagsPill
            entityId={props.record.callId}
            entityType="CALL_RECORD"
            showAddButton
          />
        </Suspense>
      </div>
      <MobileDrawer
        side="bottom"
        open={participantsOpen()}
        onOpenChange={setParticipantsOpen}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label={t('calls.detailParticipants')}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
              <div class="p-5">
                <CallRecordingParticipantsSection record={props.record} />
              </div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </header>
  );
}
