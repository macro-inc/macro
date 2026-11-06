import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import { EntityPropertiesSection } from '@app/features/property/side-panel/properties';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { SidePanel } from '@components/app/side-panel';
import {
  EntityMetadata,
  EntityMetadataRow,
} from '@components/app/side-panel/EntityMetadata';
import type { SidePanelSectionLayout } from '@components/app/side-panel/SidePanel';
import { References } from '@core/component/References';
import { useUserId } from '@core/context/user';
import { type DateValue, formatDate } from '@core/util/date';
import { fireAndForget } from '@core/util/fireAndForget';
import { OwnerLabel } from '@entity/owner/owner-display';
import HashIcon from '@icon/system/regular/hash.svg';
import {
  isCallSharedWithTeam,
  useSetCallRecordTeamShareMutation,
  useToggleShareWithTeamMutation,
} from '@queries/call/call';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import type { CallRecord } from '@service-call/client';
import { ToggleSwitch } from '@ui';
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
        render={(renderSection) => (
          <PropertiesSectionContent
            record={props.record}
            renderSection={renderSection}
          />
        )}
      />
      <Show when={props.record.channelId != null}>
        <SidePanel.Section id="sharing" title="Sharing" order={10} defaultOpen>
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
    <EntityMetadata>
      <EntityMetadataRow label="Owner">
        <OwnerLabel ownerId={record().createdBy} suppressClick />
      </EntityMetadataRow>
      <Show when={startedAt()}>
        {(value) => (
          <EntityMetadataRow label="Started">
            {formatDate(value(), { showTime: true })}
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={endedAt()}>
        {(value) => (
          <EntityMetadataRow label="Ended">
            {formatDate(value(), { showTime: true })}
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={durationMs()}>
        {(ms) => (
          <EntityMetadataRow label="Duration">
            {formatCallDuration(ms())}
          </EntityMetadataRow>
        )}
      </Show>
      <EntityMetadataRow label="Status">
        <span class="inline-flex items-center gap-2">
          <Show when={record().status === 'ATTENDED'}>
            <span class="size-1.5 rounded-full bg-success" />
          </Show>
          {record().isActive ? 'In progress' : statusLabel(record().status)}
        </span>
      </EntityMetadataRow>
      <Show when={record().channelName}>
        {(channel) => (
          <EntityMetadataRow label="Channel">
            <span class="inline-flex items-center gap-1">
              <HashIcon class="size-3.5" />
              {channel()}
            </span>
          </EntityMetadataRow>
        )}
      </Show>
    </EntityMetadata>
  );
}

function statusLabel(status: CallRecord['status']) {
  if (status === 'ATTENDED') return 'Attended';
  if (status === 'MISSED') return 'Missed';
  if (status === 'UNATTENDED') return 'Unattended';
  return 'Ended';
}
function PropertiesSectionContent(props: {
  record: CallRecord;
  renderSection: SidePanelSectionLayout;
}) {
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
      renderSection={props.renderSection}
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
    <div class="flex flex-col gap-2 rounded-xl bg-hover p-3 text-xs">
      <ToggleSwitch
        label="Share with team"
        class="w-full flex-row-reverse justify-between"
        size="xs"
        checked={isShared()}
        disabled={isDisabled()}
        readOnly={!canEdit()}
        onChange={(checked) =>
          fireAndForget(handleChange(checked), 'call-sharing')
        }
      />
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
