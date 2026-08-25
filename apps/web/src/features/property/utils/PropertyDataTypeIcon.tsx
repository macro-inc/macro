import CompanyIcon from '@lucide/building.svg';
import CalculatorIcon from '@lucide/calculator.svg';
import CalendarBlankIcon from '@lucide/calendar.svg';
import UserCircleIcon from '@lucide/circle-user.svg';
import FileIcon from '@lucide/file.svg';
import FolderIcon from '@lucide/folder.svg';
import HashIcon from '@lucide/hash.svg';
import LinkIcon from '@lucide/link.svg';
import ListBulletIcon from '@lucide/list.svg';
import TaskIcon from '@lucide/list-checks.svg';
import ThreadIcon from '@lucide/mail.svg';
import ChatIcon from '@lucide/message-square.svg';
import PencilIcon from '@lucide/pencil.svg';
import CheckSquareIcon from '@lucide/square-check.svg';
import SimpleTagIcon from '@lucide/tag.svg';
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
