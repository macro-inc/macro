# Macro call rooms

`@macro-inc/sdk-calls` connects SDK call handles to a real LiveKit room. Install
`@macro-inc/sdk` and one runtime peer: `@livekit/rtc-node` for Node or Bun, or
`livekit-client` for browsers. The core SDK grants access and issues the room
token as `CallConnection` (import it from `@macro-inc/sdk`); this package does not store or log it.

The package uses `@opentelemetry/api` for `call.sdk.*` spans. Tracing is a
no-op until the host installs an OpenTelemetry tracer provider.


## Install

The version of this package always matches the `@macro-inc/sdk` it requires.
Add the LiveKit client for your runtime:

```sh
npm install @macro-inc/sdk @macro-inc/sdk-calls @livekit/rtc-node # Node
npm install @macro-inc/sdk @macro-inc/sdk-calls livekit-client    # browser
```

## Voice agent (Node or Bun)

```ts
import { Macro } from '@macro-inc/sdk';
import { connectRoom } from '@macro-inc/sdk-calls/node';

const macro = new Macro();
const call = await macro.channels.byId(channelId).activeCall();
if (!call) throw new Error('No active call');

const { room, connection } = await connectRoom(call);
await session.start({ agent, room });

// When the room disconnects, the helper calls connection.leave() once.
// To finish explicitly:
await room.disconnect();
```

`connectRoom` also accepts a channel (`startCall`) or meeting (`join`) and
forwards `JoinOptions`. Use an agent account's own API key for a dedicated
program identity. Audio publications use Opus DTX disabled, matching the app's
quiet speech behavior. In Node, `rtc-node` has no room-wide publish default,
so `connectRoom` wraps the local participant's `publishTrack` to apply it.

## Screen share

`publishScreen` has only run against mocks. It has not published to a real
LiveKit room or been rendered by the app, so test it in a real call before
relying on it. Audio and joining are the proven parts of this path.

Node capture is supplied by your program as an async stream of fixed-size
I420 or RGBA frames. The helper publishes them as a screen share and closes
the track when the stream ends or `stop()` is called.

```ts
import { publishScreen } from '@macro-inc/sdk-calls/node';

const share = await publishScreen(room, frames, { fps: 15 });
// frames: AsyncIterable<{ data: Uint8Array; width: number; height: number;
//                         format: 'I420' | 'RGBA' }>
await share.stop();
await share.stopped;
```

In a browser, pass a `MediaStream` or omit it to open the browser's display
picker. Its audio track, when present, is published as screen-share audio.

```ts
import { publishScreen } from '@macro-inc/sdk-calls/browser';

const share = await publishScreen(room);
await share.stopped; // resolves after the picker track ends or stop() completes
```
