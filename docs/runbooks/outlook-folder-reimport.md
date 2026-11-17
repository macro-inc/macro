# Outlook folder re-import

How to run `reimport_outlook_folders`
(`services/email_service/src/bin/reimport_outlook_folders`), which re-imports
Outlook folders whose first delta round was cut short, and how to watch,
pause, stop and check it.

Before folder reader revision 1, a folder's delta round stopped after the
folder's newest 100 messages and saved a deltaLink past the rest, so later
rounds never return that mail. The binary restarts those folders' delta
rounds. The email-service pubsub workers then list every message in them and
import what is missing as import work: no notifications, no new-mail events,
claimed after every live change. Mail already imported is read again and left
unchanged, and the messages a restarted folder held are rechecked so mail
deleted meanwhile is removed.

## What it does

Per link, in the order given:

1. Checks the link. It skips a link that is not Outlook, has sync off or needs
   reauthorization, is importing now, or whose folders all started their round
   at the current revision.
2. Phase 1: restarts the Inbox and Sent folders that are due, opens an import
   run ("outlook import started") and waits until the workers stamp it
   complete ("outlook import completed").
3. Phase 2: the same for every other due folder.

`CONCURRENCY` links run at once (default 1, at most 10). A link holds its slot
through both phases.

### New mail in a folder being re-read

A restarted folder has no live cursor until its fresh round reaches its
deltaLink, so everything the round lists is import work, including mail that
arrives while the folder is being listed if Graph returns it in that round:
no notification, and it waits behind the queued imports. Mail Graph returns
in the next round arrives as live mail once the listing ends. Listing takes
minutes; importing what it listed can take hours. A first connect and
Force sync behave the same way. Whether Graph puts mail that arrives
mid-round in that round or the next has not been measured yet. Other folders
of the link, and other links, keep live mail as usual.

Each folder stream records the reader revision its delta round started at
(`email_sync_streams.reader_revision`, written by the round's first page). A
folder is due while that is older than the current revision or empty. That is
how a rerun tells the folders already re-read: it skips them, skips links
still importing, and restarts only what is left. Folders whose round started
after the fix but before revisions were recorded are re-read once more.

## Before you start

- The delta fix (folder reader revision 1) and the change that records
  revisions are deployed to the environment, on the API and the pubsub
  workers.
- Folder counts are recorded: `email_mailbox_folders.total_item_count` is
  filled in by catalog discovery every 5 minutes, so wait at least that long
  after the deploy.
- `OUTLOOK_SYNC_ENABLED` is on and `OUTLOOK_IMPORTS_PAUSED` is off for the
  email-service pubsub workers.
- Note the time, for reading the logs afterwards.

Run it like the other one-off email-service binaries, with `DATABASE_URL`
pointing at the environment's primary:

```sh
# Dry run of every Outlook link: writes nothing
DATABASE_URL=… VERIFY=true \
  cargo run --release -p email_service --bin reimport_outlook_folders

# Real run of chosen links, in this order
DATABASE_URL=… LINK_IDS=<id>,<id> CONCURRENCY=1 \
  cargo run --release -p email_service --bin reimport_outlook_folders
```

`LINK_IDS` is a comma-separated list visited in exactly that order.
`ALL_LINKS=true` instead visits every Outlook link, oldest connection first. A
real run needs one of the two and refuses both, so a run with neither changes
nothing and exits saying so. A dry run without `LINK_IDS` lists every link.

## 1. Dry run

Run with `VERIFY=true`, with or without `LINK_IDS`. Nothing is written. Each
link logs "outlook folder reimport link done" with its `outcome`:

| Outcome | Meaning |
| --- | --- |
| `planned` | Due: a real run would re-import it. |
| `current` | Every folder already started its round at this revision. |
| `importing` | An import is running. Rerun after it finishes. |
| `inactive` | Sync is off or the link needs reauthorization. |
| `not_outlook` | Not an Outlook link, or no such link. |

A real run can also end a link with `reimported` (both phases settled),
`changed` (between the check and the restart an import started, the link was
reconnected, or it has no folder catalog; nothing was restarted), `interrupted`
(the link was paused, disconnected, reconnected or needs reauthorization while
a phase ran) or `failed` (a database error; the run exits non-zero and names
the links to retry).

Each link's `outlook.reimport.link` span carries
`@outlook.inbox_and_sent_streams`, `@outlook.other_folder_streams` and
`@outlook.provider_item_count` (what Graph holds across its folders). The run
ends with "outlook folder reimport finished" and the count of each outcome.

To size one link's backlog, read only:

```sql
SELECT
  (SELECT sum(total_item_count) FROM email_mailbox_folders WHERE link_id = $1 AND deleted_at IS NULL) AS at_provider,
  (SELECT count(*) FROM email_messages WHERE link_id = $1 AND provider_id IS NOT NULL) AS stored;
```

One mailbox imports at most about 20,000 to 25,000 messages an hour: the
Microsoft gate allows 3 Graph requests in flight per mailbox, and a message
takes about 2. Live work goes first, except in the folders being re-read (see
above).

## 2. Canary

Run two or three links with `LINK_IDS`, `CONCURRENCY=1` and no `VERIFY`, and
watch them through both phases before widening `LINK_IDS`, raising
`CONCURRENCY`, or moving to `ALL_LINKS=true`.

## 3. Watch it

The binary's own lines go to its terminal: "outlook folder reimport phase
started", "phase still importing" (every 5 minutes), "phase ended" (`link_id`,
`phase`, `end`, `seconds`), "link done" and "finished", plus "outlook import
started" for each phase it restarts. Its `outlook.reimport.link` and
`outlook.reimport.phase` spans reach Datadog only if it runs with the
service's telemetry export configured. Keep the terminal output. Everything
the workers do is in Datadog:

| What | Where |
| --- | --- |
| A link's import runs | Logs: "outlook import completed" with `@link_id` (the restart's "outlook import started" is in the binary's output) |
| A link's backlog | Logs: `"outlook mailbox health" @link_id:<id>`: `queued`, `parked`, `imported_5m`, `oldest_waiting_seconds` |
| Folder listing | Spans: `resource_name:outlook.sync.enumerate @mailbox.link_id:<id>`, by `@outlook.stream_id`; `@outlook.page_items` up to 100 |
| Imports | Spans: `resource_name:outlook.sync.reconcile @outlook.is_import:true` |
| Graph throttling | Spans: `@outlook.throttle_origin:graph`; the "Outlook Graph throttling" monitor |

The [Outlook sync runbook](outlook-sync.md) covers the alerts. Gate deferrals
(`gate_window`, `gate_concurrency`) on an importing mailbox are expected: the
gate is pacing it. Throttling from Graph itself, persistence failures, or a
mailbox whose live mail stops importing are reasons to pause.

## 4. Pause and resume

`OUTLOOK_IMPORTS_PAUSED=true` stops the workers claiming import work for every
Outlook mailbox; live changes keep importing. First imports of newly connected
mailboxes wait too.

1. Set `OUTLOOK_IMPORTS_PAUSED` to `true` in the email-service Doppler config
   for the environment.
2. Restart the email-service pubsub workers (a new deployment of the service).
   The switch is read at startup: it takes effect as the new tasks start,
   usually a few minutes, and the old tasks keep claiming until they stop.

While paused, folder listing goes on and queues import rows, the projection
of messages already imported goes on (including attachment downloads from
Graph), the binary keeps waiting on its current phase, and the "Outlook
mailbox sync stalled" monitor can fire for a mailbox whose only work is
import rows. To resume, set it back to `false` and restart the workers again.

## 5. Stop

Interrupt the binary. Phases already started carry on in the workers until
they finish; nothing new starts. Rerun with the same `LINK_IDS` to continue:
links still importing are skipped (`importing`) until they finish, and folders
already re-read are skipped. To stop the import work itself, pause it (step 4).

A phase that never settles (imports paused, the workers down, a folder whose
listing keeps failing) holds its slot, and the binary keeps logging "phase
still importing". To move past it, stop the binary and rerun without that
link in `LINK_IDS`. A link that ends `interrupted` or `failed` can still be
importing in the workers while the binary moves on to the next link, so more
than `CONCURRENCY` links may be importing at once.

## 6. Check a link finished

- Its "outlook folder reimport link done" line says `reimported`, and a dry run
  now says `current`.
- Per folder, what is stored should match what Graph holds (read only):

  ```sql
  SELECT f.role, f.provider_id, f.total_item_count AS at_provider, count(m.id) AS stored
  FROM email_mailbox_folders f
  LEFT JOIN email_messages m ON m.link_id = $1 AND m.provider_folder_id = f.provider_id AND m.provider_id IS NOT NULL
  WHERE f.link_id = $1 AND f.deleted_at IS NULL
  GROUP BY f.role, f.provider_id, f.total_item_count
  ORDER BY f.total_item_count DESC NULLS LAST;
  ```

  Small differences are expected: Graph counts every item in a folder, and mail
  moves while the import runs. A folder still near 100 stored against a much
  larger count did not re-import.
- `outcome` `changed` or `interrupted`: the link was reconnected, paused,
  disconnected or needs reauthorization during the run. Rerun it once it syncs
  again.

There is nothing to roll back: the imported mail is mail the first import
should have brought in. To stop the load, pause.
