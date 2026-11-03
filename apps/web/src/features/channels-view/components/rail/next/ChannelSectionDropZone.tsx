import { t } from '@app/lib/i18n';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { cn } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { channelSectionDropError } from '../../../core/channel-label-eligibility';
import type { ChannelSectionKey } from '../../../types';
import {
  type ChannelLabelDropData,
  useChannelsRail,
} from '../ChannelsRailContext';

/** Keep valid and blocked drop feedback around the whole section. */
export function ChannelSectionDropZone(props: {
  section: ChannelSectionKey;
  label?: ChannelLabel;
  children: JSX.Element;
}) {
  const rail = useChannelsRail();
  const [state] = useDragDropContext() ?? [];
  const [hovered, setHovered] = createSignal(false);
  const dropError = () => {
    const source = state?.active.draggable?.data;

    if (!source || source.dragType === 'channel-section') {
      return;
    }

    if (
      props.section === 'favorites' &&
      source.dndScope === `${rail.railId}:favorites`
    ) {
      return;
    }

    if (
      source.dragType !== 'channel-label' ||
      source.dndScope !== rail.railId ||
      typeof source.channelId !== 'string'
    ) {
      return t('channelSections.cannotDropHere');
    }

    if (!rail.labelsAvailable()) {
      return rail.labelsUnavailableReason();
    }

    const reason = channelSectionDropError({
      section: props.section,
      label: props.label,
      channel: rail.channelById(source.channelId),
      sourceLabelId:
        typeof source.labelId === 'string' ? source.labelId : undefined,
    });

    if (reason === 'smart') return t('channelSections.smartSectionDropHint');
    if (reason === 'team-only') return t('channelSections.sharedSectionHint');
    if (reason === 'already-present')
      return t('channelSections.alreadyInSection');
    if (reason) return t('channelSections.cannotDropHere');
  };
  const rejected = () => hovered() && dropError();
  const supportsDrop = () =>
    Boolean(props.label) ||
    props.section === 'team_channels' ||
    props.section === 'channels';
  const droppable = createDroppable(
    `${rail.railId}:channel-label:section:${props.section}`,
    {
      dragType: 'channel-label-target',
      dndScope: rail.railId,
      get target() {
        if (props.label) {
          return {
            kind: props.label.rule
              ? ('smart-tag' as const)
              : ('label' as const),
            labelId: props.label.id,
          };
        }

        return { kind: 'unlabelled' as const };
      },
      isDropTargetDisabled: () =>
        !supportsDrop() || !rail.labelsAvailable() || Boolean(dropError()),
    } satisfies ChannelLabelDropData
  );
  const isDropTarget = () => {
    if (dropError()) return false;

    const target = rail.activeDropTarget();
    if (target?.kind === 'label') return target.labelId === props.label?.id;

    return (
      target?.kind === 'unlabelled' &&
      !props.label &&
      supportsDrop() &&
      hovered()
    );
  };

  return (
    <div
      ref={droppable.ref}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      class={cn(
        'group/channel-label relative min-w-0 shrink-0 rounded-lg',
        isDropTarget() && 'bg-selected ring-1 ring-inset ring-accent',
        rejected() && 'cursor-not-allowed [&_*]:cursor-not-allowed!'
      )}
    >
      {props.children}
      <Show when={rejected()}>
        {(reason) => (
          <div
            role="status"
            class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-lg bg-surface/90 px-3 py-2 text-xs text-ink-muted ring-1 ring-inset ring-edge-muted"
          >
            <ProhibitIcon class="size-4 shrink-0" />
            <span>{reason()}</span>
          </div>
        )}
      </Show>
    </div>
  );
}
