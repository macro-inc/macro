import ArrowLeft from '@phosphor/arrow-left.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type {
  WorkspaceComment,
  WorkspaceView,
} from '../../core/dummy-workspace';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import {
  DocumentShareSheet,
  LAUNCH_MEMBERS,
} from '../documents/DocumentShareSheet';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import '../documents/document-stories.css';
import '../email/email-demos.css';

type WorkPane = { key: string; view: WorkspaceView; id?: string };

/** Each opened item retains its own view while sharing the same editable data. */
function ChannelWorkPane(props: {
  pane: WorkPane;
  workspace: DummyWorkspace;
  active: boolean;
  narrow: boolean;
  navigate: (view: WorkspaceView, id?: string) => void;
  close: () => void;
  registerClose: (element: HTMLButtonElement) => void;
}) {
  const [sharing, setSharing] = createSignal(false);
  const w = props.workspace;
  const scope: DummyWorkspace = {
    ...w,
    view: () => props.pane.view,
    contentView: () => props.pane.view,
    selected: () => props.pane.id,
    open: props.navigate,
    openItem: props.navigate,
    backToCollection: props.close,
    createTask: (...args) => {
      const id = w.createTask(...args);
      props.navigate('tasks', id);
      return id;
    },
  };
  const doc = () =>
    props.pane.view === 'documents'
      ? w.data.documents.find((item) => item.id === props.pane.id)
      : undefined;
  const task = () =>
    props.pane.view === 'tasks'
      ? w.data.tasks.find((item) => item.id === props.pane.id)
      : undefined;
  return (
    <section
      class="channel-work-item dummy-main"
      data-pane-key={props.pane.key}
      data-pane-view={props.pane.view}
      data-active={props.active}
      inert={props.narrow && !props.active}
      aria-hidden={props.narrow && !props.active}
      aria-label="Shared work"
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          (event.target instanceof Element &&
            event.target.closest(
              '[role="menu"], [role="listbox"], [role="dialog"], .doc-share-scrim'
            ))
        )
          return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          props.close();
        }
      }}
    >
      <Switch fallback={<ProductWorkspace workspace={scope} />}>
        <Match when={doc()}>
          <WorkspaceDocuments
            workspace={scope}
            hideCollectionNavigation
            sharingDescription="Shared with #launch"
            onShare={() => setSharing(true)}
          />
        </Match>
        <Match when={props.pane.view === 'email'}>
          <WorkspaceEmail
            workspace={scope}
            tab="all"
            account="all"
            hideCollectionNavigation
          />
        </Match>
        <Match when={task()}>
          {(item) => (
            <TaskNotebook
              workspace={scope}
              task={item()}
              hideCollectionNavigation
              relatedContent={
                <Show when={item().relatedDocumentIds?.length}>
                  <div class="mt-6">
                    <p class="mb-2 text-xs text-ink-muted">Related files</p>
                    <button
                      type="button"
                      class="dummy-entity-link"
                      onClick={() => props.navigate('documents', 'plan')}
                    >
                      <File class="size-4 text-note" />
                      {w.data.documents.find((doc) => doc.id === 'plan')?.title}
                    </button>
                    <button
                      type="button"
                      class="dummy-entity-link"
                      onClick={() => props.navigate('email', 'dana')}
                    >
                      <Envelope class="size-4" />
                      {
                        w.data.emails.find((mail) => mail.id === 'dana')
                          ?.subject
                      }
                    </button>
                  </div>
                </Show>
              }
            />
          )}
        </Match>
      </Switch>
      <Button
        variant="plain"
        size="icon-sm"
        class="channel-work-back"
        label="Back to channel"
        onClick={() => props.navigate('messages')}
      >
        <ArrowLeft class="size-4" />
      </Button>
      <Button
        ref={props.registerClose}
        variant="plain"
        size="icon-sm"
        class="channel-work-close"
        label="Close shared work"
        onClick={props.close}
      >
        <X class="size-4" />
      </Button>
      <DocumentShareSheet
        open={sharing() && !!doc()}
        autoFocus
        title={doc()?.title ?? ''}
        channel={{ members: LAUNCH_MEMBERS, level: 'view' }}
        onClose={() => setSharing(false)}
      />
    </section>
  );
}

/** Opening email adds a third split; closing it reveals the still-mounted document. */
export function ChannelWorkSurface(props: {
  workspace: DummyWorkspace;
  renderMessageDetails?: (message: WorkspaceComment) => JSX.Element;
}) {
  const w = props.workspace;
  let root!: HTMLDivElement;
  const [width, setWidth] = createSignal(0);
  const [panes, setPanes] = createSignal<WorkPane[]>([]);
  const [active, setActive] = createSignal<string>();
  const closeButtons = new Map<string, HTMLButtonElement>();
  const triggers = new Map<string, HTMLElement>();
  const narrow = () => width() < 480 || width() / (panes().length + 1) < 240;
  const navigate = (view: WorkspaceView, id?: string) => {
    if (view === 'messages' || view === 'home') {
      const trigger = triggers.get(active() ?? '');
      if (view === 'messages' && id) w.setChannel(id);
      setActive(undefined);
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
      return;
    }
    const key = `${view}:${id ?? 'new'}`;
    const focus =
      document.activeElement instanceof HTMLElement &&
      root?.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    if (focus) triggers.set(key, focus);
    if (!panes().some((pane) => pane.key === key))
      setPanes((items) => [...items, { key, view, id }]);
    setActive(key);
    if (focus)
      queueMicrotask(() =>
        closeButtons.get(key)?.focus({ preventScroll: true })
      );
  };
  const close = (key: string) => {
    const remaining = panes().filter((pane) => pane.key !== key);
    const next = remaining.at(-1);
    const trigger = triggers.get(key);
    setPanes(remaining);
    setActive(next?.key);
    closeButtons.delete(key);
    triggers.delete(key);
    queueMicrotask(() => {
      if (narrow() && next)
        closeButtons.get(next.key)?.focus({ preventScroll: true });
      else if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  };
  const channel: DummyWorkspace = {
    ...w,
    view: () => 'messages',
    contentView: () => 'messages',
    open: navigate,
    openItem: navigate,
    createTask: (...args) => {
      const id = w.createTask(...args);
      navigate('tasks', id);
      return id;
    },
  };
  onMount(() => {
    const measure = () => setWidth(root.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={root}
      class="channel-work-split"
      style={{ '--channel-pane-count': panes().length + 1 }}
      data-narrow={narrow()}
      data-open={panes().length > 0}
      data-pane-count={panes().length}
      data-active-pane={active()}
    >
      <div
        class="channel-work-conversation dummy-main"
        inert={narrow() && !!active()}
        aria-hidden={narrow() && !!active()}
      >
        <WorkspaceChannel
          workspace={channel}
          renderMessageDetails={props.renderMessageDetails}
        />
      </div>
      <For each={panes()}>
        {(pane) => (
          <ChannelWorkPane
            pane={pane}
            workspace={w}
            navigate={navigate}
            narrow={narrow()}
            active={active() === pane.key}
            close={() => close(pane.key)}
            registerClose={(element) => closeButtons.set(pane.key, element)}
          />
        )}
      </For>
    </div>
  );
}
