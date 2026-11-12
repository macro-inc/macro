/**
 * Keeps the agent "online" in Macro. Presence is a live websocket to the
 * connection gateway, kept by a text "ping": the gateway drops a connection
 * after 60s without one. Reconnects forever, with a doubling wait.
 */
export type Socket = {
	readonly send: (data: string) => void;
	readonly isOpen: () => boolean;
	readonly onOpen: (handle: () => void) => void;
	readonly onClose: (handle: (code: number, reason: string) => void) => void;
};

const firstWait = 1_000;
const longestWait = 60_000;
const pingEvery = 25_000;

/** The wait after a drop: double, capped at a minute. */
export const nextWait = (wait: number): number =>
	Math.min(wait * 2, longestWait);

export const stayOnline = ({
	open,
	log,
	ping = pingEvery,
}: {
	/** Opens a socket to the gateway as the agent. */
	readonly open: () => Socket;
	readonly log: (entry: object) => void;
	readonly ping?: number;
}): void => {
	let wait = firstWait;
	const connect = (): void => {
		const socket = open();
		let pinging: ReturnType<typeof setInterval> | undefined;
		socket.onOpen(() => {
			wait = firstWait;
			log({ presence: "online" });
			socket.send("ping");
			pinging = setInterval(() => {
				if (socket.isOpen()) socket.send("ping");
			}, ping);
		});
		socket.onClose((code, reason) => {
			clearInterval(pinging);
			log({ presence: "offline", code, reason });
			setTimeout(connect, wait);
			wait = nextWait(wait);
		});
	};
	connect();
};
