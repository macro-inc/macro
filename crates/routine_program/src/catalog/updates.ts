export async function main({ macro, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const name = trigger.item.item?.name ?? 'A task';
  for await (const channel of macro.channels.list()) {
    if ((await channel.name()) === knobs.channel) {
      await channel.send(`Done: ${name}`);
      return { posted: true };
    }
  }
  throw new Error(`There's no channel named "${knobs.channel}". Change the channel this routine posts in.`);
}
