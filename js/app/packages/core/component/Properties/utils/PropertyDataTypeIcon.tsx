import CompanyIcon from '@phosphor/building.svg';
import CalculatorIcon from '@phosphor/calculator.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import ChatIcon from '@phosphor/chat.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import ThreadIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import FolderIcon from '@phosphor/folder.svg';
import HashIcon from '@phosphor/hash.svg';
import LinkIcon from '@phosphor/link.svg';
import ListBulletIcon from '@phosphor/list-bullets.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import PencilIcon from '@phosphor/pencil.svg';
import SimpleTagIcon from '@phosphor/tag-simple.svg';
import UserCircleIcon from '@phosphor/user-circle.svg';
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
