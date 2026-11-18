export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email) return { task: null };
  const email = trigger.item.email;
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: { asksForWork: knobs.asksForWork },
  });
  if ((probabilities.asksForWork ?? 0) < 0.5) return { task: null };
  const sender = email.from?.name ?? email.from?.email ?? 'Someone';
  const task = await macro.tasks.create({
    name: email.subject ?? `Email from ${sender}`,
    markdown: [
      `From ${sender}: ${macro.email.byId(trigger.item.entity_id).webUrl()}`,
      email.body ?? '',
    ].join('\n\n'),
    assignees: [await macro.users.me()],
  });
  return { task: task.id };
}
