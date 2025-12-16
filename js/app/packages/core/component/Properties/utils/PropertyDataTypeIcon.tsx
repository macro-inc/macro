import CompanyIcon from '@icon/duotone/building-duotone.svg';
import ThreadIcon from '@icon/duotone/envelope-duotone.svg';
import CalculatorIcon from '@icon/regular/calculator.svg';
import CalendarBlankIcon from '@icon/regular/calendar-blank.svg';
import ChatIcon from '@icon/regular/chat.svg';
import CheckSquareIcon from '@icon/regular/check-square.svg';
import FileIcon from '@icon/regular/file.svg';
import FolderIcon from '@icon/regular/folder.svg';
import HashIcon from '@icon/regular/hash.svg';
import LinkIcon from '@icon/regular/link.svg';
import ListBulletIcon from '@icon/regular/list-bullets.svg';
import TaskIcon from '@icon/regular/list-checks.svg';
import PencilIcon from '@icon/regular/pencil.svg';
import SimpleTagIcon from '@icon/regular/tag-simple.svg';
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
  const iconClasses = props.class ?? 'size-4 text-ink-muted';

  if (dataTypeLower === 'entity') {
    const specificType = props.property.specific_entity_type?.toUpperCase();

    switch (specificType) {
      case 'USER':
        return <UserCircleIcon class={iconClasses} />;
      case 'DOCUMENT':
        return <FileIcon class={iconClasses} />;
      case 'PROJECT':
        return <FolderIcon class={iconClasses} />;
      case 'CHAT':
        return <ChatIcon class={iconClasses} />;
      case 'CHANNEL':
        return <HashIcon class={iconClasses} />;
      case 'COMPANY':
        return <CompanyIcon class={iconClasses} />;
      case 'THREAD':
        return <ThreadIcon class={iconClasses} />;
      case 'TASK':
        return <TaskIcon class={iconClasses} />;
      default:
        return <SimpleTagIcon class={iconClasses} />;
    }
  }

  switch (dataTypeLower) {
    case 'string':
      return <PencilIcon class={iconClasses} />;
    case 'number':
      return <CalculatorIcon class={iconClasses} />;
    case 'boolean':
      return <CheckSquareIcon class={iconClasses} />;
    case 'date':
      return <CalendarBlankIcon class={iconClasses} />;
    case 'link':
      return <LinkIcon class={iconClasses} />;
    case 'select_string':
    case 'select_number':
      return <ListBulletIcon class={iconClasses} />;
    default:
      return null;
  }
};
