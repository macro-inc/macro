export async function main({ macro, run, knobs }: StepContext) {
  const due = new Date(new Date(run.at).getTime() + knobs.dueInDays * 24 * 60 * 60 * 1000);
  const task = await macro.tasks.create({
    name: knobs.name,
    assignees: [await macro.users.me()],
    dueDate: due,
  });
  return { task: task.id };
}
