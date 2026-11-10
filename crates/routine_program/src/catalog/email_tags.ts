export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email) return { tag: null };
  const email = trigger.item.email;
  const personal = (await macro.properties.tags()).find((set) => set.scope === 'user');
  // Without a personal tag set there is nowhere to tag; starting this
  // routine from a suggestion provisions one.
  if (!personal?.definition) return { tag: null };
  const property = macro.properties.definition(personal.definition.id);
  const options = await property.options();
  const tags = [
    { name: knobs.replyTag, question: 'Is the sender waiting on a reply from me?' },
    { name: knobs.followupTag, question: 'Should I follow up on this later, or is it waiting on someone else?' },
    { name: knobs.actionTag, question: 'Does this email ask me to do work other than reply?' },
    { name: knobs.fyiTag, question: 'Is this email only for my information, with nothing to do?' },
  ];
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: Object.fromEntries(tags.map(({ question }, index) => [`tag_${index}`, question])),
  });
  const scored = tags.map((tag, index) => ({ ...tag, probability: probabilities[`tag_${index}`] ?? 0 }));
  const best = scored.reduce((top, tag) => (tag.probability > top.probability ? tag : top));
  if (best.probability < 0.5) return { tag: null };
  // A tag the owner doesn't have yet is made on first use.
  const option =
    options.find((option) => option.value.type === 'string' && option.value.value === best.name) ??
    (await property.addOption({
      type: 'select_string',
      option: { value: best.name, display_order: options.length },
    }));
  await macro.properties.addEntityPropertyOption({
    entity: macro.email.byId(trigger.item.entity_id),
    property,
    option,
  });
  return { tag: best.name };
}
