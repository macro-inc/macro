import { useChannelName } from '@core/component/ChannelsProvider';
import { EntityIcon as CoreEntityIcon } from '@core/component/EntityIcon';
import type { Property } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isAccessiblePreviewItem, useItemPreview } from '@core/signal/preview';
import { idToDisplayName } from '@core/user';
import { cornerClip } from '@core/util/clipPath';
import ChannelBuildingIcon from '@icon/duotone/building-office-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import UserDuotoneIcon from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { For, Show } from 'solid-js';
import { PropertyPillTooltip } from './PropertyPillTooltip';

type EntityPropertyPillProps = {
  property: Property & { valueType: 'ENTITY' };
};

/**
 * Pill for entity properties
 * Single value: shows entity name directly with tooltip
 * Multi value: shows "Property Name (N)" with tooltip
 */
export const EntityPropertyPill = (props: EntityPropertyPillProps) => {
  const entities = () => props.property.value ?? [];
  const count = () => entities().length;

  if (count() === 0) return null;

  // Single entity - show name directly in pill
  if (count() === 1) {
    return (
      <SingleEntityPill property={props.property} entity={entities()[0]} />
    );
  }

  // Multiple entities - show count with tooltip
  return <MultiEntityPill property={props.property} entities={entities()} />;
};

type SingleEntityPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entity: EntityReference;
};

const ICON_CLASSES = 'size-4 text-ink-muted';

const SingleEntityPill = (props: SingleEntityPillProps) => {
  const entityType = () => props.entity.entity_type;
  const entityId = () => props.entity.entity_id;

  // Get preview for items that need it
  const previewTypes = ['DOCUMENT', 'PROJECT', 'CHAT', 'CHANNEL'];
  const needsPreview = () => previewTypes.includes(entityType());

  const [preview] = useItemPreview({
    id: needsPreview() ? entityId() : '',
    type: needsPreview()
      ? (entityType().toLowerCase() as
          | 'document'
          | 'project'
          | 'chat'
          | 'channel')
      : undefined,
  });

  const channelName = useChannelName(
    entityType() === 'CHANNEL' ? entityId() : '',
    'Unknown Channel'
  );

  const entityName = () => {
    switch (entityType()) {
      case 'USER':
        return idToDisplayName(entityId()).replace('macro|', '');
      case 'CHANNEL':
        return channelName();
      case 'DOCUMENT':
      case 'PROJECT':
      case 'CHAT': {
        const previewItem = preview();
        if (!previewItem || previewItem.loading) return 'Loading...';
        if (!isAccessiblePreviewItem(previewItem)) return 'Unavailable';
        return previewItem.name || `Unknown ${entityType().toLowerCase()}`;
      }
      default:
        return entityId();
    }
  };

  const entityIcon = () => {
    switch (entityType()) {
      case 'USER':
        return <UserIcon id={entityId()} size="xs" />;

      case 'CHANNEL': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <ChannelIcon class={ICON_CLASSES} />;
        }

        const channelType = previewItem.channelType;
        switch (channelType) {
          case 'direct_message':
            return <UserDuotoneIcon class={ICON_CLASSES} />;
          case 'private':
            return <ThreeUsersIcon class={ICON_CLASSES} />;
          case 'organization':
            return <ChannelBuildingIcon class={ICON_CLASSES} />;
          case 'public':
            return <GlobeIcon class={ICON_CLASSES} />;
          default:
            return <ChannelIcon class={ICON_CLASSES} />;
        }
      }

      case 'DOCUMENT': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <CoreEntityIcon targetType="unknown" size="xs" />;
        }

        const fileType = previewItem.fileType;
        const blockName = fileType
          ? fileTypeToBlockName(fileType, true)
          : 'unknown';
        return <CoreEntityIcon targetType={blockName} size="xs" />;
      }

      case 'PROJECT':
        return <CoreEntityIcon targetType="project" size="xs" />;

      case 'CHAT':
        return <CoreEntityIcon targetType="chat" size="xs" />;

      default:
        return (
          <PropertyDataTypeIcon
            property={{
              data_type: 'ENTITY',
              specific_entity_type: props.property.specificEntityType,
            }}
          />
        );
    }
  };

  return (
    <Tooltip
      tooltip={
        <SingleEntityTooltipContent
          property={props.property}
          entity={props.entity}
        />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <Show when={entityIcon()}>{entityIcon()}</Show>
          <span class="truncate max-w-[120px]">{entityName()}</span>
        </div>
      </div>
    </Tooltip>
  );
};

type SingleEntityTooltipContentProps = {
  property: Property & { valueType: 'ENTITY' };
  entity: EntityReference;
};

const SingleEntityTooltipContent = (props: SingleEntityTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <EntityValuePill entity={props.entity} property={props.property} />
      </div>
    </PropertyPillTooltip>
  );
};

type MultiEntityPillProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

const MultiEntityPill = (props: MultiEntityPillProps) => {
  return (
    <Tooltip
      tooltip={
        <EntityTooltipContent
          property={props.property}
          entities={props.entities}
        />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <PropertyDataTypeIcon
            property={{
              data_type: 'ENTITY',
              specific_entity_type: props.property.specificEntityType,
            }}
          />
          <span class="truncate max-w-[120px]">
            {props.property.displayName} ({props.entities.length})
          </span>
        </div>
      </div>
    </Tooltip>
  );
};

type EntityTooltipContentProps = {
  property: Property & { valueType: 'ENTITY' };
  entities: EntityReference[];
};

const EntityTooltipContent = (props: EntityTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={props.entities}>
          {(entity) => (
            <EntityValuePill entity={entity} property={props.property} />
          )}
        </For>
      </div>
    </PropertyPillTooltip>
  );
};

type EntityValuePillProps = {
  entity: EntityReference;
  property: Property & { valueType: 'ENTITY' };
};

const EntityValuePill = (props: EntityValuePillProps) => {
  const entityType = () => props.entity.entity_type;
  const entityId = () => props.entity.entity_id;

  // Get preview for items that need it
  const previewTypes = ['DOCUMENT', 'PROJECT', 'CHAT', 'CHANNEL'];
  const needsPreview = () => previewTypes.includes(entityType());

  const [preview] = useItemPreview({
    id: needsPreview() ? entityId() : '',
    type: needsPreview()
      ? (entityType().toLowerCase() as
          | 'document'
          | 'project'
          | 'chat'
          | 'channel')
      : undefined,
  });

  const channelName = useChannelName(
    entityType() === 'CHANNEL' ? entityId() : '',
    'Unknown Channel'
  );

  const entityName = () => {
    switch (entityType()) {
      case 'USER':
        return idToDisplayName(entityId()).replace('macro|', '');
      case 'CHANNEL':
        return channelName();
      case 'DOCUMENT':
      case 'PROJECT':
      case 'CHAT': {
        const previewItem = preview();
        if (!previewItem || previewItem.loading) return 'Loading...';
        if (!isAccessiblePreviewItem(previewItem)) return 'Unavailable';
        return previewItem.name || `Unknown ${entityType().toLowerCase()}`;
      }
      default:
        return entityId();
    }
  };

  const entityIcon = () => {
    switch (entityType()) {
      case 'USER':
        return <UserIcon id={entityId()} size="xs" />;

      case 'CHANNEL': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <ChannelIcon class={ICON_CLASSES} />;
        }

        const channelType = previewItem.channelType;
        switch (channelType) {
          case 'direct_message':
            return <UserDuotoneIcon class={ICON_CLASSES} />;
          case 'private':
            return <ThreeUsersIcon class={ICON_CLASSES} />;
          case 'organization':
            return <ChannelBuildingIcon class={ICON_CLASSES} />;
          case 'public':
            return <GlobeIcon class={ICON_CLASSES} />;
          default:
            return <ChannelIcon class={ICON_CLASSES} />;
        }
      }

      case 'DOCUMENT': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <CoreEntityIcon targetType="unknown" size="xs" />;
        }

        const fileType = previewItem.fileType;
        const blockName = fileType
          ? fileTypeToBlockName(fileType, true)
          : 'unknown';
        return <CoreEntityIcon targetType={blockName} size="xs" />;
      }

      case 'PROJECT':
        return <CoreEntityIcon targetType="project" size="xs" />;

      case 'CHAT':
        return <CoreEntityIcon targetType="chat" size="xs" />;

      default:
        return null;
    }
  };

  return (
    <div
      class="p-px bg-edge box-border h-fit w-fit flex items-center"
      style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
    >
      <div
        class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
        style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
      >
        <Show when={entityIcon()}>{entityIcon()}</Show>
        <span class="truncate max-w-[150px]">{entityName()}</span>
      </div>
    </div>
  );
};
