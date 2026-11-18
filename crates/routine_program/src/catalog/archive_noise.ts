export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email) return { archived: false };
  const email = trigger.item.email;
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: { noise: knobs.isNoise },
  });
  // Archiving hides mail, so a bare "probably" is not enough.
  if ((probabilities.noise ?? 0) * 100 < knobs.certainty) return { archived: false };
  await macro.email.byId(trigger.item.entity_id).archive();
  return { archived: true };
}
