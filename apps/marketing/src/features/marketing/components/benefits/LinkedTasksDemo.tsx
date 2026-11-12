import { Button } from '@ui';
import { Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskMention } from '../workspace/frozen/TaskMention';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import '../workspace/dummy-workspace.css';

/** Native task mentions and the incoming reference navigate the same two records. */
export function LinkedTasksDemo() {
  const workspace = createDummyWorkspace('tasks');
  const launch = workspace.createTask(
    'Prepare the customer launch',
    'Ship the checkout fix before inviting Northwind.',
    'engineering'
  );
  const fix = workspace.createTask(
    'Fix checkout timeout',
    'Keep the session cookie when retrying payments in Safari.',
    'engineering'
  );
  workspace.updateTask(launch, {
    priority: 'High',
    tags: ['Launch'],
    owner: 'julia',
  });
  workspace.updateTask(fix, {
    status: 'Completed',
    tags: ['Engineering'],
    owner: 'teo',
  });
  workspace.setData('channels', (channels) => [
    ...channels,
    {
      id: 'engineering',
      messages: [
        {
          id: 'launch-request',
          person: 'julia',
          time: '9:40 AM',
          body: 'Let’s keep the checkout fix linked to the customer launch.',
          taskId: launch,
        },
        {
          id: 'checkout-fixed',
          person: 'teo',
          time: '2:10 PM',
          body: 'Safari fix is ready. Regression tests pass.',
          taskId: fix,
        },
      ],
    },
  ]);
  workspace.setChannel('engineering');
  workspace.open('tasks', launch);
  const task = () =>
    workspace.data.tasks.find((item) => item.id === workspace.selected());
  const related = () =>
    workspace.data.tasks.find(
      (item) => item.id === (workspace.selected() === launch ? fix : launch)
    );
  const open = (id: string) => workspace.open('tasks', id);
  return (
    <ProductDemo
      label="Follow a task mention and its incoming reference"
      height={520}
      mobileHeight={580}
    >
      <Show
        when={task()}
        keyed
        fallback={<ProductWorkspace workspace={workspace} />}
      >
        {(current) => (
          <TaskNotebook
            workspace={workspace}
            task={current}
            hideCollectionNavigation
            initialPanelOpen={current.id === fix}
            navigation={
              current.id === fix ? (
                <Button size="sm" variant="plain" onClick={() => open(launch)}>
                  Back
                </Button>
              ) : undefined
            }
            descriptionContent={
              <>
                <p>{current.description}</p>
                <Show when={current.id === launch && related()}>
                  {(linked) => (
                    <p>
                      Ready to ship after{' '}
                      <TaskMention
                        inline
                        task={linked()}
                        onOpen={() => open(fix)}
                      />
                      .
                    </p>
                  )}
                </Show>
              </>
            }
            referencesContent={
              <Show
                when={current.id === fix && related()}
                fallback={
                  <span class="text-ink-muted">
                    No incoming references yet.
                  </span>
                }
              >
                {(linked) => (
                  <TaskMention task={linked()} onOpen={() => open(launch)} />
                )}
              </Show>
            }
          />
        )}
      </Show>
    </ProductDemo>
  );
}
