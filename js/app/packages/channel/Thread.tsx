import IconPlus from "@icon/regular/plus.svg";

import { useThreadRepliesQuery } from "@queries/channel/thread-replies";
import type { ApiChannelMessage } from "@service-comms/client";
import {
	type Accessor,
	createSignal,
	For,
	Match,
	type Setter,
	Show,
	Suspense,
	Switch,
} from "solid-js";
import { ChannelMessage } from "./Message";

export type ThreadState = {
	isExpanded: Accessor<boolean>;
	setIsExpanded: Setter<boolean>;
};

export type ThreadProps = {
	data: Accessor<ApiChannelMessage>;
	channelId: Accessor<string>;
} & ThreadState;

const DEFAULT_REPLY_COUNT = 3;

export function Thread(props: ThreadProps) {
	const [isReplying, setIsReplying] = createSignal(false);
	const [replyContent, setReplyContent] = createSignal("");

	const thread = () => props.data().thread;
	const hasReplies = () => thread().reply_count > 0;

	const repliesQuery = useThreadRepliesQuery(
		props.channelId,
		() => props.data().id,
		() => props.data().thread.reply_count > 0,
	);

	const previewReplies = () => thread().preview.slice(0, DEFAULT_REPLY_COUNT);
	const fetchedReplies = () => repliesQuery.data ?? [];
	const moreRepliesCount = () => thread().reply_count - DEFAULT_REPLY_COUNT;

	const expand = () => {
		props.setIsExpanded(true);
	};

	const sendReply = () => {
		// TODO: wire up to postMessage with thread_id
		setReplyContent("");
		setIsReplying(false);
	};

	// Match old block-channel connector geometry:
	// outer rail at message avatar center, inner reply rail at outer + thread shift.
	const replyCenterOffsetX =
		"calc(var(--user-icon-width) / 2 + var(--body-padding))";
	const threadOffsetX =
		"calc(var(--left-of-connector) + var(--thread-shift) - var(--user-icon-width) / 2 - var(--body-padding))";
	const innerRailX = "calc(var(--left-of-connector) + var(--thread-shift))";
	const innerRailBottom = () =>
		isReplying() ? "0px" : "calc(var(--user-icon-width) / 2 + 0.5rem)";

	return (
		<div class="flex flex-col w-full">
			<ChannelMessage message={props.data()} />
			<Show when={hasReplies()}>
				<div class="relative w-full">
					<div
						class="pointer-events-none absolute"
						style={{
							left: "calc(var(--left-of-connector) - 8px)",
							top: "calc(var(--body-padding) + var(--user-icon-width) / 2 - 20px)",
							width: "calc(var(--thread-shift) + 2px)",
							height: "18px",
						}}
					>
						<div
							class="absolute text-edge-muted -z-1 w-full h-full"
							style={{
								left: "0px",
								top: "0px",
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 18"
								width="100%"
								height="100%"
							>
								<path
									stroke="currentColor"
									vector-effect="non-scaling-stroke"
									d="M0 0.5 24 17.5"
								/>
							</svg>
						</div>
					</div>
					<div
						class="pointer-events-none absolute bottom-0 border-l border-edge-muted/80"
						style={{
							left: innerRailX,
							top: "calc(var(--body-padding) + var(--user-icon-width) / 2)",
							bottom: innerRailBottom(),
						}}
					/>

					<div
						class="flex flex-col w-full pb-3"
						style={{
							"padding-left": threadOffsetX,
						}}
					>
						<For each={previewReplies()}>
							{(reply) => <ChannelMessage message={reply} />}
						</For>

						<Show when={!props.isExpanded() && moreRepliesCount() > 0}>
							<button
								type="button"
								class="text-xs text-ink-muted hover:text-ink w-fit"
								style={{
									"margin-left": replyCenterOffsetX,
								}}
								onClick={expand}
							>
								Show {moreRepliesCount()} more{" "}
								{moreRepliesCount() === 1 ? "reply" : "replies"}
							</button>
						</Show>

						<Show when={props.isExpanded()}>
							<Suspense>
								<For each={fetchedReplies()}>
									{(reply) => <ChannelMessage message={reply} />}
								</For>
							</Suspense>
						</Show>

						<Switch>
							<Match when={!isReplying()}>
								<button
									type="button"
									onClick={() => setIsReplying(true)}
									class="w-min -translate-x-1/2 icon-plus allow-css-brackets"
									style={{
										"margin-left": replyCenterOffsetX,
									}}
									aria-label="Reply"
								>
									<div class="border border-edge-muted bg-menu hover:bg-hover hover-transition-bg flex flex-row justify-center items-center ml-2 mr-2 mb-2 size-[var(--user-icon-width)] touch:min-h-[var(--user-icon-width)] touch:min-w-[var(--user-icon-width)] text-ink-muted">
										<IconPlus class="size-1/2" />
									</div>
								</button>
							</Match>
						</Switch>
					</div>
				</div>
			</Show>
		</div>
	);
}
