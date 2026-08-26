import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { buildBrainWorkspacePath } from '@components/app/split-layout/brainWorkspaceRoute';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import ActivityIcon from '@phosphor/bell.svg';
import CrmIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import EmailIcon from '@phosphor/envelope-simple.svg';
import TasksIcon from '@phosphor/list-checks.svg';
import DriveIcon from '@phosphor/shipping-container.svg';
import AiChatIcon from '@phosphor/sparkle.svg';
import ActivityFilledIcon from '@phosphor-icons/core/assets/fill/bell-fill.svg';
import CrmFilledIcon from '@phosphor-icons/core/assets/fill/buildings-fill.svg';
import CalendarFilledIcon from '@phosphor-icons/core/assets/fill/calendar-blank-fill.svg';
import ChatFilledIcon from '@phosphor-icons/core/assets/fill/chats-circle-fill.svg';
import EmailFilledIcon from '@phosphor-icons/core/assets/fill/envelope-simple-fill.svg';
import TasksFilledIcon from '@phosphor-icons/core/assets/fill/list-checks-fill.svg';
import DriveFilledIcon from '@phosphor-icons/core/assets/fill/shipping-container-fill.svg';
import AiChatFilledIcon from '@phosphor-icons/core/assets/fill/sparkle-fill.svg';
import type { Component, JSX } from 'solid-js';

/** Every destination an app chrome bar can reach, whichever control opens it. */
export type ChromeDestinationId =
  | 'activity'
  | 'drive'
  | 'email'
  | 'chat'
  | 'tasks'
  | 'crm'
  | 'brain'
  | 'calendar'
  | 'ai-chat';

export type ChromeDestination = {
  id: ChromeDestinationId;
  label: string;
  /** Split content this destination opens in-app. */
  content: SplitContent;
  /** Router path used when the destination is opened in its own browser tab. */
  path: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  /** Active glyph: the same icon in Phosphor's fill weight. */
  filledIcon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  /** Only rendered once the CRM flag is on. */
  requiresCrmFlag?: boolean;
};

const componentDestination = (
  destination: Omit<ChromeDestination, 'content' | 'path'> & {
    contentId: string;
    params?: Record<string, unknown>;
  }
): ChromeDestination => {
  const { contentId, params, ...rest } = destination;
  return {
    ...rest,
    content: { type: 'component', id: contentId, params },
    path: `/component/${contentId}`,
  };
};

/** Full-screen from the center row, or alongside a view from the right. */
const CALENDAR_DESTINATION: ChromeDestination = {
  id: 'calendar',
  label: 'Calendar',
  content: { type: 'calendar', id: CALENDAR_BLOCK_ID },
  path: `/calendar/${CALENDAR_BLOCK_ID}`,
  icon: CalendarIcon,
  filledIcon: CalendarFilledIcon,
};

const AI_CHAT_DESTINATION: ChromeDestination = {
  id: 'ai-chat',
  label: 'AI chat',
  content: { type: 'component', id: 'chat-workspace' },
  path: '/chat',
  icon: AiChatIcon,
  filledIcon: AiChatFilledIcon,
};

/**
 * The views that sit in the middle of the bar, in Facebook's "one row of
 * primary destinations" order.
 */
export const CHROME_VIEWS: readonly ChromeDestination[] = [
  componentDestination({
    id: 'activity',
    label: 'Activity',
    contentId: 'activity',
    icon: ActivityIcon,
    filledIcon: ActivityFilledIcon,
  }),
  componentDestination({
    id: 'drive',
    label: 'Drive',
    contentId: 'documents',
    icon: DriveIcon,
    filledIcon: DriveFilledIcon,
  }),
  componentDestination({
    id: 'email',
    label: 'Email',
    contentId: 'mail',
    icon: EmailIcon,
    filledIcon: EmailFilledIcon,
  }),
  componentDestination({
    id: 'chat',
    label: 'Chat',
    contentId: 'channels',
    params: {
      experimentalView: 'messages',
      initialTab: 'experimental-conversations',
    },
    icon: ChatIcon,
    filledIcon: ChatFilledIcon,
  }),
  componentDestination({
    id: 'tasks',
    label: 'Tasks',
    contentId: 'tasks',
    icon: TasksIcon,
    filledIcon: TasksFilledIcon,
  }),
  CALENDAR_DESTINATION,
  {
    id: 'brain',
    label: 'Brain',
    content: { type: 'component', id: 'agents' },
    path: buildBrainWorkspacePath(undefined),
    // The AI sparkle rather than an anatomy glyph: Brain is the AI home.
    icon: AiChatIcon,
    filledIcon: AiChatFilledIcon,
  },
  componentDestination({
    id: 'crm',
    label: 'CRM',
    contentId: 'companies',
    icon: CrmIcon,
    filledIcon: CrmFilledIcon,
    requiresCrmFlag: true,
  }),
];

/** Opened as their own split from the right of the bar. */
export const CHROME_SPLIT_DESTINATIONS: readonly ChromeDestination[] = [
  AI_CHAT_DESTINATION,
  CALENDAR_DESTINATION,
];

/**
 * The Gmail-style app grid lists every destination the bar can reach, once
 * each — Calendar answers to both the center row and the right cluster.
 */
export const CHROME_SUB_APPS: readonly ChromeDestination[] = [
  ...CHROME_VIEWS,
  ...CHROME_SPLIT_DESTINATIONS.filter(
    (destination) => !CHROME_VIEWS.includes(destination)
  ),
];
