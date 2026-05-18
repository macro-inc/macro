import CompanyIcon from '@icon/building.svg';
import CalculatorIcon from '@icon/calculator.svg';
import CalendarBlankIcon from '@icon/calendar-blank.svg';
import ChatIcon from '@icon/chat.svg';
import CheckSquareIcon from '@icon/check-square.svg';
import ThreadIcon from '@icon/envelope.svg';
import FileIcon from '@icon/file.svg';
import FolderIcon from '@icon/folder.svg';
import HashIcon from '@icon/hash.svg';
import LinkIcon from '@icon/link.svg';
import ListBulletIcon from '@icon/list-bullets.svg';
import TaskIcon from '@icon/list-checks.svg';
import PencilIcon from '@icon/pencil.svg';
import SimpleTagIcon from '@icon/tag-simple.svg';
import UserCircleIcon from '@icon/user-circle.svg';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { twMerge } from 'tailwind-merge';
import { match } from 'ts-pattern';
import type { Property } from '../types';

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
