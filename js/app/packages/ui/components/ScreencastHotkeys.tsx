import { useSubscribeToKeypress } from "@app/signal/hotkeyRoot";
import { makePersisted } from "@solid-primitives/storage";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Hotkey } from "./Hotkey";

export const [enableScreencastHotkeys, setEnableScreencastHotkeys] =
	makePersisted(createSignal(false), { name: "enableHotkeyScreencast" });

type ScreencastEntry = {
	id: number;
	shortcut: string;
	label?: string;
	count: number;
	timeout: number;
};

let entryId = 0;
const ENTRY_TTL = 3000;

export function ScreencastHotkeys() {
	const [entries, setEntries] = createSignal<ScreencastEntry[]>([]);

	useSubscribeToKeypress((ctx) => {
		if (ctx.eventType !== "keydown" || !ctx.isNonModifierKeypress) return;
		if (!ctx.commandCaptured && !ctx.pressedKeys.has("cmd")) return;
		const cmd = ctx.commandCaptured;
		const shortcut = cmd?.hotkeys?.[0] ?? ctx.pressedKeysString;
		const label = cmd
			? typeof cmd.description === "function"
				? cmd.description()
				: cmd.description
			: undefined;

		setEntries((prev) => {
			const last = prev[prev.length - 1];
			if (last && last.shortcut === shortcut) {
				window.clearTimeout(last.timeout);
				const updated = {
					...last,
					count: last.count + 1,
					timeout: window.setTimeout(() => {
						setEntries((p) => p.filter((e) => e.id !== last.id));
					}, ENTRY_TTL),
				};
				return [...prev.slice(0, -1), updated];
			}
			const id = entryId++;
			const timeout = window.setTimeout(() => {
				setEntries((p) => p.filter((e) => e.id !== id));
			}, ENTRY_TTL);
			const next = [...prev, { id, shortcut, label, count: 1, timeout }];
			if (next.length > 5) {
				const oldest = next[0];

				window.clearTimeout(oldest.timeout);
				return next.slice(-5);
			}
			return next;
		});
	});

	return (
		<Show when={enableScreencastHotkeys() && entries().length > 0}>
			<Portal>
				<div class="fixed right-3 bottom-3 z-2147483647 flex flex-col gap-1 pointer-events-none text-xs">
					<For each={entries()}>
						{(entry) => (
							<div class="flex items-center gap-2 bg-surface p-1 border border-edge rounded-md">
								<Hotkey shortcut={entry.shortcut} theme="accent" />
								<Show when={entry.count > 1}>
									<span class="text-xs font-medium text-accent">
										x{entry.count}
									</span>
								</Show>
								<span class="text-xs text-ink-muted">{entry.label}</span>
							</div>
						)}
					</For>
				</div>
			</Portal>
		</Show>
	);
}
