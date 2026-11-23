import BellIcon from '@icon/system/regular/bell.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import ChatsIcon from '@icon/system/regular/chats.svg';
import ClockIcon from '@icon/system/regular/clock-clockwise.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import EnvelopeIcon from '@icon/system/regular/envelope-simple.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import GearIcon from '@icon/system/regular/gear-six.svg';
import KeyIcon from '@icon/system/regular/key.svg';
import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import PlugsIcon from '@icon/system/regular/plugs.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import ShareIcon from '@icon/system/regular/share-network.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import type { Component, ComponentProps } from 'solid-js';

type Icon = Component<ComponentProps<'svg'>>;

/** Registry group ids (`crates/agent_permission_registry`) to their glyph. */
const GROUP_ICONS: Record<string, Icon> = {
  documents: FileTextIcon,
  tasks: ListChecksIcon,
  email: EnvelopeIcon,
  calendar: CalendarIcon,
  channels: ChatIcon,
  calls: PhoneCallIcon,
  external_chats: ChatsIcon,
  contacts: UsersIcon,
  databases: DatabaseIcon,
  routines: ClockIcon,
  ai: SparkleIcon,
  agents: RobotIcon,
  connections: PlugsIcon,
  sharing: ShareIcon,
  search: SearchIcon,
  notifications: BellIcon,
  passwords: KeyIcon,
  account: GearIcon,
};

/** A group's glyph; a group added later gets a folder until it has one. */
export function groupIcon(groupId: string): Icon {
  return GROUP_ICONS[groupId] ?? FolderIcon;
}
