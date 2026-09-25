import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import { EntityPropertiesSection } from '@app/features/property/side-panel/properties';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { References } from '@core/component/References';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import ClockIcon from '@phosphor/clock.svg';
import {
  isCallSharedWithTeam,
  useSetCallRecordTeamShareMutation,
  useToggleShareWithTeamMutation,
} from '@queries/call/call';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import type { CallRecord } from '@service-call/client';
import { cn, InlineCheckbox } from '@ui';
import { type Accessor, Show, Suspense } from 'solid-js';
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
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={15}
      >
        <PropertiesSectionContent record={props.record} />
      </SidePanel.Section>
      <Show when={props.record().channelId != null}>
        <SidePanel.Section id="sharing" title="Sharing" order={20}>
          <SharingSectionContent record={props.record} />
        </SidePanel.Section>
      </Show>
      <EntityActivitySectionConditional
        entityId={props.record().callId}
        entityType="CALL_RECORD"
        order={40}
      />
      <ReferencesSectionConditional callId={blockId} />
    </>
  );
}

function DetailsSectionContent(props: { record: Accessor<CallRecord> }) {
  const record = props.record;

  const startedAt = (): DateValue | undefined => record().startedAt;
  const endedAt = (): DateValue | undefined => record().endedAt ?? undefined;
  const durationMs = () => record().durationMs ?? undefined;

  return (
    <SidePanel.Grid>
      <SidePanel.Row label="Owner">
        <OwnerValue ownerId={record().createdBy} />
      </SidePanel.Row>
      <Show when={startedAt()}>
        {(value) => (
          <SidePanel.Row label="Started">
            <DateValueDisplay value={value()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={endedAt()}>
        {(value) => (
          <SidePanel.Row label="Ended">
            <DateValueDisplay value={value()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={durationMs()}>
        {(ms) => (
          <SidePanel.Row label="Duration">
            <SidePanel.Pill>
              <ClockIcon class="size-3 shrink-0" />
              <span class="truncate">{formatCallDuration(ms())}</span>
            </SidePanel.Pill>
          </SidePanel.Row>
        )}
      </Show>
      <SidePanel.Row label="Status">
        <SidePanel.Pill>
          <Show
            when={record().isActive}
            fallback={<span class="truncate text-ink-muted">Ended</span>}
          >
            <span class="size-2 rounded-full bg-success shrink-0" />
            <span class="truncate text-success font-medium">In progress</span>
          </Show>
        </SidePanel.Pill>
      </SidePanel.Row>
    </SidePanel.Grid>
  );
}

function PropertiesSectionContent(props: { record: Accessor<CallRecord> }) {
  // Tag/property writes are authorized server-side via the call's owning
  // channel (edit access), mirroring the sharing control above, so the editor
  // is always mounted and the backend rejects unauthorized mutations.
  return (
    <EntityPropertiesSection
      entityId={props.record().callId}
      entityType="CALL_RECORD"
      canEdit
      documentName={
        props.record().customName ?? props.record().channelName ?? undefined
      }
    />
  );
}

function OwnerValue(props: { ownerId: string }) {
  const displayName = () => getDisplayName(tryMacroId(props.ownerId));
  return (
    <SidePanel.Pill>
      <UserIcon id={props.ownerId} size="sm" showTooltip suppressClick />
      <span class="truncate">{displayName()}</span>
    </SidePanel.Pill>
  );
}

function DateValueDisplay(props: { value: DateValue }) {
  return (
    <SidePanel.Pill>
      <ClockIcon class="size-3 shrink-0" />
      <span class="truncate">
        {formatDate(props.value, { showTime: true })}
      </span>
    </SidePanel.Pill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharing Section
// ─────────────────────────────────────────────────────────────────────────────

function SharingSectionContent(props: { record: Accessor<CallRecord> }) {
  const record = props.record;
  const callCtx = useCallContextOptional();
  const userId = useUserId();
  const toggleLiveShare = useToggleShareWithTeamMutation();
  const setTeamShare = useSetCallRecordTeamShareMutation();

  // While the call is live this is the pending toggle; once archived it is
  // the canonical `SharePermission` team share (`view` or nothing).
  const isShared = () => isCallSharedWithTeam(record());
  // Any participant with edit access may flip the toggle during the call;
  // once archived only the creator may change it (the backend enforces both).
  const canEdit = () => record().isActive || record().createdBy === userId();
  const isPending = () => toggleLiveShare.isPending || setTeamShare.isPending;
  const isDisabled = () => isPending() || !canEdit();

  const handleChange = async (checked: boolean) => {
    const current = record();
    if (!current.channelId) return;
    try {
      const newValue = current.isActive
        ? await toggleLiveShare.mutateAsync(current.callId)
        : (
            await setTeamShare.mutateAsync({
              callId: current.callId,
              shared: checked,
            })
          ).shared;

      if (callCtx?.activeCallId() === current.callId) {
        callCtx.setSharedWithTeam(newValue);
      }
    } catch (error) {
      console.error('failed to update call record team sharing', error);
    }
  };

  const description = () => {
    if (record().isActive) {
      return "Lets everyone on the creator's team view and search this call's transcript and AI summary once it ends.";
    }
    if (canEdit()) {
      return "Lets everyone on your team view and search this call's transcript and AI summary.";
    }
    return isShared()
      ? "Everyone on the creator's team can view and search this call's transcript and AI summary."
      : "Only the call's creator can share it with their team.";
  };

  return (
    <div class="flex flex-col gap-2 text-xs">
      <button
        type="button"
        role="checkbox"
        aria-checked={isShared()}
        aria-readonly={!canEdit()}
        disabled={isDisabled()}
        onClick={() => void handleChange(!isShared())}
        class={cn(
          'inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none w-fit',
          'border border-ink-muted/[0.08] bg-ink-muted/[0.025]',
          'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
          isShared() && 'text-ink',
          isDisabled() && 'pointer-events-none',
          isPending() && 'opacity-50'
        )}
      >
        <InlineCheckbox checked={isShared()} />
        <span class="whitespace-nowrap">Share with team</span>
      </button>
      <p class="text-ink-muted leading-5">{description()}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// References Section (conditional)
// ─────────────────────────────────────────────────────────────────────────────

function ReferencesSectionConditional(props: { callId: string }) {
  const references = useAttachmentReferencesQuery(
    () => props.callId,
    () => 'call'
  );

  const count = () => references.data?.length ?? 0;

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="references"
        title={<SidePanel.CountTitle label="References" count={count()} />}
        order={50}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <div class="text-xs">
            <References documentId={props.callId} entityType="call" />
          </div>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}
