import type { AsideLayout } from '@app/components/view-shell';
import type { JSX } from 'solid-js';

/** What the list hands a host's header, which takes the place of its own. */
export type NotificationsFrameControls = {
  /** Filter and Clear: the list's own header actions. */
  actions: JSX.Element;
  /** Leave what the content area shows, for the idle pane. */
  closePreview: () => void;
};

/**
 * A host's frame around the desktop list (New Home): its header above All
 * and Unread, its idle pane, and one-line rows when it asks for them.
 */
export type NotificationsFrame = {
  /** The view's name, for its split. */
  title: () => string;
  header: (controls: NotificationsFrameControls) => JSX.Element;
  /** What the content area shows with no row chosen. */
  idle: () => JSX.Element;
  condensed: () => boolean;
  /** The list width the frame's views share, and the bounds it keeps. */
  list: { asidePreferenceKey: string; aside: Partial<AsideLayout> };
};
