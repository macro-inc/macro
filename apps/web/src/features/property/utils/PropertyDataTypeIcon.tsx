import ContactIcon from '@icon/system/regular/address-book.svg';
import CompanyIcon from '@icon/system/regular/building.svg';
import CalculatorIcon from '@icon/system/regular/calculator.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ChatIcon from '@icon/system/regular/chat.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import ThreadIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import ListBulletIcon from '@icon/system/regular/list-bullets.svg';
import TaskIcon from '@icon/system/regular/list-checks.svg';
import PencilIcon from '@icon/system/regular/pencil.svg';
import SimpleTagIcon from '@icon/system/regular/tag-simple.svg';
import UserCircleIcon from '@icon/system/regular/user-circle.svg';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { twMerge } from 'tailwind-merge';
import { match } from 'ts-pattern';
import type { PropertyDefinitionDomain } from '../types';

const EntityDataTypeIcon: Component<{
  property: Pick<PropertyDefinitionDomain, 'specificEntityType'>;
  class?: string;
}> = (props) => {
  const iconClass = () => twMerge('size-4 text-ink-muted', props.class);
  const icon = () =>
    match(props.property.specificEntityType)
      .with('USER', () => UserCircleIcon)
      .with('DOCUMENT', () => FileIcon)
      .with('PROJECT', () => FolderIcon)
      .with('CHAT', () => ChatIcon)
      .with('CHANNEL', () => HashIcon)
      .with('COMPANY', () => CompanyIcon)
      .with('CONTACT', () => ContactIcon)
      .with('THREAD', () => ThreadIcon)
      .with('TASK', () => TaskIcon)
      .otherwise(() => SimpleTagIcon);

  return <Dynamic component={icon()} class={iconClass()} />;
};

export const PropertyDataTypeIcon: Component<{
  property: Pick<PropertyDefinitionDomain, 'valueType' | 'specificEntityType'>;
  class?: string;
}> = (props) => {
  const iconClass = () => twMerge('size-4 text-ink-muted', props.class);
  const icon = () =>
    match(props.property.valueType)
      .with('ENTITY', () => () => (
        <EntityDataTypeIcon property={props.property} class={props.class} />
      ))
      .with('STRING', () => PencilIcon)
      .with('NUMBER', () => CalculatorIcon)
      .with('BOOLEAN', () => CheckSquareIcon)
      .with('DATE', () => CalendarBlankIcon)
      .with('LINK', () => LinkIcon)
      .with('SELECT_STRING', () => ListBulletIcon)
      .with('SELECT_NUMBER', () => ListBulletIcon)
      .otherwise(() => SimpleTagIcon);

  return <Dynamic component={icon()} class={iconClass()} />;
};
