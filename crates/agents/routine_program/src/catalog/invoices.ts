export async function main({ macro, run, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email) return { task: null };
  const email = trigger.item.email;
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body, today: run.at },
    questions: {
      isInvoice: knobs.isInvoice,
      dueSoon: `Is a payment in this email due within ${knobs.dueWithinDays} days of ${run.at}?`,
    },
  });
  if ((probabilities.isInvoice ?? 0) < 0.5 || (probabilities.dueSoon ?? 0) < 0.5) return { task: null };
  const task = await macro.tasks.create({
    name: `Pay: ${email.subject ?? 'invoice'}`,
    assignees: [await macro.users.me()],
  });
  for (const definition of await macro.properties.list({ scope: 'system' })) {
    if ((await definition.displayName) !== 'Priority') continue;
    const option = (await definition.options()).find((option) => String(option.value.value) === knobs.priority);
    if (option) await task.setProperty(definition, { type: 'select_option', option_id: option.id });
  }
  return { task: task.id };
}
