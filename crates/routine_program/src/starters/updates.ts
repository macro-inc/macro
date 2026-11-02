// The channel completed tasks are announced in.
const CHANNEL = 'updates';

export async function main({ macro, trigger }: StepContext) {
  if (trigger.kind !== 'event') return { posted: false };
  const name = trigger.item.item?.name ?? 'A task';
  for (const channel of await macro.channels.list()) {
    if ((await channel.name()) === CHANNEL) {
      await channel.send(`Done: ${name}`);
      return { posted: true };
    }
  }
  throw new Error(`There's no channel named "${CHANNEL}". Ask AI to change this routine to post in yours.`);
}
