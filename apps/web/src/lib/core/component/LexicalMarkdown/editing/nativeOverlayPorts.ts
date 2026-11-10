import type { Component } from 'solid-js';

/** Capabilities actually installed on the native document body. */
export interface NativeMarkdownOverlayInstallation {
  /** Absent while the installation owns pointer behavior without visible UI. */
  readonly Overlays?: Component;
  /** Present only when the native exterior-focus policy is installed. */
  readonly focusAtEnd?: () => void;
  dispose(): void;
}
