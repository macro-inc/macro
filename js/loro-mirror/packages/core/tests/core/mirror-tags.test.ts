import { Mirror, SyncDirection, UpdateMetadata } from "../../src/core/mirror";
import { schema } from "../../src/schema";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

describe("Tagging", () => {
  it("should propogate tags to mirror.subscription", async () => {
    const doc = new LoroDoc();
    
    const userSchema = schema({
      user: schema.LoroMap({
        name: schema.String(),
      }),
    });

    const mirror = new Mirror({
      doc,
      schema: userSchema,
      initialState: {
        user: { name: "Initial" },
      },
    });

    let capturedMetadata: UpdateMetadata | undefined = undefined;
    
    mirror.subscribe((_, metadata) => {
      capturedMetadata = metadata;
    });

    mirror.setState(
      { user: { name: "Updated" } },
      { tags: ["test-tag", "important"] }
    );

    expect(capturedMetadata).not.toBeNull();
    expect(capturedMetadata!.direction).toBe(SyncDirection.TO_LORO);
    expect(capturedMetadata!.tags).toEqual(["test-tag", "important"]);

    mirror.dispose();
  });
});
