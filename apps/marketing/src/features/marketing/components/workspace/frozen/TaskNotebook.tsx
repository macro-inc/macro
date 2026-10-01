import ArrowLeft from '@phosphor/arrow-left.svg';
import Hash from '@phosphor/hash.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { WorkspaceTask } from '../../../core/dummy-workspace';
import { homepagePeople } from '../../../core/homepage-demo-people';
import type { DummyWorkspace } from '../../../primitives/createDummyWorkspace';
import { ViewShell } from '../../DemoWorkspaceChrome';
import { ChannelComposer } from '../../email/frozen/ChannelComposer';
import { DemoTags } from './DemoTags';
import {
  DetailLayout,
  PanelGrid,
  PanelRow,
  PanelSection,
  PanelToggle,
} from './DetailPanel';
import { MessageRow } from './MessageRow';
import {
  PersonIcon,
  TaskOwnerMenu,
  TaskPriorityMenu,
  TaskStatusMenu,
} from './TaskProperties';

/** Notebook / TitleEditor / InlineTaskProperties presentation frozen from
 * block-md. Text editing and save handlers use the dummy workspace model. */
export function TaskNotebook(props: {
  workspace: DummyWorkspace;
  task: WorkspaceTask;
  relatedContent?: JSX.Element;
}) {
  const [panel, setPanel] = createSignal<boolean>();
  const save = (patch: Partial<WorkspaceTask>) =>
    props.workspace.updateTask(props.task.id, patch);
  return (
    <>
      <ViewShell.TopBar>
        <Button
          variant="plain"
          size="icon-sm"
          label={
            props.workspace.view() === 'home' ? 'Back to Home' : 'Back to tasks'
          }
          onClick={() => props.workspace.backToCollection('tasks')}
        >
          <ArrowLeft />
        </Button>
        <span class="text-sm text-ink-muted">
          {props.workspace.view() === 'home' ? 'Home' : 'All Tasks'}
        </span>
        <span class="text-ink-muted mx-1">›</span>
        <ListChecks class="size-4 text-task" />
        <span class="truncate text-sm font-medium">{props.task.title}</span>
        <Dropdown modal={false}>
          <Dropdown.Trigger
            size="icon-sm"
            aria-label="Task actions"
            class="ml-auto"
          >
            ⋯
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local">
            <Dropdown.Group>
              <Dropdown.Item
                onSelect={() => {
                  const source = props.task;
                  const id = props.workspace.createTask(
                    `${source.title} (copy)`,
                    source.description,
                    source.channel
                  );
                  props.workspace.updateTask(id, {
                    priority: source.priority,
                    owner: source.owner,
                    tags: [...source.tags],
                    steps: source.steps.map((step) => ({ ...step })),
                  });
                }}
              >
                Duplicate task
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() => {
                  props.workspace.setData('tasks', (tasks) =>
                    tasks.filter((task) => task.id !== props.task.id)
                  );
                  props.workspace.backToCollection('tasks');
                }}
              >
                <Trash class="size-3" />
                Delete sample task
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <Button
          size="sm"
          variant="plain"
          onClick={() => {
            props.workspace.post(
              `Shared task: ${props.task.title}`,
              undefined,
              props.task.id
            );
            props.workspace.openItem('messages');
          }}
        >
          Share
        </Button>
        <PanelToggle open={panel()} onChange={setPanel} />
      </ViewShell.TopBar>
      <DetailLayout
        open={panel()}
        panel={
          <>
            <PanelSection title="Actions" open>
              <div class="flex gap-2">
                <Button
                  size="sm"
                  variant="plain"
                  onClick={() => props.workspace.openItem('agents')}
                >
                  ✧ Ask Macro
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `${props.task.title}\n${props.task.description}`
                    )
                  }
                >
                  Copy as prompt
                </Button>
              </div>
            </PanelSection>
            <PanelSection title="Details" open>
              <PanelGrid>
                <PanelRow label="Owner">
                  <PersonIcon person={props.task.creator} />
                  {homepagePeople[props.task.creator].name}
                </PanelRow>
                <PanelRow label="Created">Sep 28 at 12:34 PM</PanelRow>
                <PanelRow label="Last updated">Today</PanelRow>
              </PanelGrid>
            </PanelSection>
            <PanelSection title="Tags" open>
              <DemoTags
                tags={props.task.tags}
                onChange={(tags) => save({ tags })}
              />
            </PanelSection>
            <PanelSection title="Properties" open>
              <PanelGrid>
                <PanelRow label="Status">
                  <TaskStatusMenu
                    task={props.task}
                    onSave={(status) => save({ status })}
                  />
                </PanelRow>
                <PanelRow label="Priority">
                  <TaskPriorityMenu
                    task={props.task}
                    onSave={(priority) => save({ priority })}
                  />
                </PanelRow>
                <PanelRow label="Assignees">
                  <TaskOwnerMenu
                    task={props.task}
                    onSave={(owner) => save({ owner })}
                  />
                </PanelRow>
              </PanelGrid>
            </PanelSection>
            <PanelSection title="References">
              <button
                type="button"
                onClick={() => {
                  props.workspace.setChannel(props.task.channel);
                  props.workspace.openItem('messages');
                }}
              >
                #{props.task.channel}
              </button>
            </PanelSection>
            <PanelSection title="History">
              <p class="text-xs">Changes in this demo stay in this session.</p>
            </PanelSection>
            <PanelSection title="Activity">
              <For
                each={props.workspace.data.activity
                  .filter((item) => item.text.includes(props.task.title))
                  .slice(0, 5)}
              >
                {(item) => (
                  <p class="text-xs mb-2">
                    {item.text} · {item.time}
                  </p>
                )}
              </For>
            </PanelSection>
          </>
        }
      >
        <div class="dummy-scroll">
          <div class="flex relative text-ink min-h-full min-w-0 isolate px-6">
            <div class="grow basis-0 max-w-3xl pt-12 touch:pt-6 min-w-0 mx-auto pb-12">
              <div class="relative">
                <div
                  contentEditable
                  role="textbox"
                  aria-label="Task title"
                  class="ph-no-capture text-2xl font-semibold outline-none"
                  onBlur={(e) =>
                    save({
                      title:
                        e.currentTarget.innerText.trim() || 'Untitled task',
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                >
                  {props.task.title}
                </div>
              </div>
              <div class="spacer h-3" />
              <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
                <TaskStatusMenu
                  task={props.task}
                  onSave={(status) => save({ status })}
                />
                <TaskPriorityMenu
                  task={props.task}
                  onSave={(priority) => save({ priority })}
                />
                <TaskOwnerMenu
                  task={props.task}
                  onSave={(owner) => save({ owner })}
                />
                <DemoTags
                  tags={props.task.tags}
                  onChange={(tags) => save({ tags })}
                />
                <Show when={props.task.steps.length}>
                  <div
                    class="h-6 inline-flex min-w-0 items-center gap-1.5 rounded-full border border-edge-muted bg-surface-2 px-2 py-1 leading-tight text-xs"
                    aria-label="Checklist progress"
                  >
                    <div class="h-1.5 w-14 overflow-hidden rounded-full bg-edge-muted">
                      <div
                        class="h-full rounded-full bg-accent"
                        style={{
                          width: `${(props.task.steps.filter((step) => step.done).length / props.task.steps.length) * 100}%`,
                        }}
                      />
                    </div>
                    <span class="tabular-nums text-ink-muted">
                      {props.task.steps.filter((step) => step.done).length}/
                      {props.task.steps.length}
                    </span>
                  </div>
                </Show>
              </div>
              <div class="website-demo-markdown md text-base">
                <div
                  role="textbox"
                  aria-label="Task description"
                  contentEditable
                  class="my-4 first:mt-1.5 last:mb-1.5 md-p text-[1em] whitespace-pre-wrap outline-none"
                  onBlur={(e) =>
                    save({ description: e.currentTarget.innerText })
                  }
                >
                  {props.task.description}
                </div>
                <button
                  type="button"
                  class="my-4 flex items-center gap-1.5 text-sm text-ink-muted"
                  onClick={() => {
                    props.workspace.setChannel(props.task.channel);
                    props.workspace.openItem('messages');
                  }}
                >
                  From <Hash class="size-4" />
                  <span class="underline underline-offset-4">
                    {props.task.channel}
                  </span>
                </button>
                <ul class="my-4 first:mt-1.5 last:mb-1.5 list-none md-list md-check">
                  <For each={props.task.steps}>
                    {(step) => (
                      <li
                        class="my-[0.25em]"
                        classList={{
                          'checked md-strike text-ink-extra-muted': step.done,
                        }}
                      >
                        <button
                          class="dummy-check-hit"
                          type="button"
                          role="checkbox"
                          aria-checked={step.done}
                          aria-label={step.text}
                          onClick={() =>
                            save({
                              steps: props.task.steps.map((item) =>
                                item.id === step.id
                                  ? { ...item, done: !item.done }
                                  : item
                              ),
                            })
                          }
                        />
                        <span
                          contentEditable
                          role="textbox"
                          aria-label="Checklist item"
                          class="outline-none"
                          onBlur={(e) =>
                            save({
                              steps: props.task.steps.map((item) =>
                                item.id === step.id
                                  ? { ...item, text: e.currentTarget.innerText }
                                  : item
                              ),
                            })
                          }
                        >
                          {step.text}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
                <Button
                  variant="plain"
                  size="sm"
                  class="text-ink-extra-muted"
                  onClick={() =>
                    save({
                      steps: [
                        ...props.task.steps,
                        {
                          id: crypto.randomUUID(),
                          text: 'New checklist item',
                          done: false,
                        },
                      ],
                    })
                  }
                >
                  <Plus class="size-3" />
                  Add checklist item
                </Button>
              </div>
              {props.relatedContent}
              <div class="mt-8 text-xs text-ink-extra-muted mb-3">
                Discussion
              </div>
              <For each={props.task.comments}>
                {(comment) => <MessageRow message={comment} />}
              </For>
              <ChannelComposer
                label="Comment on sample task"
                placeholder="Leave a comment…"
                onSend={(body) => props.workspace.comment(props.task.id, body)}
              />
            </div>
          </div>
        </div>
      </DetailLayout>
    </>
  );
}
