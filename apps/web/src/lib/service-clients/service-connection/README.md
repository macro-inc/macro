# Connection service client

App-local client and generated bindings for the connection service. Install,
test, and regenerate it through `apps/web`.

`subscribeToStreamState` runs under the consuming row's Solid owner. It retains
stream-state subscriptions for mounted consumers, sends each entity once per
connection, and replays them on the gateway's first open and every reconnect.
Pending subscriptions are not socket-buffered. Multiple mounted rows share a
subscription; disposing the last consumer removes it from future replays.
The protocol has no unsubscribe frame, so remounting on the same connection
reuses its existing server subscription.
