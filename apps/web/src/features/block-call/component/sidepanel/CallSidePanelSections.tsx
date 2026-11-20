import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import { EntityPropertiesSection } from '@app/features/property/side-panel/properties';
import { formatLocale, t } from '@app/lib/i18n';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { SidePanel } from '@components/app/side-panel';
import {
  EntityMetadata,
  EntityMetadataRow,
} from '@components/app/side-panel/EntityMetadata';
import type { SidePanelSectionLayout } from '@components/app/side-panel/SidePanel';
import { References } from '@core/component/References';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts } from '@core/user';
import { tryMacroId } from '@core/user/macroId';
import type { DateValue } from '@core/util/date';
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
import { isSameDay } from 'date-fns';
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
        <div class="flex flex-col gap-4">
          <DetailsSectionContent record={props.record} />
          <Show when={props.record.channelId != null}>
            <SharingSectionContent record={props.record} />
          </Show>
        </div>
      </SidePanel.Footer>
      <SidePanel.Section
        id="properties"
        title={t('calls.detailProperties')}
        defaultOpen
        order={15}
        render={(renderSection) => (
          <PropertiesSectionContent
            record={props.record}
            renderSection={renderSection}
          />
        )}
      />
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
  const dateText = (value: DateValue, timeOnly = false) =>
    new Intl.DateTimeFormat(formatLocale(), {
      ...(timeOnly ? {} : { month: 'short', day: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));

  return (
    <EntityMetadata>
      <EntityMetadataRow label={t('calls.detailOwner')}>
        <OwnerLabel ownerId={record().createdBy} textOnly suppressClick />
      </EntityMetadataRow>
      <Show when={startedAt()}>
        {(value) => (
          <EntityMetadataRow label={t('calls.detailStarted')}>
            {dateText(value())}
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={endedAt()}>
        {(value) => (
          <EntityMetadataRow label={t('calls.detailEnded')}>
            {dateText(
              value(),
              isSameDay(new Date(record().startedAt), new Date(value()))
            )}
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={durationMs()}>
        {(ms) => (
          <EntityMetadataRow label={t('calls.detailDuration')}>
            {formatCallDuration(ms())}
          </EntityMetadataRow>
        )}
      </Show>
      <EntityMetadataRow label={t('calls.detailStatus')}>
        {record().isActive
          ? t('calls.detailInProgress')
          : statusLabel(record().status)}
      </EntityMetadataRow>
      <Show when={record().channelName}>
        {(channel) => (
          <EntityMetadataRow label={t('calls.detailChannel')}>
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
  if (status === 'ATTENDED') return t('calls.detailAttended');
  if (status === 'MISSED') return t('calls.detailMissed');
  if (status === 'UNATTENDED') return t('calls.detailUnattended');
  return t('calls.detailEnded');
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

  const handleChange = async (checked: boolean) => {
    const current = record();
    if (!canEdit() || isPending()) return;
    if (!current.channelId) return;
    try {
      // Active rooms toggle their live state; archived records persist the
      // requested share value. Both return the authoritative state for the room.
      let newValue: boolean;
      if (current.isActive) {
        newValue = await toggleLiveShare.mutateAsync(current.callId);
      } else {
        const result = await setTeamShare.mutateAsync({
          callId: current.callId,
          shared: checked,
        });
        newValue = result.shared;
      }

      if (callCtx?.activeCallId() === current.callId) {
        callCtx.setSharedWithTeam(newValue);
      }
    } catch (error) {
      console.error('failed to update call record team sharing', error);
    }
  };

  const description = () =>
    record().isActive
      ? t('calls.detailLiveSharing')
      : t('calls.detailOwnerSharing');
  const readOnlyReason = () => {
    const name = getDisplayNameParts(tryMacroId(record().createdBy));
    const hasResolvedName = name.firstName || name.lastName;
    if (!hasResolvedName) return t('calls.detailSharingStarter');
    return t('calls.detailSharingStarterNamed', { name: name.fullName });
  };

  return (
    <div class="flex flex-col gap-2 rounded-xl bg-hover p-3 text-xs">
      <Show
        when={canEdit()}
        fallback={
          <>
            <span class="font-medium text-ink">
              {t('calls.detailShareWithTeam')}
            </span>
            <span>
              {isShared()
                ? t('calls.detailSharedWithTeam')
                : t('calls.detailChannelMembersOnly')}
            </span>
          </>
        }
      >
        <ToggleSwitch
          label={t('calls.detailShareWithTeam')}
          class="w-full flex-row-reverse justify-between"
          size="xs"
          checked={isShared()}
          disabled={isPending()}
          onChange={(checked) =>
            fireAndForget(handleChange(checked), 'call-sharing')
          }
        />
      </Show>
      <p class="text-ink-muted leading-5">
        {canEdit() ? description() : readOnlyReason()}
      </p>
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
        title={
          <SidePanel.CountTitle
            label={t('calls.detailReferences')}
            count={count()}
          />
        }
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
