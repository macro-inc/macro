import { SidePanel } from '@app/component/side-panel';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { InlineCheckbox } from '@channel/Call/CallControls/CallMenuPrimitives';
import { useBlockId } from '@core/block';
import { References } from '@core/component/References';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import ClockIcon from '@phosphor/clock.svg';
import {
  useSetCallRecordShareWithTeamMutation,
  useToggleShareWithTeamMutation,
} from '@queries/call/call';
import { commsServiceClient } from '@service-comms/client';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { cn } from '@ui';
import { type Accessor, createResource, Show, Suspense } from 'solid-js';
import { formatCallDuration } from '../../utils';

interface CallSidePanelSectionsProps {
  record: Accessor<CallRecord>;
}

export function CallSidePanelSections(props: CallSidePanelSectionsProps) {
  const blockId = useBlockId();

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <DetailsSectionContent record={props.record} />
      </SidePanel.Section>
      <SidePanel.Section id="sharing" title="Sharing" order={20}>
        <SharingSectionContent record={props.record} />
      </SidePanel.Section>
      <ReferencesSectionConditional callId={blockId} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Details Section
// ─────────────────────────────────────────────────────────────────────────────

function DetailsSectionContent(props: { record: Accessor<CallRecord> }) {
  const record = props.record;

  const startedAt = (): DateValue | undefined => record().startedAt;
  const endedAt = (): DateValue | undefined => record().endedAt ?? undefined;
  const durationMs = () => record().durationMs ?? undefined;

  return (
    <div class="grid grid-cols-[var(--sidepanel-label-width,auto)_1fr] gap-x-3 items-center text-xs auto-rows-[2rem]">
      <DetailsRow label="Owner">
        <OwnerValue ownerId={record().createdBy} />
      </DetailsRow>
      <Show when={startedAt()}>
        {(value) => (
          <DetailsRow label="Started">
            <DateValueDisplay value={value()} />
          </DetailsRow>
        )}
      </Show>
      <Show when={endedAt()}>
        {(value) => (
          <DetailsRow label="Ended">
            <DateValueDisplay value={value()} />
          </DetailsRow>
        )}
      </Show>
      <Show when={durationMs()}>
        {(ms) => (
          <DetailsRow label="Duration">
            <span class={cn(PILL_CLASS, 'w-fit')}>
              <ClockIcon class="size-3 shrink-0" />
              <span class="truncate">{formatCallDuration(ms())}</span>
            </span>
          </DetailsRow>
        )}
      </Show>
      <DetailsRow label="Status">
        <span class={cn(PILL_CLASS, 'w-fit')}>
          <Show
            when={record().isActive}
            fallback={<span class="truncate text-ink-muted">Ended</span>}
          >
            <span class="size-2 rounded-full bg-success shrink-0" />
            <span class="truncate text-success font-medium">In progress</span>
          </Show>
        </span>
      </DetailsRow>
    </div>
  );
}

function DetailsRow(props: {
  label: string;
  children: import('solid-js').JSX.Element;
}) {
  return (
    <>
      <span class="text-ink-muted truncate" title={props.label}>
        {props.label}
      </span>
      <div class="flex items-center gap-2 min-w-0">{props.children}</div>
    </>
  );
}

function OwnerValue(props: { ownerId: string }) {
  const [displayName] = useDisplayName(tryMacroId(props.ownerId));
  return (
    <div class={cn(PILL_CLASS, 'w-fit')}>
      <UserIcon id={props.ownerId} size="sm" showTooltip suppressClick />
      <span class="truncate">{displayName()}</span>
    </div>
  );
}

function DateValueDisplay(props: { value: DateValue }) {
  return (
    <div class={cn(PILL_CLASS, 'w-fit')}>
      <ClockIcon class="size-3 shrink-0" />
      <span class="truncate">
        {formatDate(props.value, { showTime: true })}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharing Section
// ─────────────────────────────────────────────────────────────────────────────

function SharingSectionContent(props: { record: Accessor<CallRecord> }) {
  const record = props.record;
  const callCtx = useCallContextOptional();
  const toggleActiveShare = useToggleShareWithTeamMutation();
  const setArchivedShare = useSetCallRecordShareWithTeamMutation();

  const isShared = () => record().shareWithTeam;
  const isDisabled = () =>
    toggleActiveShare.isPending || setArchivedShare.isPending;

  const handleChange = async (checked: boolean) => {
    const current = record();
    try {
      const newValue = current.isActive
        ? await toggleActiveShare.mutateAsync(current.callId)
        : (
            await setArchivedShare.mutateAsync({
              callId: current.callId,
              shareWithTeam: checked,
            })
          ).shareWithTeam;

      if (callCtx?.activeCallId() === current.callId) {
        callCtx.setSharedWithTeam(newValue);
      }
    } catch (error) {
      console.error('failed to update call record team sharing', error);
    }
  };

  return (
    <div class="flex flex-col gap-2 text-xs">
      <button
        type="button"
        role="checkbox"
        aria-checked={isShared()}
        disabled={isDisabled()}
        onClick={() => void handleChange(!isShared())}
        class={cn(
          'inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none w-fit',
          'border border-ink-muted/[0.08] bg-ink-muted/[0.025]',
          'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
          isShared() && 'text-ink',
          isDisabled() && 'pointer-events-none opacity-50'
        )}
      >
        <InlineCheckbox checked={isShared()} />
        <span class="whitespace-nowrap">Share with team</span>
      </button>
      <p class="text-ink-muted leading-5">
        Lets everyone on your team view and search this call's transcript and AI
        summary.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// References Section (conditional)
// ─────────────────────────────────────────────────────────────────────────────

function ReferencesSectionConditional(props: { callId: string }) {
  const [references] = createResource(
    () => props.callId,
    async (id) => {
      const response = await commsServiceClient.attachmentReferences({
        entity_type: 'call',
        entity_id: id,
      });

      if (response.isErr()) {
        console.error(response);
        return [];
      }

      return response.value.references;
    }
  );

  const count = () => references()?.length ?? 0;

  const title = () => (
    <>
      References
      <Show when={count() > 0}>
        {' '}
        <span class="text-ink-extra-muted">({count()})</span>
      </Show>
    </>
  );

  return (
    <Show when={count() > 0}>
      <SidePanel.Section id="references" title={title()} order={50}>
        <Suspense
          fallback={
            <div class="flex justify-center py-8">
              <div class="animate-spin rounded-full size-6 border-b-2 border-ink-muted" />
            </div>
          }
        >
          <div class="text-xs">
            <References documentId={props.callId} entityType="call" />
          </div>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}

const PILL_CLASS = cn(
  'inline-flex items-center gap-1.5 min-w-0 max-w-full',
  'px-2 py-1 leading-tight text-left rounded-full'
);
