import { EntityIcon } from '@core/component/EntityIcon';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { Avatar, AvatarGroup } from '@ui/components/Avatar';
import { Button } from '@ui/components/Button';
import { $getNodeByKey, $getRoot, $isTextNode } from 'lexical';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { DocsGraphicFrame } from '../../../../marketing/src/app/components/featureGraphics/DocsMarkdownScene';
import { homepagePeople } from '../core/homepage-demo-people';
import './homepage-collaborative-doc.css';

const INITIAL_DOCUMENT = `# Q3 launch plan

Launch date: Friday, 9:00 AM.

## Owners

Julia: Launch announcement.

Gabriel: Launch checklist.

## Before we launch

- Confirm the invite flow with Teo.
- Share the final plan with Dana.`;

const EDITS = [
  {
    person: 'julia',
    color: 'var(--color-note)',
    prefix: 'Julia: ',
    original: 'Launch announcement.',
    base: 'Launch announcement',
    addition: ' — copy ready for review.',
    start: 1400,
  },
  {
    person: 'gabriel',
    color: 'var(--color-task)',
    prefix: 'Gabriel: ',
    original: 'Launch checklist.',
    base: 'Launch checklist',
    addition: ' — owners confirmed.',
    start: 2200,
  },
] as const;
const FINISH = 7200;
type CursorRect = { left: number; top: number; width: number; height: number };
type Cursor = {
  person: 'julia' | 'gabriel';
  color: string;
  caret: CursorRect;
  selection: CursorRect[];
};

/** The actual editor, with local example edits and measured collaborator carets. */
export default function HomepageCollaborativeDoc() {
  const config = buildConfig('markdown')
    .namespace('homepage-collaborative-doc')
    .withHistory()
    .withSkipPreviewFetch();
  const controls = config.buildHandle().controls;
  const editor = controls.getLexical();
  const keys = new Map<string, string>();
  const [cursors, setCursors] = createSignal<Cursor[]>([]);
  const [paused, setPaused] = createSignal(false);
  const [finished, setFinished] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  let frame!: HTMLDivElement;
  let host!: HTMLDivElement;
  let elapsed = 0;
  let ready = false;
  let visible = false;
  const [reduced, setReduced] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const measureCursors = () => {
    if (!ready || editing()) return;
    const origin = host.getBoundingClientRect();
    const local = (rect: DOMRect): CursorRect => ({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    });
    const next: Cursor[] = [];
    for (const edit of EDITS) {
      const key = keys.get(edit.person);
      const element = key ? editor.getElementByKey(key) : null;
      if (!element) continue;
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!text?.textContent) continue;
      const range = document.createRange();
      range.setStart(text, text.textContent.length);
      range.collapse(true);
      const caret = local(range.getBoundingClientRect());
      range.setStart(text, edit.prefix.length);
      range.setEnd(text, text.textContent.length);
      next.push({
        person: edit.person,
        color: edit.color,
        caret,
        selection:
          elapsed < edit.start ? Array.from(range.getClientRects(), local) : [],
      });
    }
    setCursors(next);
  };

  const renderEdits = () => {
    editor.update(
      () => {
        for (const edit of EDITS) {
          const key = keys.get(edit.person);
          const node = key ? $getNodeByKey(key) : null;
          if (!$isTextNode(node)) continue;
          const count = Math.max(
            0,
            Math.min(
              edit.addition.length,
              Math.floor((elapsed - edit.start) / 105)
            )
          );
          const text =
            edit.prefix +
            (elapsed < edit.start
              ? edit.original
              : edit.base + edit.addition.slice(0, count));
          if (node.getTextContent() !== text) node.setTextContent(text);
        }
      },
      { discrete: true }
    );
    measureCursors();
    setFinished(elapsed >= FINISH);
  };

  const play = () => {
    stop();
    if (
      !ready ||
      !visible ||
      document.hidden ||
      reduced() ||
      paused() ||
      editing() ||
      finished()
    )
      return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      elapsed = Math.min(FINISH, elapsed + Math.min(now - last, 160));
      last = now;
      renderEdits();
      if (!finished()) timer = setTimeout(tick, 80);
    };
    timer = setTimeout(tick, 80);
  };

  const connect = () => {
    editor.read(() => {
      const nodes = $getRoot().getAllTextNodes();
      for (const edit of EDITS) {
        const node = nodes.find((node) =>
          node.getTextContent().startsWith(edit.prefix)
        );
        if (node) keys.set(edit.person, node.getKey());
      }
    });
    ready = true;
    if (reduced()) elapsed = FINISH;
    renderEdits();
    play();
  };

  const takeControl = () => {
    stop();
    setEditing(true);
    setCursors([]);
  };

  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => {
      setReduced(media.matches);
      if (reduced() && ready && !editing()) {
        elapsed = FINISH;
        renderEdits();
      }
      play();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        play();
      },
      { threshold: 0.15 }
    );
    const resize = new ResizeObserver(measureCursors);
    observer.observe(frame);
    resize.observe(host);
    syncMotion();
    document.addEventListener('visibilitychange', play);
    media.addEventListener('change', syncMotion);
    const unregister = editor.registerUpdateListener(() => measureCursors());
    onCleanup(() => {
      stop();
      observer.disconnect();
      resize.disconnect();
      unregister();
      document.removeEventListener('visibilitychange', play);
      media.removeEventListener('change', syncMotion);
    });
  });

  return (
    <div ref={frame} class="homepage-collab-frame">
      <DocsGraphicFrame>
        <div class="workspace-demo homepage-collab" data-theme="dark">
          <div class="homepage-collab-toolbar">
            <span class="flex items-center gap-2">
              <EntityIcon targetType="md" size="sm" /> Q3 launch plan
            </span>
            <AvatarGroup
              size="md"
              aria-label="Jacob, Julia, and Gabriel in this document"
            >
              <For each={['jacob', 'julia', 'gabriel'] as const}>
                {(id) => (
                  <Avatar size="md" highlightEdge>
                    <Avatar.Image
                      src={homepagePeople[id].photo}
                      alt={homepagePeople[id].shortName}
                    />
                    <Avatar.Fallback>
                      {homepagePeople[id].initials}
                    </Avatar.Fallback>
                  </Avatar>
                )}
              </For>
            </AvatarGroup>
          </div>
          <div
            ref={host}
            class="homepage-collab-editor"
            onPointerDown={takeControl}
            onFocusIn={takeControl}
          >
            <MarkdownShell
              config={config}
              initialValue={INITIAL_DOCUMENT}
              onConnect={connect}
              class="text-sm leading-7"
              portalScope="local"
            />
            <div class="homepage-collab-cursors" aria-hidden="true">
              <For each={cursors()}>
                {(cursor) => (
                  <>
                    <For each={cursor.selection}>
                      {(rect) => (
                        <span
                          class="homepage-collab-selection"
                          style={{
                            left: `${rect.left}px`,
                            top: `${rect.top}px`,
                            width: `${rect.width}px`,
                            height: `${rect.height}px`,
                            background: cursor.color,
                          }}
                        />
                      )}
                    </For>
                    <span
                      class="homepage-collab-caret"
                      style={{
                        left: `${cursor.caret.left}px`,
                        top: `${cursor.caret.top}px`,
                        height: `${cursor.caret.height}px`,
                        '--collaborator-color': cursor.color,
                      }}
                    >
                      <span class="homepage-collab-name">
                        {homepagePeople[cursor.person].shortName}
                      </span>
                    </span>
                  </>
                )}
              </For>
            </div>
          </div>
          <div class="homepage-collab-footer">
            <span>
              {editing()
                ? 'Your edits stay in this demo'
                : finished()
                  ? 'Julia and Gabriel finished editing'
                  : paused()
                    ? 'Collaboration paused'
                    : 'Julia and Gabriel are editing…'}
            </span>
            <Show when={!editing() && !reduced()}>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${finished() ? 'Replay' : paused() ? 'Play' : 'Pause'} collaboration demo`}
                onClick={() => {
                  if (finished()) {
                    elapsed = 0;
                    setPaused(false);
                    renderEdits();
                  } else {
                    setPaused((value) => !value);
                  }
                  play();
                }}
              >
                {finished() ? 'Replay' : paused() ? 'Play' : 'Pause'}
              </Button>
            </Show>
          </div>
        </div>
      </DocsGraphicFrame>
    </div>
  );
}
