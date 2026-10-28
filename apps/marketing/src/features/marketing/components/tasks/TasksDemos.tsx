import DummyWorkspace from '../workspace/DummyWorkspace';

/** The feature sections use the same interactive workspace as /demo. */
export function TasksInboxDemo() {
  return <DummyWorkspace initialView="tasks" embedded />;
}

export function TaskPropertiesDemo() {
  return (
    <DummyWorkspace initialView="tasks" initialTask="announcement" embedded />
  );
}
