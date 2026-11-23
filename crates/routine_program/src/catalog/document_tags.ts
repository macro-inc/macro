export async function main({ macro, trigger }: StepContext) {
  if (trigger.kind !== 'event') return { tag: null };
  const personal = (await macro.properties.tags()).find((set) => set.scope === 'user');
  if (!personal?.definition) return { tag: null };
  const property = macro.properties.definition(personal.definition.id);
  const tags = [];
  for (const option of await property.options()) {
    if (option.value.type === 'string') tags.push({ option, name: option.value.value });
  }
  if (tags.length === 0) return { tag: null };
  const document = macro.documents.byId(trigger.item.entity_id);
  const { probabilities } = await macro.ai.decide({
    input: { name: await document.name },
    questions: Object.fromEntries(
      tags.map(({ name }, index) => [`tag_${index}`, `Is this document about "${name}"?`]),
    ),
  });
  const scored = tags.map((tag, index) => ({ ...tag, probability: probabilities[`tag_${index}`] ?? 0 }));
  const best = scored.reduce((top, tag) => (tag.probability > top.probability ? tag : top));
  if (best.probability < 0.5) return { tag: null };
  await macro.properties.addEntityPropertyOption({ entity: document, property, option: best.option });
  return { tag: best.name };
}
