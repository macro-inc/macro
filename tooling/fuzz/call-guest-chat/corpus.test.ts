import { describe, expect, it } from "bun:test";
import { generated } from "./corpus";

describe("message corpus", () => {
  it("reproduces the same threads for a seed", () => {
    expect(generated(13, 12)).toEqual(generated(13, 12));
    expect(generated(13, 12)).not.toEqual(generated(14, 12));
  });

  it("links replies to roots and covers varied message states", () => {
    const corpus = generated(10268, 24);
    expect(corpus.threads).toHaveLength(24);
    expect(new Set(Object.values(corpus.labels ?? {}))).toEqual(
      new Set(["channel", "dm", "document", "call"]),
    );
    for (const kind of ["channel", "dm", "document", "call"]) {
      expect(
        corpus.threads.some(
          (thread) =>
            corpus.labels?.[thread.root.id] === kind &&
            thread.root.sender_id === corpus.viewerId &&
            !thread.root.deleted_at,
        ),
      ).toBe(true);
    }
    for (const thread of corpus.threads) {
      expect(thread.state.root_id).toBe(thread.root.id);
      expect(
        thread.replies.every((reply) => reply.thread_id === thread.root.id),
      ).toBe(true);
    }
    expect(corpus.threads.some((thread) => thread.root.deleted_at)).toBe(true);
    expect(corpus.threads.some((thread) => thread.root.imported_author)).toBe(
      true,
    );
    expect(corpus.threads.some((thread) => thread.root.guest_name)).toBe(true);
    expect(corpus.threads.some((thread) => thread.root.bot_profile)).toBe(true);
    expect(
      corpus.threads.some((thread) => thread.root.attachments.length),
    ).toBe(true);
  });
});
