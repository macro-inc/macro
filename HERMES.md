# Connect Hermes to a Macro bot

## 1. Create the bot

In Macro, open **Settings > Bots > Create bot**. Enable **Make this bot a
coding agent**, choose its channels, and create it. Copy the bot token when it
appears; it is shown only once. If it is lost, create a new token from the
bot's settings page.

## 2. Install Hermes and macrod

Install and configure Hermes using its official setup:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes setup
hermes-acp --check
```

Download the `macrod` archive for your operating system and architecture from
the latest Macro GitHub release, extract it, and make the binary executable.

## 3. Expose macrod

`macrod` listens on port `8790` and must receive webhooks at
`POST /macro-events`. Expose it through a public HTTPS URL using your tunnel or
reverse proxy, for example `https://agent.example.com/macro-events`.

For a quick test, install
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
and run:

```bash
cloudflared tunnel --url http://localhost:8790
```

Cloudflare prints a temporary `https://....trycloudflare.com` URL. Append
`/macro-events` and use it as `public_url`. The URL changes when the process
restarts; use a
[named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/)
for a stable bot.

## 4. Configure macrod

Create `macro.toml` beside the binary:

```toml
[macro]
api_url = "https://agent-harness.macro.com"
storage_url = "https://cloud-storage.macro.com"
owner_user_id = "macro|you@example.com"
bot_token = "mbot_..."
bot_scope = "user"

[server]
port = 8790
public_url = "https://agent.example.com/macro-events"

[harness]
command = "hermes-acp"
args = []

[workspace]
path = "/absolute/path/to/your/repository"
repo_url = "https://github.com/you/your-repository"
```

Change `you@example.com` in `owner_user_id` to the email address you use to
sign in to Macro. For a team-owned bot, use `bot_scope = "team"`. Keep
`macro.toml` private because it contains the bot token.

## 5. Connect

Start the daemon from a shell where `hermes-acp` is available:

```bash
./macrod --config ./macro.toml
```

When it reports that it is listening for agent triggers, mention the bot in
one of its Macro channels. Keep both `macrod` and the public HTTPS endpoint
running while the bot is in use.
