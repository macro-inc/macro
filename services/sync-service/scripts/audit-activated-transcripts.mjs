import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compare, normalize } from "./normalize-transcripts.mjs";
import { LoroDoc, decodeImportBlobMeta } from "loro-crdt";
import {
	FromRemote,
	InitializeFromSnapshotRequest,
} from "../../../crates/sync_protocol/bebop/generated/schema.ts";
const prefix = "o/!archive-status-v1/";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wire = (rows) =>
	rows.filter(
		(row) =>
			["message", "fetch", "close"].includes(row.in) ||
			[
				"accept",
				"send",
				"send_text",
				"close",
				"response",
				"fetch_body",
			].includes(row.out) ||
			row.socket_order,
	);

// The storage projection is deliberately narrower than native replay. The
// committed corpus contains successful inline atomic appends only. New plans,
// failure receipts and transactions require an explicit review, never a filter.
export function auditFixture(oldRows, rows) {
	oldRows = structuredClone(oldRows);
	rows = structuredClone(rows);
	const wireHashes = [oldRows, rows].map((stream) =>
		sha(JSON.stringify(wire(stream))),
	);
	if (wireHashes[0] !== wireHashes[1]) throw Error("wire substream changed");
	function stableIds(input) {
		const ids = new Map();
		for (const row of input) {
			const keys =
				typeof row.args?.[0] === "string"
					? [row.args[0]]
					: row.port === "storage.put" && row.args?.length === 1
						? Object.keys(row.args[0])
						: [];
			for (const key of keys) {
				const match = key.match(
					/^(?:o\/|a\/|actor\/|o\/!archive-status-v1\/)(op<\d+>\.([0-9a-f]{8}))/,
				);
				if (match && !ids.has(row.room + ":" + match[1]))
					ids.set(
						row.room + ":" + match[1],
						`operation[${row.room}:${row.generation}:${row.callback}].${match[2]}`,
					);
			}
		}
		// A persisted reference in a later generation retains its first creation.
		// IDs in unrelated rooms never share a mapping.
		const origins = new Map();
		for (const row of input) {
			if (row.port !== "storage.put") continue;
			const keys =
				typeof row.args?.[0] === "string"
					? [row.args[0]]
					: row.port === "storage.put" && row.args?.length === 1
						? Object.keys(row.args[0])
						: [];
			for (const key of keys.filter((key) => /^o\/op</.test(key))) {
				const scoped = row.room + ":" + key;
				const origin = `${row.generation}:${row.callback}`;
				if (origins.has(scoped) && origins.get(scoped) !== origin)
					throw Error("ambiguous operation ID reuse");
				origins.set(scoped, origin);
			}
		}
		const rewrite = (value, room) =>
			typeof value === "string"
				? value.replace(
						/^(o\/|a\/|actor\/|o\/!archive-status-v1\/)(op<\d+>\.[0-9a-f]{8})$/,
						(_match, namespace, id) =>
							namespace + (ids.get(room + ":" + id) ?? id),
					)
				: Array.isArray(value)
					? value.map((child) => rewrite(child, room))
					: value && typeof value === "object"
						? Object.fromEntries(
								Object.entries(value).map(([key, v]) => [
									rewrite(key, room),
									rewrite(v, room),
								]),
							)
						: value;
		return input
			.map((row) => rewrite(row, row.room))
			.map((row) => {
				if (row.out === "dump")
					for (const field of ["kv", "kv_bytes"])
						row[field]?.sort(([a], [b]) => a.localeCompare(b));
				return row;
			});
	}
	const stableOld = stableIds(oldRows),
		stableNew = stableIds(rows);
	oldRows.splice(0, oldRows.length, ...stableOld);
	rows.splice(0, rows.length, ...stableNew);
	const docs = new Map();
	const duplicateKeys = new Set();
	const duplicateRows = [];
	const document = (room) => {
		if (!docs.has(room)) docs.set(room, new LoroDoc());
		return docs.get(room);
	};
	const committed = new Map();
	const pending = new Map();
	for (const row of oldRows) {
		const context = `${row.room}:${row.generation}:${row.callback}`;
		if (row.port === "storage.put") {
			if (
				row.args?.length !== 2 ||
				typeof row.args[0] !== "string" ||
				Object.keys(row).some(
					(k) =>
						!["port", "args", "room", "callback", "generation"].includes(k),
				)
			)
				throw Error("unknown baseline put shape");
			if (pending.has(context)) throw Error("overlapping baseline put");
			pending.set(context, row);
		}
		if (row.throw === "storage.put")
			throw Error("unlisted failed baseline put");
		if (row.return === "storage.put") {
			const call = pending.get(context);
			if (
				!call ||
				JSON.stringify(row.value) !== JSON.stringify({ undefined: true }) ||
				Object.keys(row).some(
					(k) =>
						!["return", "value", "room", "callback", "generation"].includes(k),
				)
			)
				throw Error("invalid baseline put completion");
			committed.set(row, call);
			pending.delete(context);
		}
	}
	if (pending.size) throw Error("uncommitted baseline put");
	for (const row of oldRows) {
		if (row.port === "storage.deleteAll") {
			docs.get(row.room)?.free();
			docs.delete(row.room);
		}
		if (
			row.in === "fetch" &&
			row.method === "POST" &&
			row.path?.endsWith("/initialize") &&
			oldRows.some(
				(out) =>
					out.room === row.room &&
					out.callback === row.callback &&
					out.generation === row.generation &&
					out.out === "response" &&
					out.status === 200,
			)
		) {
			document(row.room).import(
				InitializeFromSnapshotRequest.decode(
					Buffer.from(row.body_b64, "base64"),
				).snapshot,
			);
		}
		if (row.out === "send" && row.payload_without_awareness_b64) {
			const message = FromRemote.decode(
				Buffer.from(row.payload_without_awareness_b64, "base64"),
			);
			if (message.isRemoteInitialSync())
				document(row.room).import(message.value.snapshot);
		}
		const call = committed.get(row);
		if (
			call &&
			typeof call.args?.[0] === "string" &&
			call.args[0].startsWith("o/") &&
			!call.args[0].startsWith("o/!")
		) {
			const bytes = new Uint8Array(call.args[1]);
			const doc = document(row.room);
			const needed = decodeImportBlobMeta(
				bytes,
				true,
			).partialEndVersionVector.toJSON();
			const known = doc.oplogVersion().toJSON();
			const duplicate = [...needed].every(
				([peer, end]) => (known.get(peer) ?? 0) >= end,
			);
			if (duplicate) {
				duplicateKeys.add(row.room + ":" + call.args[0].slice(2));
				duplicateRows.push({
					room: row.room,
					callback: row.callback,
					key: call.args[0],
					reason: "duplicate-covered-before-import",
					updateSha256: sha(bytes),
					knownVV: [...known],
					requiredVV: [...needed],
				});
			}
			doc.import(bytes);
		}
	}
	for (const doc of docs.values()) doc.free();
	const ledger = [...duplicateRows];
	const transformed = [];
	let bulk;
	const unwrap = (value) => {
		if (!Array.isArray(value) || value[0] !== 0x53430001) return value;
		if (
			value.length !== 2 ||
			!value[1] ||
			Object.keys(value[1]).join() !== "bytes_b64"
		)
			throw Error("invalid inline receipt");
		const bytes = Buffer.from(value[1].bytes_b64, "base64");
		if (
			!bytes.length ||
			bytes.length > 512 * 1024 ||
			bytes.toString("base64") !== value[1].bytes_b64
		)
			throw Error("noncanonical inline payload");
		return [...bytes];
	};
	const unwrapPairs = (pairs, item, field) =>
		pairs.map(([key, value]) => {
			const bytes =
				key.startsWith("o/") && !key.startsWith("o/!") ? unwrap(value) : value;
			if (bytes !== value)
				ledger.push({
					room: item.room,
					callback: item.callback,
					key,
					field,
					reason: "observed-inline-receipt",
					updateSha256: sha(Buffer.from(bytes)),
				});
			return [key, bytes];
		});

	for (const row of rows) {
		const item = structuredClone(row);
		if (item.port === "storage.put" && item.args?.length === 1) {
			if (bulk) throw Error("nested atomic bulk");
			const values = item.args[0];
			const keys = Object.keys(values);
			const pending = keys.filter(
				(key) => key.startsWith("o/") && !key.startsWith("o/!"),
			);
			if (pending.length !== 1) throw Error("atomic pending count");
			const key = pending[0],
				id = key.slice(2),
				archive = "a/" + id,
				actor = "actor/" + id;
			if (
				keys.some((k) => ![key, archive, actor].includes(k)) ||
				!keys.includes(archive)
			)
				throw Error("atomic key set");
			const bytes = unwrap(values[key]);
			if (JSON.stringify(bytes) !== JSON.stringify(values[archive]))
				throw Error("atomic payload mismatch");
			if (JSON.stringify(bytes) === JSON.stringify(values[key]))
				throw Error("missing atomic receipt");
			const expectedFields = ["args", "callback", "generation", "port", "room"];
			if (Object.keys(item).some((k) => !expectedFields.includes(k)))
				throw Error("unknown bulk field");
			bulk = { item, key, archive, actor, values, bytes };
			continue;
		}
		if (bulk && (item.port === "storage.put" || item.throw === "storage.put"))
			throw Error("overlapping or failed atomic bulk");
		if (bulk && item.return === "storage.put") {
			const { item: call, key, archive, actor, values, bytes } = bulk;
			if (
				item.room !== call.room ||
				item.callback !== call.callback ||
				item.generation !== call.generation ||
				JSON.stringify(item.value) !== JSON.stringify({ undefined: true })
			)
				throw Error("atomic commit mismatch");
			if (
				Object.keys(item).some(
					(k) =>
						!["return", "value", "callback", "generation", "room"].includes(k),
				)
			)
				throw Error("unknown bulk return field");
			for (const k of [key, archive, actor].filter((k) =>
				Object.hasOwn(values, k),
			)) {
				transformed.push(
					{ ...call, args: [k, k === key ? bytes : values[k]] },
					structuredClone(item),
				);
			}
			ledger.push({
				room: item.room,
				callback: item.callback,
				key,
				reason: "embedded-complete-inline",
				updateSha256: sha(Buffer.from(bytes)),
				physicalWrites: Object.keys(values).sort(),
				events: [
					{ port: call.port, keys: Object.keys(values).sort() },
					{ return: item.return, value: item.value },
				],
			});
			bulk = undefined;
			continue;
		}
		if (item.transaction !== undefined)
			throw Error("unlisted transaction in corpus");
		const statusKey = (key) =>
			typeof key === "string" && key.startsWith(prefix);
		if (statusKey(item.args?.[0])) throw Error("unlisted sidecar write");
		if (item.return === "storage.list" && Array.isArray(item.value)) {
			if (item.value.some(([key]) => statusKey(key)))
				throw Error("unlisted sidecar read");
			item.value = unwrapPairs(item.value, item, "value");
		}
		if (item.out === "dump") {
			for (const field of ["kv", "kv_bytes"])
				if (item[field]?.some(([key]) => statusKey(key)))
					throw Error("unlisted sidecar dump");
			if (item.kv) item.kv = unwrapPairs(item.kv, item, "kv");
		}
		transformed.push(item);
	}
	if (bulk) throw Error("uncommitted bulk");
	const cleanOld = [];
	const removedReturns = new Map();
	const deleteAdjust = new Map();
	const isDuplicate = (room, key) =>
		typeof key === "string" &&
		/^(o\/|a\/|actor\/)/.test(key) &&
		duplicateKeys.has(room + ":" + key.replace(/^(?:o\/|a\/|actor\/)/, ""));
	const withoutDuplicates = (pairs, item, field) =>
		pairs.filter(([key]) => {
			if (!isDuplicate(item.room, key)) return true;
			ledger.push({
				room: item.room,
				callback: item.callback,
				key,
				field,
				reason: "removed-duplicate-observation",
			});
			return false;
		});
	for (const row of oldRows) {
		const item = structuredClone(row);
		const ctx = item.room + ":" + item.callback;
		if (item.port === "storage.put") {
			const remove = isDuplicate(item.room, item.args[0]);
			removedReturns.set(ctx, remove);
			if (remove) {
				ledger.push({
					room: item.room,
					callback: item.callback,
					key: item.args[0],
					reason: "removed-duplicate-write",
					event: {
						port: item.port,
						key: item.args[0],
						updateSha256: sha(Buffer.from(item.args[1])),
					},
				});
				continue;
			}
		}
		if (item.return === "storage.put" && removedReturns.get(ctx)) {
			removedReturns.delete(ctx);
			continue;
		}
		if (item.port === "storage.delete" && Array.isArray(item.args[0])) {
			const old = item.args[0];
			item.args[0] = old.filter((key) => !isDuplicate(item.room, key));
			for (const key of old.filter((key) => isDuplicate(item.room, key)))
				ledger.push({
					room: item.room,
					callback: item.callback,
					key,
					reason: "removed-duplicate-gc",
				});
			const removed = old.length - item.args[0].length;
			if (removed) {
				const returned = oldRows
					.slice(oldRows.indexOf(row) + 1)
					.find(
						(candidate) =>
							candidate.room === row.room &&
							candidate.generation === row.generation &&
							candidate.callback === row.callback &&
							(candidate.port === "storage.delete" ||
								candidate.return === "storage.delete" ||
								candidate.throw === "storage.delete"),
					);
				if (
					!returned ||
					returned.return !== "storage.delete" ||
					returned.value !== old.length ||
					Object.keys(returned).some(
						(k) =>
							!["return", "value", "room", "callback", "generation"].includes(
								k,
							),
					)
				)
					throw Error("unproven duplicate GC completion");
				deleteAdjust.set(ctx, {
					removed,
					empty: !item.args[0].length,
				});
				if (!item.args[0].length) continue;
			}
		}
		if (item.return === "storage.delete" && deleteAdjust.has(ctx)) {
			const adjust = deleteAdjust.get(ctx);
			deleteAdjust.delete(ctx);
			if (adjust.empty) continue;
			item.value -= adjust.removed;
		}
		if (item.return === "storage.list" && Array.isArray(item.value))
			item.value = withoutDuplicates(item.value, item, "value");
		if (item.out === "dump")
			for (const field of ["kv", "kv_bytes"])
				if (item[field])
					item[field] = withoutDuplicates(item[field], item, field);
		cleanOld.push(item);
	}
	oldRows.splice(0, oldRows.length, ...cleanOld);
	const equal = JSON.stringify(oldRows) === JSON.stringify(transformed);
	const first = oldRows.findIndex(
		(row, index) => JSON.stringify(row) !== JSON.stringify(transformed[index]),
	);
	if (!equal)
		throw Error(
			`unlisted storage change at row ${first}: ${JSON.stringify({ expected: oldRows[first], actual: transformed[first] })}`,
		);
	return {
		wireSha256: wireHashes[0],
		equal,
		oldCount: oldRows.length,
		newCount: transformed.length,
		ledger,
	};
}

function paths(root) {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
		.sort();
}

export function auditCorpora(before, after) {
	const baseline = "c11b60c31907fa39fe9cb6d1fca5efc29c296b00";
	if (compare("git:" + baseline, before).length)
		throw Error("baseline is not the committed reference corpus");
	const names = paths(before);
	if (JSON.stringify(names) !== JSON.stringify(paths(after)))
		throw Error("corpus paths differ");
	const fixtures = names.map((path) => {
		const [oldRows, rows] = [before, after].map((root) =>
			normalize(readFileSync(join(root, path), "utf8").split("\n"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
		);
		return { path, ...auditFixture(oldRows, rows) };
	});
	return {
		baseline,
		count: fixtures.length,
		equal: true,
		fixtures,
	};
}

if (import.meta.main) {
	const [before, after, output] = process.argv.slice(2);
	if (!before || !after || !output)
		throw Error(
			"usage: bun audit-activated-transcripts.mjs BASELINE ACTIVATED LEDGER",
		);
	const result = auditCorpora(before, after);
	writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
	console.log(
		JSON.stringify({
			count: result.count,
			equal: true,
			changed: result.fixtures.filter((row) => row.ledger.length).length,
		}),
	);
}
