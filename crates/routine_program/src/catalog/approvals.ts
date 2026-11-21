export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.message?.text || !trigger.item.message_id) {
    return { task: null };
  }
  const message = trigger.item.message;
  const { probabilities } = await macro.ai.decide({
    input: { channel: trigger.item.channel?.name, sender: message.sender, text: message.text },
    questions: { asksApproval: knobs.asksApproval },
  });
  if ((probabilities.asksApproval ?? 0) < 0.5) return { task: null };
  const link = macro.channels.byId(trigger.item.entity_id).message(trigger.item.message_id).webUrl();
  const me = await macro.users.me();
  // The text shows a mention as the person's email: the owner's own adds nothing to their task's name.
  const myEmail = me.email();
  const firstLine = String(message.text).split('\n')[0];
  const ask = (myEmail ? firstLine.replaceAll(`@${myEmail}`, '').replaceAll(myEmail, '') : firstLine)
    .replace(/^[\s,:]+/, '')
    .replace(/\s+([,:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const task = await macro.tasks.create({
    name: `Decide: ${(ask || firstLine).slice(0, 80)}`,
    // The message may be from a private channel: the task is not shared with the owner's team.
    shareWithTeam: false,
    markdown: [`${message.sender ?? 'Someone'} asked: ${link}`, message.text].join('\n\n'),
    assignees: [me],
  });
  return { task: task.id };
}
