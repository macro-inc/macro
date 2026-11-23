/**
 * Macro's room helpers, loaded when a room is first wanted. They bring in
 * LiveKit's native library, which the agent's main process and every other
 * `bin/agent` call never need, and which logs debug lines to stdout (where a
 * capability's JSON goes) unless NODE_ENV says production before it loads.
 */
import type {
	connectRoom as ConnectRoom,
	publishScreen as PublishScreen,
} from "@macro-inc/sdk/calls/node";

const rooms = () => {
	process.env.NODE_ENV ??= "production";
	return import("@macro-inc/sdk/calls/node");
};

export const connectRoom: typeof ConnectRoom = async (target, options) =>
	(await rooms()).connectRoom(target, options);

export const publishScreen: typeof PublishScreen = async (
	room,
	frames,
	options,
) => (await rooms()).publishScreen(room, frames, options);
