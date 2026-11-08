export async function main({ trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const name = trigger.item.item?.name ?? 'A task';
  await knobs.channel.send(`Done: ${name}`);
  return { posted: true };
}
