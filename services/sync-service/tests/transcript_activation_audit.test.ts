import { expect, test } from "vitest";
import { LoroDoc } from "loro-crdt";
import { InitializeFromSnapshotRequest } from "../../../crates/sync_protocol/bebop/generated/schema";
import { auditFixture } from "../scripts/audit-activated-transcripts.mjs";

function append(
	bytes: number[],
	callback: number,
	id: string,
	activated: boolean,
) {
	const context = { room: "room", generation: 0, callback };
	const returned = {
		...context,
		return: "storage.put",
		value: { undefined: true },
	};
	if (activated) {
		return [
			{
				...context,
				port: "storage.put",
				args: [
					{
						[`o/${id}`]: [
							0x53430001,
							{ bytes_b64: Buffer.from(bytes).toString("base64") },
						],
						[`a/${id}`]: bytes,
					},
				],
			},
			returned,
		];
	}
	return [
		{ ...context, port: "storage.put", args: [`o/${id}`, bytes] },
		returned,
		{ ...context, port: "storage.put", args: [`a/${id}`, bytes] },
		returned,
	];
}

test("activation audit proves covered duplicate removal and unchanged original payload", () => {
	const doc = new LoroDoc();
	doc.setPeerId("7");
	doc.getText("text").insert(0, "durable");
	const bytes = [...doc.export({ mode: "update" })];
	doc.free();
	const before = [
		...append(bytes, 1, "op<0>.00000000", false),
		...append(bytes, 2, "op<1>.00000000", false),
	];
	const after = append(bytes, 1, "op<0>.00000000", true);
	const result = auditFixture(before, after);
	expect(result.equal).toBe(true);
	expect(
		result.ledger.filter(
			(row) => row.reason === "duplicate-covered-before-import",
		),
	).toHaveLength(1);
	expect(
		result.ledger.filter((row) => row.reason === "removed-duplicate-write"),
	).toHaveLength(2);
	for (const mutation of [
		"payload",
		"tag",
		"extra",
		"ownership",
		"wire",
		"novel",
	]) {
		const changed = structuredClone(after);
		if (mutation === "payload") changed[0].args[0]["a/op<0>.00000000"] = [0];
		if (mutation === "tag") changed[0].args[0]["o/op<0>.00000000"][0] += 1;
		if (mutation === "extra") changed[0].value = null;
		if (mutation === "ownership") changed[1].callback = 8;
		if (mutation === "wire") changed.push({ out: "send", frame_b64: "AQ==" });
		if (mutation === "novel") changed.splice(0);
		expect(() => auditFixture(before, changed), mutation).toThrow();
	}
});

test("activation proof rejects failed durability, overlapping commits and ambiguous IDs", () => {
	const doc = new LoroDoc();
	doc.setPeerId("8");
	doc.getText("text").insert(0, "retained");
	const bytes = [...doc.export({ mode: "update" })];
	doc.free();
	const before = [
		...append(bytes, 1, "op<0>.00000000", false),
		...append(bytes, 2, "op<1>.00000000", false),
	];
	const after = append(bytes, 1, "op<0>.00000000", true);
	const failed = structuredClone(before);
	failed[1] = {
		room: "room",
		generation: 0,
		callback: 1,
		throw: "storage.put",
		error: "disk",
	};
	expect(() => auditFixture(failed, after)).toThrow();
	const overlapped = structuredClone(after);
	overlapped.splice(1, 0, {
		room: "room",
		generation: 0,
		callback: 1,
		port: "storage.put",
		args: ["unrelated", 1],
	});
	expect(() => auditFixture(before, overlapped)).toThrow();
	const reused = [
		...append(bytes, 1, "op<0>.00000000", false),
		...append(bytes, 2, "op<0>.00000000", false),
	];
	expect(() => auditFixture(reused, after)).toThrow();
	const bare = {
		room: "room",
		generation: 1,
		callback: 3,
		out: "dump",
		kv: [["op<1>.00000000", "unrelated"]],
	};
	expect(auditFixture([...before, bare], [...after, bare]).equal).toBe(true);
	const otherBefore = append(bytes, 4, "op<0>.00000000", false).map((row) => ({
		...row,
		room: "other",
	}));
	const otherAfter = append(bytes, 4, "op<0>.00000000", true).map((row) => ({
		...row,
		room: "other",
	}));
	expect(
		auditFixture([...before, ...otherBefore], [...after, ...otherAfter]).equal,
	).toBe(true);
	const cold = {
		room: "room",
		generation: 1,
		callback: 5,
		out: "dump",
		kv: [["o/op<0>.00000000", bytes]],
	};
	const coldReceipt = structuredClone(cold);
	coldReceipt.kv[0][1] = [
		0x53430001,
		{ bytes_b64: Buffer.from(bytes).toString("base64") },
	];
	expect(auditFixture([...before, cold], [...after, coldReceipt]).equal).toBe(
		true,
	);
});

test("audit preserves unrelated deletes and rejects oversized inline receipts", () => {
	const deletion = [
		{ port: "storage.delete", args: [[]] },
		{ return: "storage.delete", value: 0 },
	];
	expect(auditFixture(deletion, deletion).equal).toBe(true);
	expect(() => auditFixture(deletion, [])).toThrow();
	const arbitrary = [
		{ port: "storage.delete", args: [["unrelated"]] },
		{ return: "storage.delete", value: "0" },
	];
	expect(auditFixture(arbitrary, arbitrary).equal).toBe(true);
	expect(() =>
		auditFixture(arbitrary, [
			arbitrary[0],
			{ return: "storage.delete", value: 0 },
		]),
	).toThrow();
	const doc = new LoroDoc();
	doc.setPeerId("9");
	doc.getText("text").insert(0, "x".repeat(600000));
	const bytes = [...doc.export({ mode: "update" })];
	doc.free();
	expect(bytes.length).toBeGreaterThan(512 * 1024);
	expect(() =>
		auditFixture(
			append(bytes, 1, "op<0>.00000000", false),
			append(bytes, 1, "op<0>.00000000", true),
		),
	).toThrow();
});

test("snapshot coverage requires the successful response in the same generation", () => {
	const doc = new LoroDoc();
	doc.setPeerId("10");
	doc.getText("text").insert(0, "durable history");
	const bytes = [...doc.export({ mode: "update" })];
	const body = Buffer.from(
		InitializeFromSnapshotRequest.encode({
			snapshot: doc.export({ mode: "snapshot" }),
		}),
	).toString("base64");
	doc.free();
	const init = {
		room: "room",
		generation: 0,
		callback: 1,
		in: "fetch",
		method: "POST",
		path: "/initialize",
		body_b64: body,
	};
	const later = {
		room: "room",
		generation: 1,
		callback: 1,
		out: "response",
		status: 200,
	};
	const before = [init, later, ...append(bytes, 2, "op<0>.00000000", false)];
	expect(() => auditFixture(before, [init, later])).toThrow();
	const committed = { ...later, generation: 0 };
	expect(
		auditFixture(
			[init, committed, ...append(bytes, 2, "op<0>.00000000", false)],
			[init, committed],
		).equal,
	).toBe(true);
});
