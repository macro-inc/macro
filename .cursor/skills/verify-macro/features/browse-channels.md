# Browse channels

Channels lets a user browse joined conversations, open `general`, and read its seeded welcome message.

## Sub-features

- `channels-open` opens the Channels list.
- `channels-seeded-row` shows the seeded `general` channel.
- `channel-open` opens the seeded channel by its user-facing route.
- `channel-read` shows the seeded welcome message.

## How to get to it (user POV)

- Choose `Channels` in the workspace sidebar.
- Navigate directly to `/app/component/channels` or the seeded `general` route `/app/channel/00000000-0000-0000-0000-000000000001`.

## Driving it with Playwright

Preconditions:

- `localE2ESeed.smoke.generalChannel` and `generalWelcomeMessage` are present.
- The isolated app is authenticated and `[data-split-container]` is visible.

- **Open Channels and read `general`.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-smoke.spec.ts -- --grep "channels view and channel page"`.
- **Use the sidebar.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-sidebar.spec.ts -- --grep "opens Channels from the sidebar"`. Playwright clicks `[data-sidebar-link="channels"]` and requires the Channels route and list.
- **Confirm the list.** Playwright requires `[data-list-view="channels"]`, then finds the seeded channel row by `[data-entity-id]` and checks the `general` label.
- **Open the conversation.** The test navigates to `/app/channel/00000000-0000-0000-0000-000000000001?channel_message_id=00000000-0000-0000-0001-000000000001`.
- **Confirm content.** Require the exact channel name and `Welcome to the general channel everyone!`.
- **Proof.** Keep the trace showing the list, channel route, and seeded message.

## Gotchas

- Channel IDs and message IDs must come from `localE2ESeed`; do not duplicate fixture UUIDs.
- The channel list is virtualized, so reuse `expectEntityInCurrentList`.
- A channel heading without the seeded message proves only navigation, not message loading.
