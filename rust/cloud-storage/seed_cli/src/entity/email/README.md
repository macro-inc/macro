# Email Seed Data

Two-step workflow for populating your local Macro environment with email data.

## Prerequisites

1. Local database running (`docker-compose up -d macrodb`)
2. Environment set up (`just get_environment` from the `seed_cli` directory)
3. A FusionAuth user ID (create one with `cargo run -- user create --email you@example.com`)

## Step 1: Bulk Generate

Creates a JSON file with randomized email data (threads, messages, contacts, labels).

```bash
cargo run -- email bulk-generate \
  --user-id "<fusionauth-user-id>" \
  --email-address "you@example.com"
```

Output is written to `seed_cli/seed/emails.json`.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--user-id` | required | FusionAuth user ID |
| `--email-address` | required | Email address for the user |
| `--thread-count` | 10 | Number of threads to generate |
| `--max-messages-per-thread` | 10 | Max messages per thread (random 1..max) |
| `--inbox-other-all-split` | `0.5,0.3,0.2` | Three comma-separated floats (must sum to 1.0) controlling label distribution for inbound messages |
| `--output` | `emails.json` | Output filename |

### Inbox/Other/All split

The `--inbox-other-all-split` flag controls how inbound messages are categorized:

- **inbox** (first value): message gets `INBOX` + `CATEGORY_PERSONAL` labels
- **other** (second value): message gets `INBOX` + `CATEGORY_PROMOTIONS` labels
- **all** (third value): message gets no `INBOX` label

For example, `--inbox-other-all-split 0.6,0.2,0.2` means 60% of inbound messages land in the primary inbox, 20% in promotions, and 20% have no inbox label.

### What gets generated

- **13 system labels**: INBOX, SENT, SPAM, TRASH, UNREAD, STARRED, IMPORTANT, DRAFT, and 5 CATEGORY_* labels
- **N threads** each with a random number of messages, spread evenly from 2020 to one year ago
- **Messages** with random sender/recipients from 9 fake contacts (`fakecontact1@gmail.com` through `fakecontact9@gmail.com`)
- **Body templates** — each message references a template name from `sample_bodies/` (bodies are resolved at import time, not stored in the JSON)
- **Provider IDs** prefixed with `seed` (e.g. `seed1a2b3c4d5e6f`) on all threads and messages

## Step 2: Seed

Reads the generated JSON and inserts everything into the database.

```bash
cargo run -- email seed
```

By default reads from `seed/emails.json`. Use `--file-path` to override.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--file-path` | `seed/emails.json` | Path to the JSON file |
| `--link-id` | none | Existing email link UUID to import into (skips link creation) |
| `--concurrency` | 95 | Max concurrent database insertions |

### Using an existing link

If you already have an email link (e.g. from a previous seed or a real connected account), pass its UUID to skip link creation:

```bash
cargo run -- email seed --link-id "your-link-uuid"
```

The `user_id` and `email_address` fields in the JSON are ignored when `--link-id` is provided.

### What gets inserted

1. `email_links` — connects the user to the Gmail provider (skipped if `--link-id` is provided)
2. `email_labels` — all 13 system labels
3. For each thread: `email_threads`, `email_messages`, `email_contacts`, `email_message_recipients`, `email_message_labels`

## Sharing seed data

The generated JSON file is lightweight (bodies are template references). To share seed data with another developer:

1. Generate the file
2. Edit `user_id` and `email_address` in the JSON to match their local user
3. Send them the file to import

The `seed/` directory is gitignored by default.

## Sample bodies

Plaintext and HTML email body templates live in `sample_bodies/`. To add new ones:

1. Create matching `<name>.txt` and `<name>.html` files in `sample_bodies/`
2. Add the template name to `TEMPLATE_NAMES` in `sample_bodies.rs`
3. Add the `include_str!` entries in `load_sample_bodies()`
