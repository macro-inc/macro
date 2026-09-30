import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { isServer } from 'solid-js/web';
import './util-live-editor.css';

const rajdhani = "'rajdhani', 'body'";

/** Website-owned editable document: no iframe, app bundle, or authenticated state. */
export function LiveDocEditor(props: {
  active: boolean;
  fallback: () => JSX.Element;
  src?: string;
  background?: string;
  pauseWhenOffscreen?: boolean;
  onInteract?: () => void;
  onTitleChange?: (title: string) => void;
  onAnchor?: (pos: { x: number; y: number } | null) => void;
  onReady?: () => void;
}) {
  if (isServer) return <>{props.fallback()}</>;
  const [menu, setMenu] = createSignal<'mention' | 'command' | undefined>();
  let host: HTMLDivElement | undefined;
  let editor: HTMLDivElement | undefined;
  let interacted = false;
  let selection: Range | undefined;

  function measure() {
    props.onTitleChange?.(
      editor?.querySelector('h1')?.textContent?.trim() ?? ''
    );
    const paragraph = editor?.querySelector('p');
    if (!host || !paragraph) return;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const lines = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0
    );
    if (!lines.length) {
      props.onAnchor?.(null);
      return;
    }
    const bottom = Math.max(...lines.map((rect) => rect.bottom));
    const right = Math.max(
      ...lines
        .filter((rect) => Math.abs(rect.bottom - bottom) < 1)
        .map((rect) => rect.right)
    );
    const bounds = host.getBoundingClientRect();
    props.onAnchor?.({ x: right - bounds.left, y: bottom - bounds.top });
  }
  function interactedWithDocument() {
    if (!interacted) {
      interacted = true;
      props.onInteract?.();
    }
    measure();
  }
  function restoreSelection() {
    editor?.focus({ preventScroll: true });
    if (selection) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection);
    }
  }
  function insertMention(text: string) {
    restoreSelection();
    document.execCommand('insertText', false, text);
    setMenu(undefined);
    interactedWithDocument();
  }
  function command(value: string) {
    restoreSelection();
    if (value === 'bullet') document.execCommand('insertUnorderedList');
    else document.execCommand('formatBlock', false, value);
    setMenu(undefined);
    interactedWithDocument();
  }
  createEffect(() => {
    if (!props.active || !host) return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    props.onReady?.();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={host}
      class="site-live-doc-host"
      style={{ background: props.background ?? 'transparent' }}
    >
      <Show when={props.active} fallback={props.fallback()}>
        <div class="site-live-doc-column">
          <div
            ref={editor}
            class="site-live-doc-editor"
            contentEditable
            role="textbox"
            aria-label="Live Macro document editor"
            aria-multiline="true"
            onInput={interactedWithDocument}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMenu(undefined);
                return;
              }
              if (event.key === ' ') {
                const current = window.getSelection();
                const block =
                  current?.anchorNode?.parentElement?.closest('p, li');
                const shortcut = block?.textContent ?? '';
                if (
                  block &&
                  editor?.contains(block) &&
                  current?.isCollapsed &&
                  /^(#{1,3}|-)$/.test(shortcut)
                ) {
                  event.preventDefault();
                  const range = document.createRange();
                  range.selectNodeContents(block);
                  current.removeAllRanges();
                  current.addRange(range);
                  document.execCommand('delete');
                  if (shortcut === '-')
                    document.execCommand('insertUnorderedList');
                  else
                    document.execCommand(
                      'formatBlock',
                      false,
                      `h${shortcut.length}`
                    );
                  interactedWithDocument();
                  return;
                }
              }
              if (event.key !== '@' && event.key !== '/') return;
              const current = window.getSelection();
              if (!current?.rangeCount) return;
              event.preventDefault();
              selection = current.getRangeAt(0).cloneRange();
              setMenu(event.key === '@' ? 'mention' : 'command');
            }}
          >
            <h1>Why Macro Docs?</h1>
            <p>
              Every document is a CRDT with its own{' '}
              <strong>Durable Object</strong> in the cloud. Edits merge in
              order, so two people can type on the same line without overwriting
              each other.
            </p>
            <h2>Things to try</h2>
            <ul>
              <li>Type anywhere in this document.</li>
              <li>Press @ to link a person, doc, or task.</li>
              <li>Press / for the command menu.</li>
              <li>
                Markdown shortcuts work: <code>#</code> for a heading,{' '}
                <code>-</code> for a list.
              </li>
              <li>
                Math renders inline:{' '}
                <span class="site-live-doc-math">
                  <i>e</i>
                  <sup>iπ</sup> + 1 = 0
                </span>
              </li>
            </ul>
          </div>
          <Show when={menu()}>
            <div
              class="site-live-doc-menu"
              role="toolbar"
              aria-label={
                menu() === 'mention' ? 'Insert mention' : 'Document commands'
              }
            >
              <Show
                when={menu() === 'mention'}
                fallback={
                  <>
                    <button type="button" onClick={() => command('h1')}>
                      Heading
                    </button>
                    <button type="button" onClick={() => command('h2')}>
                      Subheading
                    </button>
                    <button type="button" onClick={() => command('bullet')}>
                      Bullet list
                    </button>
                    <button type="button" onClick={() => command('p')}>
                      Paragraph
                    </button>
                  </>
                }
              >
                <button type="button" onClick={() => insertMention('@Julia')}>
                  Julia Westphal
                </button>
                <button
                  type="button"
                  onClick={() => insertMention('Q3 launch plan')}
                >
                  Q3 launch plan
                </button>
                <button
                  type="button"
                  onClick={() => insertMention('Prepare the launch checklist')}
                >
                  Prepare the launch checklist
                </button>
              </Show>
              <button
                type="button"
                onClick={() => {
                  setMenu(undefined);
                  restoreSelection();
                }}
              >
                Cancel
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * "TRY ME" annotation that sits centered below the text and points up into the
 * editor with a straight arrow. Client-only so it never appears in prerender.
 */
export function TryMePointer(props: {
  active: boolean;
  dismissed?: boolean;
  /** Held at zero opacity until the editor has a document. Defaults to true so
   * a host that draws this over static artwork does not have to opt in. */
  ready?: boolean;
}) {
  if (isServer) return null;
  return (
    <Show when={props.active}>
      <style>{`
        @keyframes liveDocTryMePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.96); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .live-doc-tryme-pulse { animation: liveDocTryMePulse 1.9s ease-in-out infinite; }
        }
      `}</style>
      <div
        aria-hidden="true"
        class="live-doc-tryme"
        style={{
          // Two ways to be invisible, and they are not the same one: not yet
          // (the editor is still a skeleton, so there is nothing to point at)
          // and no longer (the visitor typed). Only the second swells.
          opacity: props.dismissed || props.ready === false ? 0 : 1,
          'pointer-events': 'none',
          // Swell + fade once the user starts typing.
          transform: props.dismissed ? 'scale(1.35)' : 'scale(1)',
          'transform-origin': 'center',
          transition:
            'opacity 450ms ease, transform 450ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* The pulse lives on an inner element, not the wrapper above. A CSS
            animation outranks an inline style, so animating opacity/transform
            on the wrapper would override the dismiss swell and fade and the
            callout would never disappear once the user typed. */}
        <div
          class="live-doc-tryme-pulse"
          style={{
            'align-items': 'center',
            display: 'flex',
            'flex-direction': 'column',
            gap: '4px',
            'transform-origin': 'center',
          }}
        >
          {/* Same arrow glyph as the "Explore X →" buttons, rotated to point up
            into the editor. */}
          <span
            aria-hidden="true"
            style={{
              color: 'var(--a0)',
              display: 'block',
              'font-family': 'body',
              'font-size': '18px',
              'font-weight': '700',
              'line-height': 1,
              transform: 'rotate(-90deg)',
            }}
          >
            →
          </span>
          <span
            style={{
              color: 'var(--a0)',
              'font-family': rajdhani,
              'font-size': '17px',
              'font-weight': '600',
              'letter-spacing': '0.14em',
              'line-height': 1,
              'text-transform': 'uppercase',
              'white-space': 'nowrap',
            }}
          >
            Start typing
          </span>
        </div>
      </div>
    </Show>
  );
}
