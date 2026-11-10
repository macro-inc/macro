export async function main({ macro, trigger }: StepContext) {
  if (trigger.kind !== 'event') return { priority: null };
  let priority;
  for (const definition of await macro.properties.list({ scope: 'system' })) {
    if ((await definition.displayName) === 'Priority') priority = definition;
  }
  if (!priority) return { priority: null };
  const options = (await priority.options()).map((option) => ({
    option,
    name: String(option.value.value),
  }));
  const { probabilities } = await macro.ai.decide({
    input: { task: trigger.item.item },
    questions: Object.fromEntries(
      options.map(({ name }, index) => [`priority_${index}`, `Is "${name}" the right priority for this task?`]),
    ),
  });
  const scored = options.map((entry, index) => ({
    ...entry,
    probability: probabilities[`priority_${index}`] ?? 0,
  }));
  const best = scored.reduce((top, entry) => (entry.probability > top.probability ? entry : top));
  if (best.probability < 0.5) return { priority: null };
  await macro.tasks
    .byId(trigger.item.entity_id)
    .setProperty(priority, { type: 'select_option', option_id: best.option.id });
  return { priority: best.name };
}
