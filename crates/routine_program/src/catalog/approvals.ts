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
  const firstLine = String(message.text).split('\n')[0].slice(0, 80);
  const task = await macro.tasks.create({
    name: `Decide: ${firstLine}`,
    // The message may be from a private channel: the task is not shared with the owner's team.
    shareWithTeam: false,
    markdown: [`${message.sender ?? 'Someone'} asked: ${link}`, message.text].join('\n\n'),
    assignees: [await macro.users.me()],
  });
  return { task: task.id };
}
