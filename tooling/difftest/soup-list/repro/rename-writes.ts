/**
 * Repro (bun run repro/rename-writes.ts): how many times a rename writes an
 * entity's updated_at. Renames a chat and a task the way the app does
 * (GraphQL renameEntities), then reads updatedAt from REST Soup every 100 ms
 * for 6 s and prints each distinct value with when it first appeared.
 */
import { ApiUser } from '../lib/api';
const origin = process.argv[2] ?? 'https://localhost:23209';
const tag = Date.now().toString(36);
const owner = await new ApiUser(origin, `owner@wrepro-${tag}.difftest.dev`).login();
const chat = await owner.post<{ id: string }>('/cognition/chats', { name: `Repro chat ${tag}` });
const { documentId: task } = await owner.post<{ documentId: string }>('/dss/documents/create_task', { taskName: `Repro task ${tag}` });
const RENAME = `mutation R($inputs: [RenameEntityInput!]!) { renameEntities(inputs: $inputs) { results { __typename } } }`;
const updatedAt = async (type: string, id: string) => {
  const page = await owner.post<any>('/dss/items/soup?limit=50', {});
  return page.items.map((i: any) => i.data).find((d: any) => d?.id === id)?.updatedAt as string | undefined;
};
for (const [type, gqlType, id] of [['chat', 'CHAT', chat.id], ['task', 'DOCUMENT', task]] as const) {
  for (let round = 0; round < 3; round++) {
    await Bun.sleep(1500);
    const before = await updatedAt(type, id);
    const t0 = Date.now();
    await owner.graphql(RENAME, { inputs: [{ entity: { type: gqlType, id }, displayName: `Renamed ${type} ${round} ${tag}` }] });
    const tAck = Date.now() - t0;
    const seen: string[] = [];
    while (Date.now() - t0 < 6000) {
      const v = await updatedAt(type, id);
      if (v && v !== (seen.at(-1)?.split(' @')[0] ?? before)) seen.push(`${v} @${Date.now() - t0}ms`);
      await Bun.sleep(100);
    }
    console.log(`${type} rename ${round}: ack ${tAck} ms; before ${before}; then ${seen.join(', ') || 'unchanged'}`);
  }
}
