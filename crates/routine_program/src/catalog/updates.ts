export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const name = trigger.item.item?.name ?? 'A task';
  const { results, unavailable } = await macro.search.names([{ name: knobs.channel, kinds: ['channel'] }]);
  const channel = results[0]?.matches.find((match) => match.exact && match.type === 'channel');
  if (channel?.type !== 'channel') {
    if (unavailable.includes('channel')) {
      throw new Error(`Macro couldn't look up channels just now, so "Done: ${name}" wasn't posted.`);
    }
    throw new Error(`There's no channel named "${knobs.channel}". Change the channel this routine posts in.`);
  }
  await channel.entity.send(`Done: ${name}`);
  return { posted: true };
}
