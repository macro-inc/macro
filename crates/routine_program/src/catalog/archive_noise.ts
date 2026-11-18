export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email || trigger.item.email.unavailable) return { archived: false };
  const email = trigger.item.email;
  const thread = macro.email.byId(trigger.item.entity_id);
  // Archiving takes the whole thread: never one the owner has written in.
  if (await thread.latestOutboundAt()) return { archived: false };
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: { noise: knobs.isNoise },
  });
  // Archiving hides mail, so a bare "probably" is not enough.
  if ((probabilities.noise ?? 0) * 100 < knobs.certainty) return { archived: false };
  await thread.archive();
  return { archived: true };
}
