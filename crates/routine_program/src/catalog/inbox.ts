export async function main({ macro, trigger }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email) return { label: null };
  const email = trigger.item.email;
  const thread = macro.email.byId(trigger.item.entity_id);
  // The labels the owner made in the inbox this email arrived in.
  const inbox = (await thread.link()).id;
  const labels = [];
  for (const label of await macro.email.labels()) {
    if ((await label.linkId()) === inbox && (await label.type()) === 'User') {
      labels.push({ label, name: await label.name() });
    }
  }
  if (labels.length === 0) return { label: null };
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: Object.fromEntries(
      labels.map(({ name }, index) => [`label_${index}`, `Is this email about "${name}"?`]),
    ),
  });
  const scored = labels.map((entry, index) => ({
    ...entry,
    probability: probabilities[`label_${index}`] ?? 0,
  }));
  const best = scored.reduce((top, entry) => (entry.probability > top.probability ? entry : top));
  if (best.probability < 0.5) return { label: null };
  await thread.addLabel(best.label);
  return { label: best.name };
}
