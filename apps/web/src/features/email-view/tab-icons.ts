import ArchiveIcon from '@icon/system/regular/archive.svg';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import FocusIcon from '@icon/system/regular/crosshair.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file.svg';
import PaperPlaneTiltIcon from '@icon/system/regular/paper-plane-tilt.svg';
import SpamIcon from '@icon/system/regular/prohibit.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import SignalIcon from '@icon/system/regular/wave-sine.svg';
import NoiseIcon from '@icon/system/regular/waveform.svg';
import type { Component } from 'solid-js';
import type { EmailTab } from './tabs';

/** Each Email tab's icon, shared by the sidebar and the header's tabs. */
export const EMAIL_TAB_ICONS: Record<
  EmailTab,
  Component<{ class?: string }>
> = {
  important: SignalIcon,
  noise: NoiseIcon,
  favorites: StarIcon,
  sent: PaperPlaneTiltIcon,
  scheduled: ClockIcon,
  reminders: BellIcon,
  calendar: CalendarBlankIcon,
  drafts: FileIcon,
  shared: UsersThreeIcon,
  archived: ArchiveIcon,
  all: EnvelopeIcon,
  focus: FocusIcon,
  spam: SpamIcon,
  trash: TrashIcon,
};
