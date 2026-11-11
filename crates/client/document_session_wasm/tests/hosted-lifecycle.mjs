// Run with Bun and explicit source-matched wasm-bindgen JS/WASM artifact paths.
// This checks the raw lifecycle boundary, not the production Lexical facade.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as lexical from "lexical";
import {
	ABI_MAJOR,
	Access,
	SessionConfigMsg,
	Transport,
} from "../../../../packages/collaboration/src/session/abi.generated.ts";
import {
	COMPATIBILITY_SCHEMA_HASH,
	CompatBatchArgument,
	CompatBatchReply,
	CompatBatchRequest,
	CompatBatchScope,
	CompatBegin,
	CompatHostedConfig,
	CompatHostReply,
	CompatHostRequest,
	CompatHostResult,
	CompatInstanceBind,
	CompatInstanceSeed,
	CompatNativePrototype,
	CompatNodeOperand,
	CompatOperation,
	CompatReply,
	CompatRequest,
	CompatSnapshot,
	ForeignNodeKind,
	ForeignOpaqueValue,
	ForeignRenderRecord,
} from "../../../../packages/collaboration/src/session/compatibility.generated.ts";

const require = createRequire(import.meta.url);
const upstream = JSON.parse(
	readFileSync(require.resolve("lexical/package.json"), "utf8"),
);
assert.equal(upstream.version, "0.45.0");
const [jsPath, wasmPath] = process.argv.slice(2);
assert.ok(jsPath && wasmPath, "pass source-matched JS and WASM artifact paths");
const wasm = await import(pathToFileURL(jsPath).href);
wasm.initSync({ module: readFileSync(wasmPath) });
assert.equal(wasm.compatibility_schema_hash(), COMPATIBILITY_SCHEMA_HASH);

const classes = [
	[lexical.RootNode, ForeignNodeKind.Element, CompatNativePrototype.RootNode],
	[lexical.TextNode, ForeignNodeKind.Text, CompatNativePrototype.TextNode],
	[
		lexical.ParagraphNode,
		ForeignNodeKind.Element,
		CompatNativePrototype.ParagraphNode,
	],
	[
		lexical.LineBreakNode,
		ForeignNodeKind.LineBreak,
		CompatNativePrototype.LineBreakNode,
	],
	[lexical.TabNode, ForeignNodeKind.Text, CompatNativePrototype.TabNode],
];
const tokens = new WeakMap();
classes.forEach(([klass], index) => {
	tokens.set(klass, BigInt(index + 1));
});
const registration = {
	registration: {
		editorId: 1,
		classes: classes.map(([klass, kind], index) => ({
			ownerId: 1,
			classId: index + 1,
			typeName: klass.getType(),
			className: klass.name,
			kind,
			ancestry: [],
			nativeType: klass.getType(),
			hooks: 0n,
		})),
	},
	classes: classes.map(([klass, , nativePrototype], index) => ({
		classId: index + 1,
		constructorToken: tokens.get(klass),
		nativePrototype,
	})),
};
const original = Object.freeze(new lexical.RootNode());
const instances = new Map([[1, original]]);
let nextInstance = 2;
let clones = 0;
let callbackFailure;
const rootKey = { index: 0, generation: 0 };
function optional(key) {
	assert.ok(key === null || key === "root");
	return { present: key !== null, key: rootKey };
}
wasm.installCompatibilityHost((hostSlot, bytes) => {
	try {
		const request = CompatHostRequest.decode(bytes);
		assert.equal(hostSlot, 1);
		assert.equal(request.context.hostSlot, 1);
		assert.equal(request.call.discriminator, 2);
		const { stage, sourceRecord } = request.call.value;
		assert.equal(stage.source.instanceOwnerId, 1);
		assert.equal(stage.source.classId, 1);
		assert.equal(
			sourceRecord.record.captureId,
			request.delta.records[0].record.captureId,
		);
		const source = instances.get(stage.source.instanceId);
		assert.ok(source, "source instance must already be retained");
		const klass = classes[stage.source.classId - 1][0];
		assert.equal(source.constructor, klass);
		assert.equal(
			tokens.get(source.constructor),
			registration.classes[0].constructorToken,
		);
		const node = klass.clone(source);
		assert.equal(node.__key, source.__key);
		node.__key = "root";
		node.afterCloneFrom(source);
		assert.equal(node.__cachedText, null);
		const instanceId = nextInstance++;
		instances.set(instanceId, node);
		clones++;
		return CompatHostReply.encode({
			hostSlot,
			scopeId: request.context.scopeId,
			result: CompatHostResult.fromCompatHostCloneAck({
				ack: {
					stageId: stage.stageId,
					instanceOwnerId: 1,
					classId: 1,
					instanceId,
					ctorKey: stage.ctorKey,
					destinationKey: stage.destination.key,
					basePatch: {
						element: {
							format: node.__format,
							indent: node.__indent,
							direction: node.__dir === null ? 0 : node.__dir === "ltr" ? 1 : 2,
							textFormat: node.__textFormat,
							textStyle: node.__textStyle,
							style: node.__style,
						},
					},
					nativeProjection: sourceRecord.nativeProjection,
					ownFields: ForeignOpaqueValue.fromForeignMissing({}),
					observedLinks: {
						parent: optional(node.__parent),
						previous: optional(node.__prev),
						next: optional(node.__next),
						first: optional(node.__first),
						last: optional(node.__last),
						size: node.__size,
					},
				},
			}),
		}).slice();
	} catch (error) {
		callbackFailure = error;
		throw error;
	}
});
const config = SessionConfigMsg.encode({
	doc: "hosted-lifecycle-fixture",
	session: "00000000-0000-0000-0000-000000000001",
	user: "fixture-user",
	peers: [7n, 8n, 9n],
	access: Access.Edit,
	transport: Transport.None,
	durable: false,
	chatter: false,
	headless: false,
	viewEngine: 1,
	viewOs: 0,
	token: "",
	traceparent: "",
	coalesce: 25,
	snapshotInterval: 0,
	observed: [],
}).slice();
const session = wasm.EditorSession.createCompatHosted(
	ABI_MAJOR,
	config,
	0,
	0,
	CompatHostedConfig.encode(registration).slice(),
	1,
);
try {
	const initial = CompatSnapshot.decode(session.compatSnapshot(0n));
	const bound = session.compatBindInstance(
		CompatInstanceBind.encode({
			record: initial.batch.records[0].record,
			instanceOwnerId: 1,
			classId: 1,
			instanceId: 1,
		}).slice(),
	);
	// Bind returns an exact ForeignRenderRecord, not an exportJSON object.
	const root = ForeignRenderRecord.decode(bound);
	session.compatBegin(CompatBegin.encode({ tags: [] }).slice());
	const reply = CompatReply.decode(
		session.compatCall(
			CompatRequest.encode({
				operation: CompatOperation.GetWritable,
				historical: false,
				stateVersion: 0n,
				hasReceiver: true,
				receiver: root.record,
				args: [],
			}).slice(),
		),
	);
	assert.equal(clones, 1);
	assert.equal(reply.records[0].record.node.instanceId, 2);
	assert.equal(instances.get(1), original);
	assert.notEqual(instances.get(2), original);
	assert.equal(original.__cachedText, null);
	assert.equal(reply.records[0].hasRootCachedText, false);
	const old = CompatSnapshot.decode(session.compatSnapshot(0n));
	assert.equal(old.batch.records[0].record.node.instanceId, 1);
	session.compatDiscard();
	const opened = CompatBatchReply.decode(
		session.compatBatch(
			CompatBatchRequest.encode({
				scope: CompatBatchScope.fromCompatBatchBegin({
					expectedVersion: 0n,
					begin: { tags: [], reserveKeys: 2, classMaskPatches: [] },
				}),
				leases: { editorId: 1, retain: [], release: [] },
				operations: [],
				finalize: false,
				now: 1,
				wall: 1,
			}).slice(),
		),
	);
	const reservation = opened.reservations[0];
	assert.equal(reservation.keys.length, 2);
	const paragraphKey = reservation.keys[0];
	const textKey = reservation.keys[1];
	// These are real pinned constructors with real issued keys, not a second model.
	// Pinned dev constructors inspect the active registry even with explicit
	// keys. An upstream read scope supplies that registry without JS graph writes.
	const constructorEditor = lexical.createEditor();
	const { paragraph, textNode } = constructorEditor.getEditorState().read(
		() => ({
			paragraph: new lexical.ParagraphNode(String(paragraphKey.index)),
			textNode: new lexical.TextNode(
				"native constructor",
				String(textKey.index),
			),
		}),
		{ editor: constructorEditor },
	);
	assert.equal(constructorEditor.getEditorState()._nodeMap.size, 1);
	const paragraphInstance = nextInstance++;
	const textInstance = nextInstance++;
	instances.set(paragraphInstance, paragraph);
	instances.set(textInstance, textNode);
	function seed(node, classId, instanceId) {
		const base =
			node instanceof lexical.TextNode
				? {
						text: {
							text: Array.from({ length: node.__text.length }, (_, index) =>
								node.__text.charCodeAt(index),
							),
							format: node.__format,
							detail: node.__detail,
							mode: node.__mode,
							style: node.__style,
						},
					}
				: {
						element: {
							format: node.__format,
							indent: node.__indent,
							direction: node.__dir === null ? 0 : node.__dir === "ltr" ? 1 : 2,
							textFormat: node.__textFormat,
							textStyle: node.__textStyle,
							style: node.__style,
						},
					};
		return CompatInstanceSeed.fromCompatCreatedInstance({
			instanceOwnerId: 1,
			classId,
			instanceId,
			base,
			nativeProjection: {
				nativeType: node.constructor.getType(),
				complete: true,
				fields: [],
			},
			ownFields: ForeignOpaqueValue.fromForeignMissing({}),
		});
	}
	const reserved = (key) =>
		CompatNodeOperand.fromCompatReservedNode({
			reservationId: reservation.reservationId,
			key,
		});
	const noSeed = CompatInstanceSeed.fromCompatNoInstanceSeed({});
	const applied = CompatBatchReply.decode(
		session.compatBatch(
			CompatBatchRequest.encode({
				scope: CompatBatchScope.fromCompatBatchContinue({
					updateId: opened.updateId,
					expectedEpoch: opened.mutationEpoch,
				}),
				leases: { editorId: 1, retain: [], release: [] },
				finalize: false,
				now: 2,
				wall: 2,
				operations: [
					{
						operation: CompatOperation.CreateRegisteredNode,
						receiver: reserved(paragraphKey),
						args: [],
						initialInstance: seed(paragraph, 3, paragraphInstance),
					},
					{
						operation: CompatOperation.CreateRegisteredNode,
						receiver: reserved(textKey),
						args: [],
						initialInstance: seed(textNode, 2, textInstance),
					},
					{
						operation: CompatOperation.Append,
						receiver: reserved(paragraphKey),
						args: [
							CompatBatchArgument.fromCompatNodeArrayArgument({
								values: [reserved(textKey)],
							}),
						],
						initialInstance: noSeed,
					},
					{
						operation: CompatOperation.Append,
						receiver: CompatNodeOperand.fromCompatCapturedNode({
							record: root.record,
						}),
						args: [
							CompatBatchArgument.fromCompatNodeArrayArgument({
								values: [reserved(paragraphKey)],
							}),
						],
						initialInstance: noSeed,
					},
				],
			}).slice(),
		),
	);
	assert.equal(applied.outcome.discriminator, 1);
	assert.equal(applied.results.length, 4);
	const createdText = applied.delta.records.find(
		(record) => record.record.node.key.index === textKey.index,
	);
	const createdParagraph = applied.delta.records.find(
		(record) => record.record.node.key.index === paragraphKey.index,
	);
	assert.equal(createdText.record.node.instanceId, textInstance);
	assert.equal(createdParagraph.record.node.instanceId, paragraphInstance);
	assert.equal(
		String.fromCharCode(...createdText.base.text.text),
		textNode.__text,
	);
	assert.equal(instances.get(textInstance), textNode);
	assert.equal(instances.get(paragraphInstance), paragraph);
	assert.equal(
		clones,
		2,
		"only the two root COW operations invoke static clone",
	);
	session.compatDiscard();
	console.log(
		JSON.stringify({
			upstream: upstream.version,
			clones,
			constructedInstances: 2,
			sourceRetained: true,
			rootCache: null,
		}),
	);
} catch (error) {
	throw callbackFailure ?? error;
} finally {
	session.free();
	instances.clear();
}
