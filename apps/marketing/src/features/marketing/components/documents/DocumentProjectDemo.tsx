import X from '@phosphor/x.svg';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import type {
  WorkspaceComment,
  WorkspaceView,
} from '../../core/dummy-workspace';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { MessageRow } from '../workspace/frozen/MessageRow';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import { DocMention, type DocMentionItem } from './DocMention';
import { DocumentFrame } from './DocumentFrame';
import {
  createDocumentProject,
  PROJECT_EMAIL,
  PROJECT_INTRO,
  PROJECT_TAGS,
  PROJECT_TASK,
  PROJECT_TITLE,
} from './documentProject';
import { createSceneClock, typed } from './documentScene';

export type DocumentSource = 'email' | 'task' | 'channel';
const SPLIT_MIN_WIDTH = 720;
const SOURCES: Record<
  DocumentSource,
  { view: WorkspaceView; id: string; item: DocMentionItem }
> = {
  email: { view: 'email', id: 'dana', item: PROJECT_EMAIL },
  task: { view: 'tasks', id: 'invite', item: PROJECT_TASK },
  channel: {
    view: 'messages',
    id: 'website',
    item: { kind: 'channel', label: 'website' },
  },
};

/** A source opens in a sibling split, using the app's compact close control. */
export function DocumentSourceView(props: {
  source: DocumentSource;
  onClose: () => void;
  autoFocus: boolean;
  label?: string;
  closeLabel?: string;
}) {
  const w = createDocumentProject();
  createEffect(
    on(
      () => props.source,
      (source) => {
        w.open(SOURCES[source].view, SOURCES[source].id);
      }
    )
  );
  const linkedWorkspace = { ...w, backToCollection: props.onClose };
  const task = () =>
    w.contentView() === 'tasks'
      ? w.data.tasks.find((item) => item.id === w.selected())
      : undefined;
  let close!: HTMLButtonElement;
  createEffect(
    on(
      () => [props.source, props.autoFocus] as const,
      ([, autoFocus]) => {
        if (autoFocus) close?.focus({ preventScroll: true });
      }
    )
  );
  return (
    <section
      class="doc-source-view dummy-main"
      aria-label={props.label ?? 'Linked source'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <Switch fallback={<ProductWorkspace workspace={linkedWorkspace} />}>
        <Match when={w.contentView() === 'email'}>
          <WorkspaceEmail
            workspace={linkedWorkspace}
            tab="all"
            account="all"
            hideCollectionNavigation
          />
        </Match>
        <Match when={task()}>
          {(item) => (
            <TaskNotebook
              workspace={linkedWorkspace}
              task={item()}
              hideCollectionNavigation
            />
          )}
        </Match>
      </Switch>
      <Button
        ref={close}
        variant="plain"
        size="icon-sm"
        class="doc-source-close"
        label={props.closeLabel ?? 'Close split'}
        onClick={props.onClose}
      >
        <X class="size-4" />
      </Button>
    </section>
  );
}

export function DocumentSourceLink(props: {
  source: DocumentSource;
  onOpen: (source: DocumentSource) => void;
}) {
  return (
    <button
      type="button"
      contentEditable={false}
      class="doc-source-link"
      onClick={() => props.onOpen(props.source)}
    >
      <DocMention item={SOURCES[props.source].item} />
    </button>
  );
}

/** Keep the document visible in a split; a narrow frame shows one pane at a time. */
export function DocumentSourceSurface(
  props: ParentProps<{
    source?: DocumentSource;
    onClose: () => void;
    focusSource?: boolean;
  }>
) {
  let root!: HTMLDivElement;
  const [narrow, setNarrow] = createSignal(true);
  onMount(() => {
    const measure = () => setNarrow(root.clientWidth < SPLIT_MIN_WIDTH);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={root}
      class="doc-source-split"
      data-narrow={narrow()}
      data-source-open={!!props.source}
    >
      <div
        class="doc-source-original dummy-main"
        inert={!!props.source && narrow()}
      >
        {props.children}
      </div>
      <Show when={props.source}>
        {(source) => (
          <DocumentSourceView
            source={source()}
            onClose={props.onClose}
            autoFocus={props.focusSource ?? true}
          />
        )}
      </Show>
    </div>
  );
}

export function DocumentProjectDemo() {
  let root!: HTMLDivElement;
  const clock = createSceneClock({ root: () => root, end: 5200, lead: 900 });
  const [source, setSource] = createSignal<DocumentSource>();
  const [focusSource, setFocusSource] = createSignal(false);
  const [comments, setComments] = createSignal<WorkspaceComment[]>([
    {
      id: 'julia-invitations',
      person: 'julia',
      time: '10:24 AM',
      body: 'can we put the free plan above the FAQ?',
    },
  ]);
  let trigger: HTMLElement | undefined;
  const open = (next: DocumentSource) => {
    clock.pause();
    trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setFocusSource(true);
    setSource(next);
  };
  const back = () => {
    setSource(undefined);
    (
      trigger ??
      root.querySelector<HTMLButtonElement>(
        '.doc-source-original .doc-source-link'
      )
    )?.focus({ preventScroll: true });
  };
  return (
    <ProductDemo
      ref={(element) => {
        root = element;
      }}
      label="Write together in the Website brief"
      onInteract={clock.pause}
      height={660}
      mobileHeight={650}
    >
      <DocumentSourceSurface
        source={source()}
        onClose={back}
        focusSource={focusSource()}
      >
        <DocumentFrame
          title={PROJECT_TITLE}
          tags={PROJECT_TAGS}
          footer={
            <div class="doc-project-discussion">
              <div class="text-xs text-ink-extra-muted mb-3">Discussion</div>
              <For each={comments()}>
                {(comment) => <MessageRow message={comment} />}
              </For>
              <ChannelComposer
                label="Comment on the Website brief"
                placeholder="Leave a comment…"
                onSend={(body) =>
                  setComments((items) => [
                    ...items,
                    {
                      id: crypto.randomUUID(),
                      person: 'jacob',
                      time: 'Now',
                      body,
                    },
                  ])
                }
              />
            </div>
          }
        >
          <h2>What we’re changing</h2>
          <p>
            Make the homepage easier to scan. Show what the product does before
            asking people to sign up.
          </p>
          <h2>Pricing</h2>
          <p>
            {PROJECT_INTRO} Julia’s notes are in{' '}
            <DocumentSourceLink source="email" onOpen={open} />.
          </p>
          <h2>Before we publish</h2>
          <ul class="md-list">
            <li>
              Teo owns <DocumentSourceLink source="task" onOpen={open} />.
            </li>
            <li>
              Julia checks the copy.
              {typed(' Keep the headings short.', clock.t(), 1200, 3800)}
              <Show when={clock.live() && !clock.done()}>
                <span
                  class="doc-caret doc-named-caret"
                  data-caret="julia"
                  data-name="Julia"
                />
              </Show>
            </li>
            <li>
              Jacob tests signup.
              {typed(' Check it on mobile too.', clock.t(), 2000, 5200)}
              <Show when={clock.live() && !clock.done()}>
                <span
                  class="doc-caret doc-named-caret"
                  data-caret="jacob"
                  data-name="Jacob"
                />
              </Show>
            </li>
          </ul>
        </DocumentFrame>
      </DocumentSourceSurface>
    </ProductDemo>
  );
}
