import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import { EntityPropertiesSection } from '@app/features/property/side-panel/properties';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { References } from '@core/component/References';
import { useUserId } from '@core/context/user';
import { type DateValue, formatDate } from '@core/util/date';
import {
  isCallSharedWithTeam,
  useSetCallRecordTeamShareMutation,
  useToggleShareWithTeamMutation,
} from '@queries/call/call';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import type { CallRecord } from '@service-call/client';
import { cn, InlineCheckbox } from '@ui';
import { Show, Suspense } from 'solid-js';
import { formatCallDuration } from '../../utils';

interface CallSidePanelSectionsProps {
  record: CallRecord;
  callId: string;
}

export function CallSidePanelSections(props: CallSidePanelSectionsProps) {
  return (
    <>
      <SidePanel.Footer>
        <DetailsSectionContent record={props.record} />
      </SidePanel.Footer>
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={15}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <PropertiesSectionContent record={props.record} />
        </Suspense>
      </SidePanel.Section>
      <Show when={props.record.channelId != null}>
        <SidePanel.Section id="sharing" title="Sharing" order={20}>
          <SharingSectionContent record={props.record} />
        </SidePanel.Section>
      </Show>
      <EntityActivitySectionConditional
        entityId={props.record.callId}
        entityType="CALL_RECORD"
        order={40}
      />
      <ReferencesSectionConditional callId={props.callId} />
    </>
  );
}

function DetailsSectionContent(props: { record: CallRecord }) {
  const record = () => props.record;

  const startedAt = (): DateValue | undefined => record().startedAt;
  const endedAt = (): DateValue | undefined => record().endedAt ?? undefined;
  const durationMs = () => record().durationMs ?? undefined;

  return (
    <EntityMetadata ownerId={record().createdBy}>
      <Show when={startedAt()}>
        {(value) => (
          <div>Started {formatDate(value(), { showTime: true })}</div>
        )}
      </Show>
      <Show when={endedAt()}>
        {(value) => <div>Ended {formatDate(value(), { showTime: true })}</div>}
      </Show>
      <Show when={durationMs()}>
        {(ms) => <div>{formatCallDuration(ms())}</div>}
      </Show>
      <div>{record().isActive ? 'In progress' : 'Ended'}</div>
    </EntityMetadata>
  );
}

function PropertiesSectionContent(props: { record: CallRecord }) {
  // Tag/property writes are authorized server-side via the call's owning
  // channel (edit access), mirroring the sharing control above, so the editor
  // is always mounted and the backend rejects unauthorized mutations.
  return (
    <EntityPropertiesSection
      entityId={props.record.callId}
      entityType="CALL_RECORD"
      canEdit
      documentName={
        props.record.customName ?? props.record.channelName ?? undefined
      }
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharing Section
// ─────────────────────────────────────────────────────────────────────────────

function SharingSectionContent(props: { record: CallRecord }) {
  const record = () => props.record;
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
      return "Lets everyone on the creator's team view this call's chat, transcript, and AI summary once it ends.";
    }
    if (canEdit()) {
      return "Lets everyone on your team view this call's chat, transcript, and AI summary.";
    }
    return isShared()
      ? "Everyone on the creator's team can view this call's chat, transcript, and AI summary."
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

  const count = () => (references.isSuccess ? references.data.length : 0);

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
