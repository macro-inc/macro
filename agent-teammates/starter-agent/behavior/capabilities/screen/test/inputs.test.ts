import { expect, test } from "bun:test";
import { invoke } from "../../../../test/invoke.ts";
import { screenModule } from "../index.ts";

/** The rules on measureScreen's input, checked before the screen is touched. */
const refuses = async (raw: unknown, message: string): Promise<void> => {
	const invoked = await invoke(
		screenModule,
		"measureScreen",
		{ screen: {} },
		raw,
	);
	expect(invoked.kind).toBe("failed");
	expect(invoked.kind === "failed" ? invoked.error : "").toContain(message);
};

test("measureScreen takes seconds above 0 up to 600, fps above 0 up to 60, and slowMs not negative", async () => {
	for (const seconds of [0, 601])
		await refuses({ seconds }, "seconds must be above 0 and at most 600");
	for (const fps of [-1, 61])
		await refuses({ fps }, "fps must be above 0 and at most 60");
	await refuses({ slowMs: -1 }, "slowMs must not be negative");
	expect(
		(
			await invoke(
				screenModule,
				"measureScreen",
				{ screen: {} },
				{ scene: "scroll" },
			)
		).kind,
	).toBe("invalid");
});
