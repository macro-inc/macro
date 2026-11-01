import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

type Editor = HTMLTextAreaElement | HTMLDivElement;

/** Native-editor equivalent of the app's createComposerLayout compact probe. */
export function createDemoComposerLayout(options: {
  input: () => Editor | undefined;
  text: () => string;
  compact: () => boolean | undefined;
}) {
  const [compact, setCompact] = createSignal(true);
  let queued = false;
  let disposed = false;
  const measure = () => {
    const input = options.input();
    const layout = input?.closest<HTMLElement>('[data-input-layout]');
    if (!input || !layout?.parentElement || !layout.clientWidth) return;
    // Measure compact width without briefly collapsing the visible editor.
    const probe = layout.cloneNode(true) as HTMLElement;
    probe.removeAttribute('id');
    probe.setAttribute('data-composer-compact', 'true');
    probe.inert = true;
    probe.setAttribute('aria-hidden', 'true');
    for (const child of probe.querySelectorAll('[id]'))
      child.removeAttribute('id');
    for (const child of probe.querySelectorAll<HTMLElement>('*')) {
      child.style.transition = 'none';
      child.style.animation = 'none';
    }
    for (const child of probe.querySelectorAll<HTMLElement>(
      '[contenteditable]'
    ))
      child.contentEditable = 'false';
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none',
      top: '0',
      left: '0',
      width: `${layout.clientWidth}px`,
      height: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      overflow: 'hidden',
    });
    const editor = probe.querySelector<Editor>('.mail-channel-input');
    if (!editor) return;
    if (editor instanceof HTMLTextAreaElement) editor.value = options.text();
    Object.assign(editor.style, {
      height: '0px',
      minHeight: '0px',
      maxHeight: 'none',
      overflow: 'hidden',
    });
    layout.parentElement.append(probe);
    try {
      const lineHeight =
        Number.parseFloat(getComputedStyle(editor).lineHeight) || 24;
      const next =
        options.compact() ??
        (!options.text().includes('\n') &&
          editor.scrollHeight <= lineHeight + 1);
      setCompact(next);
      // The same probe measures the final layout, keeping the live input stable.
      probe.setAttribute('data-composer-compact', String(next));
      const height = Math.max(lineHeight, Math.min(editor.scrollHeight, 200));
      if (input.style.height !== `${height}px`)
        input.style.height = `${height}px`;
    } finally {
      probe.remove();
    }
  };
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) measure();
    });
  };
  createEffect(() => {
    options.text();
    options.compact();
    schedule();
  });
  onMount(() => {
    const input = options.input();
    const layout = input?.closest<HTMLElement>('[data-input-layout]');
    if (!input || !layout) return;
    let width = -1;
    const observer = new ResizeObserver(() => {
      // Height changes caused by sizing must not trigger another sizing cycle.
      if (layout.clientWidth === width) return;
      width = layout.clientWidth;
      schedule();
    });
    observer.observe(layout);
    const changes = new MutationObserver(schedule);
    changes.observe(layout, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const fonts = input.ownerDocument.fonts;
    fonts?.addEventListener('loadingdone', schedule);
    schedule();
    onCleanup(() => {
      observer.disconnect();
      changes.disconnect();
      fonts?.removeEventListener('loadingdone', schedule);
    });
  });
  onCleanup(() => {
    disposed = true;
  });
  return { compact, resize: schedule };
}
