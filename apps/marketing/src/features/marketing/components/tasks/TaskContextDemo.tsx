import Envelope from '@phosphor/envelope.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { createDemoPointer } from '../agents/createDemoPointer';
import { DemoCursor } from '../DemoCursor';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DocMention, type DocMentionItem } from '../documents/DocMention';
import { DocMentionMenu } from '../documents/DocMentionMenu';
import { DocumentShareSheet } from '../documents/DocumentShareSheet';
import { EmailThread } from '../email/frozen/EmailThread';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { createProposalWorkspace } from './proposalWorkspace';
import './task-context.css';

type Source = 'brief' | 'email' | 'channel';
const mentions: Record<Source, DocMentionItem> = {
  brief: { kind: 'document', label: 'Customer brief' },
  email: { kind: 'email', label: 'Proposal request' },
  channel: { kind: 'channel', label: 'sales' },
};

/** Task description mentions open the actual source beside the task. */
export function TaskContextDemo() {
  const w = createProposalWorkspace();
  const task = () =>
    w.data.tasks.find((item) => item.id === w.selected()) ?? w.data.tasks[0];
  const [source, setSource] = createSignal<Source>();
  const [sharing, setSharing] = createSignal(false);
  const [shareTarget, setShareTarget] = createSignal<'task' | 'brief'>('task');
  const brief = () => w.data.documents.find((item) => item.id === 'brief')!;
  const mentionItem = (value: Source): DocMentionItem =>
    value === 'brief'
      ? { ...mentions.brief, label: brief().title }
      : mentions[value];
  const [narrow, setNarrow] = createSignal(true);
  let root!: HTMLDivElement;
  const lines = [
    {
      id: 'brief',
      prefix: 'Use ',
      suffix: ' for the scope.',
      label: 'Task document reference',
      group: 'Documents, Agents, & Tasks',
    },
    {
      id: 'email',
      prefix: 'The deadline is in ',
      suffix: '.',
      label: 'Task email reference',
      group: 'Emails',
    },
    {
      id: 'channel',
      prefix: 'Share the draft for review in ',
      suffix: '.',
      label: 'Task sharing instruction',
      group: 'Channels',
    },
  ] as const;
  const [drafts, setDrafts] = createStore<Record<Source, string>>({
    brief: '',
    email: '',
    channel: '',
  });
  const [linked, setLinked] = createStore<Record<Source, boolean>>({
    brief: false,
    email: false,
    channel: false,
  });
  const [picker, setPicker] = createSignal<Source>();
  const [pickerOffset, setPickerOffset] = createSignal(0);
  const positionPicker = () => {
    const current = picker();
    if (!current || !root?.isConnected) return;
    const line = root.querySelector<HTMLElement>(
      `[data-context-line="${current}"]`
    );
    const editor = line?.querySelector<HTMLElement>('[role="textbox"]');
    if (!line || !editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const rects = range.getClientRects();
    const lastLine = rects[rects.length - 1];
    const bounds = line.getBoundingClientRect();
    const menuWidth = Math.min(320, line.clientWidth);
    setPickerOffset(
      Math.max(
        0,
        Math.min(
          (lastLine?.right ?? bounds.left) - bounds.left,
          line.clientWidth - menuWidth
        )
      )
    );
  };
  createEffect(() => {
    if (picker()) queueMicrotask(positionPicker);
  });
  const [typing, setTyping] = createSignal<Source>();
  const [automatic, setAutomatic] = createSignal(true);
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const [suffixes, setSuffixes] = createStore<Record<Source, string>>({
    brief: '',
    email: '',
    channel: '',
  });
  const selectSource = (id: Source, manual = true) => {
    setLinked(id, true);
    setPicker(undefined);
    setTyping(manual ? undefined : id);
    if (manual) setSuffixes(id, lines.find((line) => line.id === id)!.suffix);
  };
  const actions = lines.flatMap((line) => [
    {
      delay: 1200,
      run: () => {
        setClicking(false);
        setTarget(`[data-context-line="${line.id}"] [role="textbox"]`);
      },
    },
    {
      delay: 550,
      run: () => {
        setClicking(true);
        setTyping(line.id);
      },
    },
    ...demoTypingActions(line.prefix, (text) => setDrafts(line.id, text)),
    {
      delay: 250,
      run: () => {
        setDrafts(line.id, line.prefix + '@');
        setPicker(line.id);
      },
    },
    {
      delay: 450,
      run: () => {
        setClicking(false);
        setTarget(`[data-context-line="${line.id}"] [role="option"]`);
      },
    },
    {
      delay: 650,
      run: () => {
        setClicking(true);
        selectSource(line.id, false);
      },
    },
    ...demoTypingActions(
      line.suffix,
      (text) => {
        setClicking(false);
        setSuffixes(line.id, text);
      },
      350
    ),
    { delay: 200, run: () => setTyping(undefined) },
  ]);
  const playback = createProductWalkthrough({
    root: () =>
      root.querySelector<HTMLElement>('[data-context-line="channel"]') ?? root,
    visibilityThreshold: 1,
    steps: actions.length,
    loop: { hold: 6500 },
    reset: () => {
      setDrafts({ brief: '', email: '', channel: '' });
      setSuffixes({ brief: '', email: '', channel: '' });
      setLinked({ brief: false, email: false, channel: false });
      setPicker(undefined);
      setTyping(undefined);
      setSource(undefined);
      setSharing(false);
      setTarget(undefined);
      setClicking(false);
      setAutomatic(true);
    },
    reduced: () => {
      setLinked({ brief: true, email: true, channel: true });
      for (const line of lines) setSuffixes(line.id, line.suffix);
      setPicker(undefined);
      setTyping(undefined);
      setAutomatic(false);
    },
    onTakeover: () => {
      setAutomatic(false);
      setTyping(undefined);
    },
    delay: (next) => actions[next - 1].delay,
    advance: (next) => actions[next - 1].run(),
  });
  const pause = () => {
    playback.pause();
    setAutomatic(false);
    setTyping(undefined);
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: automatic,
  });
  let closeButton: HTMLButtonElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const close = () => {
    setSource(undefined);
    trigger?.focus({ preventScroll: true });
  };
  const open = (value: Source, button: HTMLButtonElement) => {
    pause();
    setPicker(undefined);
    trigger = button;
    setSource(value);
    queueMicrotask(() => closeButton?.focus({ preventScroll: true }));
  };
  const mention = (value: Source) => (
    <button
      type="button"
      contentEditable={false}
      class="task-context-mention"
      aria-label={`Open ${mentionItem(value).label}`}
      onClick={(event) => open(value, event.currentTarget)}
    >
      <DocMention item={mentionItem(value)} />
    </button>
  );
  onMount(() => {
    const measure = () => {
      setNarrow(root.clientWidth < 760);
      positionPicker();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });
  const linkedWorkspace = {
    ...w,
    openItem: (view: WorkspaceView) => {
      if (view === 'documents') setSource('brief');
      else if (view === 'email') setSource('email');
      else close();
    },
  };
  return (
    <ProductDemo
      label="A task with its brief, customer email, and conversation"
      onInteract={pause}
      height={540}
      mobileHeight={560}
    >
      <div
        ref={root}
        class="task-context-layout"
        data-narrow={narrow()}
        data-source-open={!!source()}
        onPointerDown={(event) => {
          if (!(event.target as Element).closest('.task-context-share-line'))
            setPicker(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && source() && !event.defaultPrevented) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div
          class="task-context-primary dummy-main"
          inert={!!source() && narrow()}
        >
          <Show
            when={task()}
            keyed
            fallback={<ProductWorkspace workspace={w} />}
          >
            {(currentTask) => (
              <TaskNotebook
                workspace={w}
                task={currentTask}
                hideCollectionNavigation
                onShare={() => {
                  setShareTarget('task');
                  setSharing(true);
                }}
                sourceContent={<span />}
                descriptionContent={
                  <>
                    <div
                      contentEditable
                      role="textbox"
                      aria-label="Task description"
                      class="task-context-description"
                      onBlur={(event) =>
                        w.updateTask(currentTask.id, {
                          description: event.currentTarget.innerText,
                        })
                      }
                    >
                      {currentTask.description}
                    </div>
                    <For each={lines}>
                      {(line) => (
                        <div
                          class="task-context-reference task-context-share-line"
                          data-context-line={line.id}
                          data-demo-mentions="off"
                        >
                          <Show
                            when={linked[line.id]}
                            fallback={
                              <p
                                contentEditable
                                role="textbox"
                                aria-label={line.label}
                                aria-autocomplete="list"
                                class="task-context-sharing-editor"
                                data-typing={
                                  automatic() && typing() === line.id
                                }
                                textContent={drafts[line.id]}
                                onInput={(event) => {
                                  setPicker(
                                    (
                                      event.currentTarget.textContent ?? ''
                                    ).includes('@')
                                      ? line.id
                                      : undefined
                                  );
                                  queueMicrotask(positionPicker);
                                }}
                                onKeyDown={(event) => {
                                  if (
                                    picker() === line.id &&
                                    event.key === 'Enter'
                                  ) {
                                    event.preventDefault();
                                    selectSource(line.id);
                                  }
                                  if (
                                    picker() === line.id &&
                                    event.key === 'Escape'
                                  ) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setPicker(undefined);
                                  }
                                }}
                              />
                            }
                          >
                            <p
                              contentEditable
                              role="textbox"
                              aria-label={line.label}
                              class="task-context-sharing-editor"
                              data-typing={automatic() && typing() === line.id}
                            >
                              {line.prefix}
                              {mention(line.id)}
                              {suffixes[line.id]}
                            </p>
                          </Show>
                          <Show when={picker() === line.id}>
                            <div
                              class="task-context-picker"
                              onClick={(event) => {
                                if (
                                  (event.target as Element).closest(
                                    '[role="option"]'
                                  )
                                )
                                  selectSource(line.id);
                              }}
                            >
                              <DocMentionMenu
                                groups={[
                                  {
                                    label: line.group,
                                    rows: [mentionItem(line.id)],
                                  },
                                ]}
                                selected={0}
                                style={{
                                  position: 'absolute',
                                  left: `${pickerOffset()}px`,
                                  bottom: 'calc(100% + 6px)',
                                  width: 'min(320px, 100%)',
                                }}
                              />
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </>
                }
              />
            )}
          </Show>
        </div>
        <Show when={source()}>
          <section
            class="task-context-source dummy-main"
            aria-label="Linked task source"
          >
            <Switch>
              <Match when={source() === 'brief'}>
                <WorkspaceDocuments
                  workspace={{
                    ...linkedWorkspace,
                    selected: () => 'brief',
                    backToCollection: close,
                  }}
                  hideCollectionNavigation
                  onShare={() => {
                    setShareTarget('brief');
                    setSharing(true);
                  }}
                />
              </Match>
              <Match when={source() === 'email'}>
                <ViewShell.TopBar>
                  <Envelope class="size-4" />
                  <span class="text-sm truncate">Proposal request</span>
                </ViewShell.TopBar>
                <div class="dummy-scroll sample-email-thread">
                  <EmailThread
                    email={w.data.emails.find((item) => item.id === 'dana')!}
                    hideHeader
                    hideReply
                  />
                </div>
              </Match>
              <Match when={source() === 'channel'}>
                <WorkspaceChannel workspace={linkedWorkspace} />
              </Match>
            </Switch>
            <Button
              ref={closeButton}
              class="task-context-close"
              label="Close linked source"
              variant="plain"
              size="icon-sm"
              onClick={close}
            >
              <X />
            </Button>
          </section>
        </Show>
        <Show when={pointer()}>
          {(point) => (
            <DemoCursor
              class="task-context-pointer"
              clicking={clicking()}
              style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
            />
          )}
        </Show>
      </div>
      <DocumentShareSheet
        open={sharing()}
        title={
          shareTarget() === 'brief' ? brief().title : (task()?.title ?? 'Task')
        }
        entityLabel={shareTarget() === 'brief' ? 'document' : 'task'}
        onClose={() => setSharing(false)}
      />
    </ProductDemo>
  );
}
