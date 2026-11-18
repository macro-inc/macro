export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email || trigger.item.email.unavailable) return { task: null };
  const email = trigger.item.email;
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: { asksForWork: knobs.asksForWork },
  });
  if ((probabilities.asksForWork ?? 0) < 0.5) return { task: null };
  const sender = email.from?.name ?? email.from?.email ?? 'Someone';
  // One task per conversation: replies keep the subject, so they find it.
  const subject = String(email.subject ?? '').replace(/^((re|fwd?):\s*)+/i, '').trim();
  const name = (subject || `Email from ${sender}`).slice(0, 200);
  let seen = 0;
  for await (const earlier of macro.tasks.search(name, { searchOn: 'name' })) {
    if ((await earlier.name()) === name) return { task: null, existing: earlier.id };
    if (++seen === 10) break;
  }
  const task = await macro.tasks.create({
    name,
    // The email's text stays the owner's: the task is not shared with their team.
    shareWithTeam: false,
    markdown: [
      `From ${sender}: ${macro.email.byId(trigger.item.entity_id).webUrl()}`,
      email.body ?? '',
    ].join('\n\n'),
    assignees: [await macro.users.me()],
  });
  return { task: task.id };
}
