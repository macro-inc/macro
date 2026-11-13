export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const name = trigger.item.item?.name ?? 'A task';
  const [lookup] = (await macro.search.names([{ name: knobs.channel, kinds: ['channel'] }])).results;
  const channel = lookup?.matches.find((match) => match.exact && match.type === 'channel');
  if (channel?.type !== 'channel') {
    throw new Error(`There's no channel named "${knobs.channel}". Change the channel this routine posts in.`);
  }
  await channel.entity.send(`Done: ${name}`);
  return { posted: true };
}
