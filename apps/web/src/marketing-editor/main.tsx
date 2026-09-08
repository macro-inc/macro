/**
 * Marketing live-editor demo — the standalone entry behind solid-site's
 * public/live-editor/, embedded in an iframe on the /documents marketing page.
 *
 * This exists because the previously shipped bundle's source was never
 * committed. Keep this file and vite.marketing-editor.config.ts together; the
 * site repo holds only build output.
 *
 * It has NO backend: no auth, no sync service, no uploads. Every affordance the
 * slash menu advertises is wired to something local, and anything that cannot
 * be made to work locally is hidden rather than shipped dead — see
 * ignoreActionIds below.
 *
 * Two fixes over the previously shipped bundle, both caused by the same thing:
 * in this codebase a feature's runtime is registered as a side effect of
 * rendering its menu component, so a demo that renders no menus dispatches
 * commands nobody is listening for and the menu item silently does nothing.
 *
 *   - Links: `.withLinks()` sets `floatingMenu: true`, which is the only gate
 *     on MarkdownShell mounting FloatingLinkMenu, whose unconditional
 *     `plugins.use(linksPlugin(...))` registers the entire link runtime.
 *   - Equations: registered directly with `katexPlugin`. There is no
 *     `withEquations()` on the builder and MarkdownShell never mounts
 *     FloatingEquationMenu, so this is the only way in without editing shared
 *     app files.
 */
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import { $getNodeByKey, $getRoot, $isParagraphNode, type EditorState, RootNode } from 'lexical';
import { $isEquationNode } from '@macro-inc/lexical-core';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import {
  INSERT_EQUATION_COMMAND,
  katexPlugin,
  UPDATE_EQUATION_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/katex/katexPlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';
// Asserted contexts throw rather than returning undefined when missing, so
// every one the editor tree reaches for has to be stood up even though this
// demo has no app shell. See appStubs for the list and why each is there.
import { AppStubProviders } from './appStubs';
import { demoEntities, demoUsersGetter } from './mentionData';
// The app's own stylesheet: tailwind plus the --a0l/--a0c/--a0h theme tokens
// MarkdownShell's classes are built on. Imported before the demo's own CSS so
// the layout rules below win.
import '../index.css';
import './marketing-editor.css';

const SEED = `# Why Macro Docs?

Every document is a CRDT with its own **Durable Object** in the cloud. Edits merge in order, so two people can type on the same line without overwriting each other.

## Things to try

- Type anywhere in this document.
- Press @ to link a person, doc, or task.
- Press / for the command menu.
- Markdown shortcuts work: \`#\` for a heading, \`-\` for a list.
- Math renders inline: $e^{i\\pi} + 1 = 0$
`;

/**
 * Shown faintly on the title row while it is empty, and used by the host for
 * the window chrome when the title is blank.
 *
 * 'New Note' is the app's own default for a markdown block — see
 * features/block-md/definition.ts (`defaultFilename`), which TitleEditor uses
 * as its placeholder and MarkdownNameProvider falls back to for surrounding UI.
 */
const TITLE_PLACEHOLDER = 'New Note';

/**
 * Equation insert/edit input. Deliberately local rather than the app's
 * FloatingEquationMenu: that component bails without a UserContext (its
 * useCanEdit guard), and forking its 288 lines would drift silently against a
 * file that is still changing upstream.
 */
function EquationPrompt(props: {
  open: boolean;
  initial: string;
  onCommit: (latex: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      class="marketing-editor-latex"
      classList={{ 'marketing-editor-latex--open': props.open }}
    >
      <span class="marketing-editor-latex__label">LaTeX</span>
      <input
        class="marketing-editor-latex__input"
        value={props.initial}
        placeholder="\\frac{a}{b}"
        autocomplete="off"
        spellcheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            props.onCommit(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          }
        }}
        ref={(el) => queueMicrotask(() => props.open && el.focus())}
      />
      <span class="marketing-editor-latex__hint">Enter to insert · Esc to cancel</span>
    </div>
  );
}

function Editor() {
  const [latexOpen, setLatexOpen] = createSignal(false);
  const [latexInitial, setLatexInitial] = createSignal('');
  let editingKey: string | null = null;

  const config = buildConfig('markdown')
    .namespace('marketing-live-editor')
    .withMentions({
      entities: demoEntities,
      users: demoUsersGetter,
      disableMentionTracking: true,
      onCreate: () => {},
    })
    .withEmojis()
    // Mounts FloatingLinkMenu, which is what registers linksPlugin at all.
    // common-tlds also autolinks a bare example.com, which demos better.
    .withLinks({ autoLinkMatchMode: 'common-tlds' })
    .withHistory()
    .withSkipPreviewFetch()
    .withActions({
      // 'task' reaches for globalSplitManager, an app singleton that is
      // undefined outside the app shell, and creates a real task server-side —
      // it cannot be made local, so it is hidden rather than shown dead.
      // 'video' is the same action as 'image' with the same dependencies.
      ignoreActionIds: ['task', 'video'],
    });

  // Deliberately NOT calling config.buildHandle() here. MarkdownShell calls it
  // on mount and owns the editor's lifecycle; building it early from this
  // component body hands the shell a handle created under a different owner,
  // and setRootElement then silently no-ops — the editor mounts but never
  // attaches, so the document stays empty. BuilderTestPage never builds early
  // either. The editor arrives through the plugin callbacks below instead.
  let editor!: import('lexical').LexicalEditor;

  const commitLatex = (latex: string) => {
    setLatexOpen(false);
    if (!latex.trim()) return;
    if (editingKey) {
      editor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
        nodeKey: editingKey,
        equation: latex,
      });
    } else {
      editor.dispatchCommand(INSERT_EQUATION_COMMAND, {
        equation: latex,
        inline: true,
      });
    }
    editingKey = null;
  };

  // katexPlugin's TRY_* handlers run inside a Lexical update, so opening UI or
  // re-dispatching from them synchronously is unsafe — defer a microtask.
  config.use((ed) => {
    editor = ed;
    return katexPlugin({
      onCreateEquation: () =>
        queueMicrotask(() => {
          editingKey = null;
          setLatexInitial('');
          setLatexOpen(true);
        }),
      onClickEquation: (nodeKey: string) =>
        queueMicrotask(() => {
          let current = '';
          editor.getEditorState().read(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isEquationNode(node)) current = node.getEquation();
          });
          editingKey = nodeKey;
          setLatexInitial(current);
          setLatexOpen(true);
        }),
    })(ed);
  });

  // The host draws the document's title in the window chrome above this
  // iframe, where it was a frozen string. Push the first heading up whenever it
  // changes so the chrome tracks what the visitor actually types.
  //
  // registerUpdateListener returns its own unregister, which is exactly the
  // cleanup contract config.use expects.
  // The first block is reserved as the document's title row, mirroring how the
  // app splits a markdown document's name from its body (MarkdownNameProvider).
  // Without this the visitor can delete the heading and the window chrome above
  // the iframe has nothing to track.
  config.use((ed) =>
    ed.registerNodeTransform(RootNode, (root) => {
      const first = root.getFirstChild();
      // An empty document still gets its title row: deleting everything must
      // leave the reserved heading (showing its placeholder) rather than a
      // document with no blocks at all.
      if (!first) {
        root.append($createHeadingNode('h1'));
        return;
      }
      if ($isHeadingNode(first)) return;
      const heading = $createHeadingNode('h1');
      if ($isParagraphNode(first)) {
        // Keep whatever is already on line one — it becomes the title.
        first.replace(heading, true);
      } else {
        // A list, quote or code block cannot be a title, so give the document a
        // fresh empty title row above it rather than rewriting the content.
        first.insertBefore(heading);
      }
    })
  );

  let lastTitle: string | null = null;
  config.use((ed) =>
    ed.registerUpdateListener(() => {
      let title = '';
      let titleKey: string | null = null;
      ed.getEditorState().read(() => {
        const first = $getRoot().getFirstChild();
        if (first && $isHeadingNode(first)) {
          titleKey = first.getKey();
          title = first.getTextContent().trim();
        }
      });

      // Faint placeholder on the title row while it is empty, the way the app's
      // TitleEditor shows its own. Driven from here rather than CSS :empty
      // because an empty Lexical block still contains a <br>.
      if (titleKey) {
        const el = ed.getElementByKey(titleKey);
        if (el) {
          if (title) el.removeAttribute('data-title-placeholder');
          else el.setAttribute('data-title-placeholder', TITLE_PLACEHOLDER);
        }
      }

      postAnchor();

      if (title === lastTitle) return;
      lastTitle = title;
      if (window.parent === window) return;
      window.parent.postMessage({ type: 'macro-doc-title', title }, '*');
    })
  );

  /**
   * Report where the intro paragraph's last line ends, so the host can aim its
   * "START TYPING" annotation at it.
   *
   * Measured and posted from in here rather than measured by the host on a
   * timer: only this document knows when it has actually been laid out, and a
   * host-side timeout either fires before the editor attaches or guesses. Rects
   * are relative to this iframe's viewport, which is exactly the box the host
   * positions the annotation inside, so they need no conversion.
   *
   * Measured with a Range over the paragraph's contents, NOT the paragraph's
   * own client rect. A block element's line box spans the full content width,
   * so the element reports its right edge (the column edge) rather than where
   * the sentence stops, which put the annotation ~100px past the period.
   * Range rects hug the text instead.
   *
   * Those rects come one per text node and are not in visual order (an inline
   * <strong> splits them, and Chrome repeats some), so the final line is the
   * one with the greatest bottom, and the sentence ends at the furthest right
   * edge on that line.
   */
  function postAnchor() {
    if (window.parent === window) return;
    const para = document.querySelector('[data-lexical-editor] p');
    if (!para) return;
    const range = document.createRange();
    range.selectNodeContents(para);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (!rects.length) return;
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const lastLine = rects.filter((r) => Math.abs(r.bottom - bottom) < 1);
    const x = Math.max(...lastLine.map((r) => r.right));
    window.parent.postMessage({ type: 'macro-doc-anchor', x, y: bottom }, '*');
  }

  // The wrap point, and so where the sentence ends, moves with the iframe's
  // width; the iframe's window gets a resize event when the host resizes it.
  onMount(() => {
    const onResize = () => postAnchor();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  /**
   * Keeps the document inside the visible editor.
   *
   * The window is a fixed height and clips at the bottom, so anything pushed
   * past that edge is invisible: the visitor would be typing into a void, and
   * the caret could sit somewhere they cannot see. Rather than let the shell
   * scroll, any change that makes the content overflow is rolled back, so the
   * last state that still fitted is what stands.
   *
   * Why revert instead of blocking Enter and text insertion up front: a
   * keystroke often still fits on the current line, and pre-emptively blocking
   * would stop typing while there was room left. Measuring after reconciliation
   * is the only way to know whether a change actually overflowed.
   *
   * Reverting restores that state's own selection too, which is the caret
   * position from before the rejected keystroke — so the caret stays put
   * instead of jumping.
   */
  config.use((ed) => {
    let lastFitting: EditorState | null = null;
    const overflows = () => {
      const shell = document.querySelector<HTMLElement>('.live-editor-shell');
      // +1 for sub-pixel rounding, which otherwise reports a permanent overflow.
      return !!shell && shell.scrollHeight > shell.clientHeight + 1;
    };
    return ed.registerUpdateListener(({ editorState, tags }) => {
      if (!overflows()) {
        lastFitting = editorState;
        return;
      }
      // Our own rollback, or the seed itself does not fit (a very short
      // viewport): leave it alone rather than reverting to nothing.
      if (tags.has('fit-revert') || !lastFitting || lastFitting === editorState) return;
      const restore = lastFitting;
      // Deferred: setEditorState cannot run synchronously inside an update
      // listener, and the tag stops the rollback re-triggering itself.
      queueMicrotask(() => ed.setEditorState(restore, { tag: 'fit-revert' }));
    });
  });

  // /table's action already falls through to a plain 3x3 insert when the picker
  // command has no listener, so registering the plugin is all it needs.
  config.use((ed) => tablePlugin({})(ed));

  // The editor scrolls inside a fixed-height frame on the host page, and scroll
  // chaining does NOT cross an iframe boundary: as soon as
  // .live-editor-shell has anything to scroll, the wheel sticks here and the
  // marketing page stops moving under the pointer. Hand the gesture back to the
  // parent whenever this scroller is already at the edge it is being pushed
  // toward (or has no overflow at all), which is what same-document scroll
  // chaining would have done by itself.
  onMount(() => {
    if (window.parent === window) return;
    const onWheel = (event: WheelEvent) => {
      const el = document.querySelector<HTMLElement>('.live-editor-shell');
      if (!el) return;
      // deltaY is not necessarily pixels — normalise before comparing or
      // forwarding, or a line/page-mode wheel scrolls the page by ~3px.
      const px =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * el.clientHeight
            : event.deltaY;
      const room = el.scrollHeight - el.clientHeight;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= room - 1;
      if (room > 0 && ((px > 0 && !atBottom) || (px < 0 && !atTop))) return;
      // Hand the delta to the host rather than calling parent.scrollBy here:
      // the embedding page may scroll a container instead of the document (the
      // marketing site does), and only the host knows which element that is.
      window.parent.postMessage({ type: 'macro-doc-scroll', deltaY: px }, '*');
      event.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    onCleanup(() => window.removeEventListener('wheel', onWheel));
  });

  onMount(() => {
    // The host page pauses the iframe while it is offscreen so it cannot steal
    // keyboard focus. Blur on pause; there is no autoplay left to stop.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'macro-autoplay') return;
      if (event.data.action === 'pause') {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    window.addEventListener('message', onMessage);
    onCleanup(() => window.removeEventListener('message', onMessage));
  });

  return (
    <div class="live-editor-root">
      <div class="live-editor-column">
        {/*
          placeholder is empty on purpose: the reserved title row draws its own
          faint "New Note" placeholder at exactly this position, and the host
          page already renders a START TYPING hint below the document.
        */}
        <MarkdownShell
          config={config}
          class="live-editor-shell md"
          initialValue={SEED}
          placeholder=""
        />
        <EquationPrompt
          open={latexOpen()}
          initial={latexInitial()}
          onCommit={commitLatex}
          onCancel={() => setLatexOpen(false)}
        />
      </div>
    </div>
  );
}

// Registers the decorator for every custom node type — mentions, equations,
// images, horizontal rules. Lexical's decorate() looks its renderer up in this
// registry and silently renders NOTHING when a node type is missing, so without
// this the editor mounts and reads correctly while every mention and equation
// comes out as an empty span. The app calls it from index.tsx, which this
// standalone entry replaces. Must run before any editor mounts.
initializeLexical();

const root = document.getElementById('root');
if (root) {
  render(
    () => (
      <AppStubProviders>
        <Editor />
      </AppStubProviders>
    ),
    root
  );
}
