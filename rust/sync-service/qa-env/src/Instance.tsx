import { LoroDoc } from "loro-crdt";
import { createEffect, createResource, createSignal } from "solid-js";
import { setAllContentMap } from "./App";
import { FromRemote, FromPeer } from "../../bebop/generated/schema";
import * as jose from "jose";

async function connectToWebSocket() {
	const jwt = await new jose.SignJWT({
		user_id: "test-user",
		document_id: "test",
		access_level: "owner",
		exp: Math.floor(Date.now() / 1000) + 60,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("10y")
		.sign(new TextEncoder().encode("local"));

	return new WebSocket(
		`ws://localhost:8787/document/test/connect?token=${jwt}`,
	);
}

export function Instance(props: { id: number }) {

	const [webSocketResource] = createResource<WebSocket>(connectToWebSocket);

	let textAreaRef!: HTMLTextAreaElement;
	const loroDoc = new LoroDoc();
	const [isInitialized, setIsInitialized] = createSignal(false);
	const [content, setContent] = createSignal("");

	createEffect(() => {
		if (!isInitialized()) {
			return;
		}
		setAllContentMap((prev) => ({
			...prev,
			[props.id]: content(),
		}));
	});

	createEffect(async () => {
		webSocketResource()?.addEventListener("message", async (event) => {
			const message = event.data as Blob;
			const fromWebSocketMessage = FromRemote.decode(
				new Uint8Array(await message.arrayBuffer()),
			);

			if (fromWebSocketMessage.isRemoteInitialSync()) {
				loroDoc.import(fromWebSocketMessage.value.snapshot);
				setIsInitialized(true);
			} else if (fromWebSocketMessage.isRemoteUpdate()) {
				loroDoc.import(fromWebSocketMessage.value.update);
			}
		});
	});

	createEffect(() => {
		loroDoc.subscribeLocalUpdates((update) => {
			const toWebSocketMessage = FromPeer.fromPeerUpdate({
				update,
			});
			webSocketResource()?.send(toWebSocketMessage.encode());
		});
		loroDoc.subscribe((event) => {
			const text = loroDoc.getText("content").toString();
			setContent(text);
		});
	});

	function handleChange(event: any) {
		const newContent = event.target.value;

		const content = loroDoc.getText("content");
		content.update(newContent);
		loroDoc.commit();
	}

	return (
		<div
			class={`border w-[100] h-[100px] ${!isInitialized() ? "border-red-500" : "border-green-500"}`}
		>
			<textarea
				disabled={!isInitialized()}
				ref={textAreaRef}
				class="w-full h-full multiline text-xs"
				placeholder="Instance Name"
				value={content()}
				onInput={handleChange}
			/>
		</div>
	);
}
