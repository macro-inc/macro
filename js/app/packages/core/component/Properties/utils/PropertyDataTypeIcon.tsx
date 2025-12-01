import CalculatorIcon from '@icon/regular/calculator.svg';
import CalendarBlankIcon from '@icon/regular/calendar-blank.svg';
import ChatIcon from '@icon/regular/chat.svg';
import CheckSquareIcon from '@icon/regular/check-square.svg';
import FileIcon from '@icon/regular/file.svg';
import FolderIcon from '@icon/regular/folder.svg';
import GlobeIcon from '@icon/regular/globe.svg';
import HashIcon from '@icon/regular/hash.svg';
import LinkIcon from '@icon/regular/link.svg';
import ListBulletIcon from '@icon/regular/list-bullets.svg';
import PencilIcon from '@icon/regular/pencil.svg';
import UserCircleIcon from '@icon/regular/user-circle.svg';
import type { Component } from 'solid-js';
import type { PropertyDefinitionFlat } from '../types';

type PropertyDataTypeIconProps = {
  property: Pick<PropertyDefinitionFlat, 'data_type' | 'specific_entity_type'>;
  class?: string;
};

export const PropertyDataTypeIcon: Component<PropertyDataTypeIconProps> = (
  props
) => {
  const dataTypeLower = props.property.data_type.toLowerCase();
  const ICON_CLASSES = 'size-4 text-ink-muted';

  if (dataTypeLower === 'entity') {
    const specificType = props.property.specific_entity_type?.toUpperCase();

    switch (specificType) {
      case 'USER':
        return <UserCircleIcon class={ICON_CLASSES} />;
      case 'DOCUMENT':
        return <FileIcon class={ICON_CLASSES} />;
      case 'PROJECT':
        return <FolderIcon class={ICON_CLASSES} />;
      case 'CHAT':
        return <ChatIcon class={ICON_CLASSES} />;
      case 'CHANNEL':
        return <HashIcon class={ICON_CLASSES} />;
      default:
        return <GlobeIcon class={ICON_CLASSES} />;
    }
  }

  switch (dataTypeLower) {
    case 'string':
      return <PencilIcon class={ICON_CLASSES} />;
    case 'number':
      return <CalculatorIcon class={ICON_CLASSES} />;
    case 'boolean':
      return <CheckSquareIcon class={ICON_CLASSES} />;
    case 'date':
      return <CalendarBlankIcon class={ICON_CLASSES} />;
    case 'link':
      return <LinkIcon class={ICON_CLASSES} />;
    case 'select_string':
    case 'select_number':
      return <ListBulletIcon class={ICON_CLASSES} />;
    default:
      return null;
  }
};
