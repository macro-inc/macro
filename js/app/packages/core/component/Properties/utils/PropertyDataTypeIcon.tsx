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
import type { Property } from '../types';
import { match } from 'ts-pattern';
import { twMerge } from 'tailwind-merge';
import { Dynamic } from 'solid-js/web';

export const EntityDataTypeIcon: Component<{
  property: Pick<Property, 'specificEntityType'>;
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
      .with('THREAD', () => ThreadIcon)
      .with('TASK', () => TaskIcon)
      .otherwise(() => SimpleTagIcon);

  return <Dynamic component={icon()} class={iconClass()} />;
};

export const PropertyDataTypeIcon: Component<{
  property: Pick<Property, 'valueType' | 'specificEntityType'>;
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
