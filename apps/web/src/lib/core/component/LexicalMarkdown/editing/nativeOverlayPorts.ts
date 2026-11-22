import type { Accessor, Component } from 'solid-js';
import type { NativeActionCommands } from './overlay-hosts/native-actions';
import type { NativeComments } from './overlay-hosts/native-comments';

/** Capabilities actually installed on the native document body. */
export interface NativeMarkdownOverlayInstallation {
  /** Absent while the installation owns pointer behavior without visible UI. */
  readonly Overlays?: Component;
  /** Present only when the native exterior-focus policy is installed. */
  readonly focusAtEnd?: () => void;
  /** Present only when the body installs native comment marks. */
  readonly comments?: NativeComments;
  /** Source title-to-body handoff: document start, or a new first paragraph. */
  readonly titleHandoff?: {
    atStart(): void;
    prependParagraph(): void;
  };
  /** Whether a native inline menu (mentions, tags, actions) is open. */
  readonly menuOpen?: Accessor<boolean>;
  /** The slash actions for the command menu, once the action menu is ready. */
  readonly actions?: Accessor<NativeActionCommands | undefined>;
  dispose(): void;
}
