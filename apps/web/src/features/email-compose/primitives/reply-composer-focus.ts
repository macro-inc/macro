import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, onCleanup, onMount } from 'solid-js';

/**
 * Whether a reply composer takes the keyboard when it mounts. A saved reply
 * that reappears with its thread (opening it, stepping to it with j/k, the
 * reading pane following the list cursor) waits on desktop until it is
 * clicked or replied to: taking the keyboard would type the next j into it.
 */
export function takesFocusOnMount(mount: {
  /** Mounted from a saved reply draft. */
  savedReply: boolean;
  /** A reply key, button or hand-off asked for this reply. */
  requested: boolean;
  /** Restores a send the user just undid. */
  restoredSend: boolean;
  /** Touch replies open in a drawer the user just asked for. */
  desktop: boolean;
}): boolean {
  return (
    !mount.savedReply || mount.requested || mount.restoredSend || !mount.desktop
  );
}

/** Keeps forward recipients focused through Lexical's deferred selection work. */
export function createReplyComposerFocus(options: {
  editor: Accessor<{ focus(): void } | undefined>;
  container: Accessor<HTMLElement | undefined>;
  footer: Accessor<HTMLElement | undefined>;
  scrollContainer: Accessor<HTMLElement | undefined>;
  toInput: Accessor<HTMLInputElement | undefined>;
  expandRecipients: () => void;
}) {
  let bounceEditorFocusGrabs = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const frames = new Set<number>();
  onCleanup(() => {
    for (const timer of timers) clearTimeout(timer);
    for (const frame of frames) cancelAnimationFrame(frame);
  });

  function afterQuoteLayout(callback: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, 100);
    timers.add(timer);
  }

  onMount(() => {
    const disarm = () => {
      bounceEditorFocusGrabs = false;
    };
    makeEventListener(document, 'pointerdown', disarm, true);
    makeEventListener(
      document,
      'keydown',
      (event) => {
        if (event.key === 'Tab' || event.key === 'Escape') disarm();
      },
      true
    );
    makeEventListener(
      document,
      'focusin',
      (event) => {
        if (!bounceEditorFocusGrabs) return;
        const target = event.target as Node;
        if (!options.container()?.contains(target)) {
          disarm();
        } else if (options.scrollContainer()?.contains(target)) {
          options.toInput()?.focus();
        }
      },
      true
    );
  });

  return {
    forward() {
      options.expandRecipients();
      afterQuoteLayout(() => {
        if (options.toInput()) {
          bounceEditorFocusGrabs = true;
          options.toInput()?.focus();
        }
        options.footer()?.scrollIntoView({ block: 'nearest' });
      });
    },
    reply() {
      afterQuoteLayout(() => {
        options.editor()?.focus();
        options.footer()?.scrollIntoView({ block: 'nearest' });
      });
    },
    editor(onFocused: () => void) {
      const editor = options.editor();
      if (!editor) return;
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        editor.focus();
        onFocused();
      });
      frames.add(frame);
    },
  };
}
