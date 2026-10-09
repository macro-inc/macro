import ArrowLeft from '@phosphor/arrow-left.svg';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import FileText from '@phosphor/file-text.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { WorkspaceDesktopDemo } from '../WorkspaceDesktopDemo';
import { TaskMention } from '../workspace/frozen/TaskMention';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { REQUEST_DOCUMENT } from './taskProject';
import './task-stories.css';

export function TaskDueDate() {
  return (
    <span class="task-due-date" title="Due Friday">
      <CalendarBlank class="size-3" />
      Friday
    </span>
  );
}

/** Linked sources and task edits share the same local workspace. */
export function TaskProjectView(props: {
  workspace: DummyWorkspace;
  documentSource?: boolean;
}) {
  const w = props.workspace;
  let root!: HTMLDivElement;
  const [returnId, setReturnId] = createSignal<string>();
  let returnLabel = 'From sales';
  const selected = () =>
    w.contentView() === 'tasks'
      ? w.data.tasks.find((task) => task.id === w.selected())
      : undefined;
  createEffect(() => {
    const task = selected();
    if (task) setReturnId(task.id);
  });
  const close = () => {
    const id = returnId();
    if (!id || !w.data.tasks.some((task) => task.id === id)) return;
    w.open('tasks', id);
    queueMicrotask(() => {
      const button = [
        ...root.querySelectorAll<HTMLButtonElement>('button'),
      ].find(
        (item) => item.textContent?.replace(/\s+/g, ' ').trim() === returnLabel
      );
      button?.focus({ preventScroll: true });
    });
  };
  const sourceOpen = () =>
    !!returnId() && ['messages', 'documents'].includes(w.contentView());
  return (
    <div
      ref={root}
      class="task-project-view"
      role="group"
      aria-label="Task and linked sources"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && sourceOpen()) {
          event.stopPropagation();
          close();
        }
      }}
      onClick={(event) => {
        const button = (event.target as HTMLElement).closest('button');
        if (button?.textContent?.includes('From')) {
          returnLabel = 'From sales';
          queueMicrotask(() =>
            root
              .querySelector<HTMLButtonElement>('[aria-label="Close source"]')
              ?.focus({ preventScroll: true })
          );
        }
      }}
    >
      <Switch fallback={<ProductWorkspace workspace={w} />}>
        <Match when={selected()}>
          {(task) => (
            <TaskNotebook
              workspace={w}
              task={task()}
              hideCollectionNavigation={props.documentSource}
              sourceContent={
                props.documentSource ? (
                  <button
                    type="button"
                    class="task-plan-link dummy-entity-link"
                    onClick={() => w.open('documents', 'customer-brief')}
                  >
                    <FileText class="size-4" />
                    {REQUEST_DOCUMENT}
                  </button>
                ) : undefined
              }
              pills={
                <Show when={task().id === 'proposal'}>
                  <TaskDueDate />
                </Show>
              }
              relatedContent={
                <Show when={!props.documentSource}>
                  <button
                    type="button"
                    class="task-plan-link dummy-entity-link"
                    onClick={() => {
                      returnLabel = REQUEST_DOCUMENT;
                      w.open('documents', 'customer-brief');
                      queueMicrotask(() =>
                        root
                          .querySelector<HTMLButtonElement>(
                            '[aria-label="Back to task"]'
                          )
                          ?.focus({ preventScroll: true })
                      );
                    }}
                  >
                    <FileText class="size-4" />
                    {REQUEST_DOCUMENT}
                  </button>
                </Show>
              }
            />
          )}
        </Match>
        <Match when={w.contentView() === 'documents'}>
          <ViewShell.TopBar>
            <Button
              variant="plain"
              size="icon-sm"
              label="Back to task"
              onClick={close}
            >
              <ArrowLeft />
            </Button>
            <FileText class="size-4 text-note" />
            <span class="truncate text-sm">{REQUEST_DOCUMENT}</span>
          </ViewShell.TopBar>
          <div class="dummy-scroll task-checklist-doc">
            <h1>{REQUEST_DOCUMENT}</h1>
            <p class="task-checklist-after">
              Update the homepage and pricing page. Send a proposal by Friday.
            </p>
            <h2>Next step</h2>
            <ul class="task-checklist-list">
              <For each={w.data.tasks}>
                {(task) => (
                  <li>
                    <TaskMention
                      task={task}
                      onOpen={() => w.open('tasks', task.id)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Match>
      </Switch>
      <Show when={sourceOpen() && w.contentView() === 'messages'}>
        <Button
          class="task-source-close"
          variant="plain"
          size="icon-sm"
          label="Close source"
          onClick={close}
        >
          <X />
        </Button>
      </Show>
    </div>
  );
}

export function TaskHeroDemo() {
  return (
    <WorkspaceDesktopDemo
      heroFrame
      view="tasks"
      label="Explore Macro Tasks"
      desktopWidth={1280}
      tasksShowcase
    />
  );
}
