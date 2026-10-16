import Envelope from '@phosphor/envelope.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import {
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
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
  const prefix = 'Share the draft for review in ';
  const [draft, setDraft] = createSignal('');
  const [channelLinked, setChannelLinked] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [automatic, setAutomatic] = createSignal(true);
  const [step, setStep] = createSignal(0);
  const frames = Math.ceil(prefix.length / 2);
  const selectChannel = () => {
    setChannelLinked(true);
    setPickerOpen(false);
    setAutomatic(false);
  };
  const playback = createProductWalkthrough({
    root: () =>
      root.querySelector<HTMLElement>('.task-context-share-line') ?? root,
    visibilityThreshold: 1,
    steps: frames + 3,
    reset: () => {},
    reduced: selectChannel,
    delay: (next) =>
      next === 1
        ? 900
        : next <= frames
          ? 45
          : next === frames + 1
            ? 250
            : next === frames + 2
              ? 900
              : 220,
    advance: (next) => {
      setStep(next);
      if (next <= frames) setDraft(prefix.slice(0, next * 2));
      else if (next === frames + 1) {
        setDraft(prefix + '@');
        setPickerOpen(true);
      } else if (next === frames + 3) selectChannel();
    },
  });
  const pause = () => {
    playback.pause();
    setAutomatic(false);
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target: () =>
      automatic() && pickerOpen()
        ? '.task-context-picker [role="option"]'
        : undefined,
  });
  let closeButton: HTMLButtonElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const close = () => {
    setSource(undefined);
    trigger?.focus({ preventScroll: true });
  };
  const open = (value: Source, button: HTMLButtonElement) => {
    pause();
    setPickerOpen(false);
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
    const measure = () => setNarrow(root.clientWidth < 760);
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
            setPickerOpen(false);
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
                    <p class="task-context-reference">
                      Use {mention('brief')} for the scope.
                    </p>
                    <p class="task-context-reference">
                      The deadline is in {mention('email')}.
                    </p>
                    <div class="task-context-reference task-context-share-line">
                      <Show
                        when={channelLinked()}
                        fallback={
                          <p
                            contentEditable
                            role="textbox"
                            aria-label="Task sharing instruction"
                            aria-autocomplete="list"
                            class="task-context-sharing-editor"
                            data-typing={automatic() && !!draft()}
                            textContent={draft()}
                            onInput={(event) =>
                              setPickerOpen(
                                (
                                  event.currentTarget.textContent ?? ''
                                ).includes('@')
                              )
                            }
                            onKeyDown={(event) => {
                              if (pickerOpen() && event.key === 'Enter') {
                                event.preventDefault();
                                selectChannel();
                              }
                              if (pickerOpen() && event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                setPickerOpen(false);
                              }
                            }}
                          />
                        }
                      >
                        <p
                          contentEditable
                          role="textbox"
                          aria-label="Task sharing instruction"
                          class="task-context-sharing-editor"
                        >
                          {prefix}
                          {mention('channel')}.
                        </p>
                      </Show>
                      <Show when={pickerOpen()}>
                        <div
                          class="task-context-picker"
                          onClick={(event) => {
                            if (
                              (event.target as Element).closest(
                                '[role="option"]'
                              )
                            )
                              selectChannel();
                          }}
                        >
                          <DocMentionMenu
                            groups={[
                              { label: 'Channels', rows: [mentions.channel] },
                            ]}
                            selected={0}
                            style={{
                              position: 'absolute',
                              left: '0',
                              bottom: 'calc(100% + 6px)',
                              width: 'min(320px, 100%)',
                            }}
                          />
                        </div>
                      </Show>
                    </div>
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
              label="Jacob"
              class="task-context-pointer"
              clicking={step() === frames + 2}
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
