import { LoroMap, LoroMovableList, LoroText } from "loro-crdt";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";
import { FromPeer, FromRemote } from "../bebop/generated/schema";
import { createTestUser, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeAll(async () => {
  mf = await setupMiniflare();
});

afterAll(async () => {
  await mf.dispose();
});

// Every request to the Durable Object waits behind queued messages, and the
// front worker fails a connect it can't answer within `DEFAULT_TIMEOUT_MS`.
const CONNECT_BUDGET_MS = 4_500;

test("keystrokes into sections typed by rotating AI writers are acknowledged within the connect budget", async () => {
  const documentId = crypto.randomUUID();
  const ai = await createTestUser(mf, documentId, { userId: "ai" });
  const children = ai.doc.getMap("root").setContainer("children", new LoroMovableList());
  for (let paragraph = 0; paragraph < 400; paragraph++) {
    const node = children.insertContainer(paragraph, new LoroMap());
    node.setContainer("$", new LoroMap()).set("id", `paragraph-${paragraph}`);
    node.setContainer("text", new LoroText()).insert(0, "lorem ipsum ".repeat(30));
  }
  ai.doc.commit();
  const sections: LoroText[] = [];
  for (const writer of [0, 1, 2]) {
    ai.doc.setPeerId(BigInt(100 + writer));
    const node = children.insertContainer(writer * 7 + 1, new LoroMap());
    node.setContainer("$", new LoroMap()).set("id", `section-${writer}`);
    sections.push(node.setContainer("text", new LoroText()));
    ai.doc.commit();
  }
  for (let keystroke = 0; keystroke < 15_000; keystroke++) {
    ai.doc.setPeerId(BigInt(100 + (keystroke % 3)));
    const section = sections[keystroke % 3];
    section.insert(section.length, "abc");
    ai.doc.commit();
  }
  ai.connection.send(
    FromPeer.fromPeerUpdate({ updates: [ai.doc.export({ mode: "update" })], id: "history" }).encode(),
  );
  for (;;) {
    const message = FromRemote.decode(new Uint8Array((await ai.connection.waitForNextMessage(120_000)) as ArrayBuffer));
    if (message.isRemoteUpdateAck() && message.value.id === "history") break;
  }

  const started = performance.now();
  for (let keystroke = 0; keystroke < 300; keystroke++) {
    const version = ai.doc.oplogVersion();
    ai.doc.setPeerId(BigInt(100 + (keystroke % 3)));
    const section = sections[keystroke % 3];
    section.insert(section.length, "xyz");
    ai.doc.commit();
    ai.connection.send(
      FromPeer.fromPeerUpdate({
        updates: [ai.doc.export({ mode: "update", from: version })],
        id: `keystroke-${keystroke}`,
      }).encode(),
    );
  }
  for (;;) {
    const message = FromRemote.decode(new Uint8Array((await ai.connection.waitForNextMessage(120_000)) as ArrayBuffer));
    if (message.isRemoteUpdateAck() && message.value.id === "keystroke-299") break;
  }

  expect(performance.now() - started).toBeLessThan(CONNECT_BUDGET_MS);
}, 180_000);
