# Draft/send and overlapping command claims

Source: [`f976aaa24a53017d04222398dd8e39bd838af945`](https://github.com/macro-inc/macro/commit/f976aaa24a53017d04222398dd8e39bd838af945), tree `d17251b2c278e6282653096c25cf3fdcd2d5dc1e`.

The companion [measurements.json](measurements.json) has SHA-256 `67df2e0cb36b222ca7eebf5da9264ff2b65bf920721657be3886843d1f69201c`. Source pins and counts below match the audited commit; the evidence is synthetic database and native-test proof only.

## Scope and method

These are synthetic local PostgreSQL 14 measurements and native Rust tests. They do not exercise a provider, SMTP delivery, a deployed stack, production data, production latency or throughput, or connected Tempo traces.

Claims are measured as the ordered window plus all per-ID acquire statements executed before a lease, Progress or budget exhaustion. Drafts and commands use one transaction and a shared reservation budget of 128 checks. Reservations can exceed the actual checks performed when EXISTS exits early; the JSON keeps actual scan loops separate. Window/acquire calls and full transaction calls are logical SQL calls, not wire round trips. The native wall measurements cover the full compiled method, including its separately awaited commit.

The matrix covers 1k/10k/100k links, Outlook and IMAP, fresh/stale statistics and forced custom/generic plans. Gates are 3,500 buffers vacuumed, 4,000 unvacuumed, at most 128 locks and at most 2x growth for matched inputs. Recovery cells that grow from 3–5 or 20 candidates to 32 compare a larger bounded population, not fixed work. Post-mass-change index reads and old-format wide commands remain explicit exceptions.

The complete baseline matrix is reused only where acquire SQL and migrations are byte-identical. Current windows are compared with the baseline in the same transaction state, checking key arrays, order, maintenance counts and plans at every scale. Any unexplained difference requires the full current matrix at that scale. Current wake, unknown-kind and receipt behavior have separate controls. The evidence records query hashes and distinguishes historical controls from current measurements.

## Findings

- **Final paired-window result:** 3,240 configuration rows × three windows = 9,720 comparisons, all identical in keys, order and maintenance counts; no unexplained differences at any scale. Window replay has no global send-time scan in either version; the historical global-scan regression below is in acquire.
- **Endpoint growth:** Endpoint growth is entirely explained by bounded maintenance/recovery population; no cell grows at fixed input. This is the steady-state 2x criterion: 221 maintenance cells and 18 recovery cells have a larger bounded work population, while 24 idle cells remain the separate dead-index exception. The additional 223 cells stay within the locked key cap; buffers per maintained row decrease (after/before 0.218–0.640), and the two additional recovery costs per key grow at most 1.272x. This does not claim literal zero page variation.
- **Current parent wake:** all 24 plans (three sizes × fresh/stale × custom/generic × first/repeat) use the command primary key with `id = indexed.command_id`, 64 loops and at most one row per lookup. No executed active-link prefix walk or sequential scan. Maximum whole-wake cost is 3,088 buffers. The same-fixture pre-fix 100k fresh generic control reproduced 194,561–194,789 buffers; the current generic plan uses 3,005–3,018. The pre-fix plan did not flip under the stale-statistics control.
- **Wake contention:** two and four overlapping SQL-session wakes clear the 96 requested heads, with no SQLSTATE error. A held subset is skipped: 56 requested heads wake, eight held heads retain their backstop; 32 other heads were outside that request. The native tests separately cover held-row settlement, crossed settlement transactions and prompt concurrent-enqueue/fenced-finish progress. A fresh four-session timing outlier is retained as unexplained timing noise, not a latency claim.
- **Scheduled sends:** the key-only schedule lookup keeps due/sent/processing tests outside LIMIT. Stats replay reproduces the earlier global send-time scan; the current acquire uses a one-row message-key lookup, with link filtering removing no rows. Pending/no-schedule, synced/no-schedule, future, sent, processing, provider and generation cases retain their expected outcomes.
- **Finite unknown-kind floor:** unsupported intents receive a 60-second local floor; future-due work remains untouched. A simulated expiry control reconsiders the unchanged intent and re-floors it. It does not edit business intent or lower real retry/lease floors.
- **Receipts:** grouped-reader oracle 96/96 and future-status controls 16/16. Pending has precedence while any chunk is unfinished, then Cancelled (including the existing unknown state), Failed, or Applied. A future unrecognized terminal status returns NULL in the SQL control and fails native receipt reading, rather than becoming Applied. Only the disposable control database relaxes the current status CHECK to simulate that future schema.
- **Native transaction wall:** current compiled source measures 24 ms for 64 draft candidates and 30 ms for 48 command candidates, including commit. These paths make 65/49 window/acquire calls and 71/55 full Outlook transaction calls. They are observations, not general upper bounds. Evaluation has a typed 15-second deadline; commit is awaited outside that timer, and transport failure at commit can remain ambiguous.

## Rollout and measured exceptions

New actions use at most 64 targets per command only after the default-off backend chunking flag is enabled. Readers deploy first; an authorized operator enables the flag during that same rollout and verifies the flag-aware writers after their refresh interval. Email-service API and message-label writers share one snapshot; GraphQL uses the same context. Agent-harness and ai_tools remain legacy writers and block removal of the wide-command allowance under `mac-imap-smtp.116`. No flag or deployment was changed here.

Old-format wide commands retain their accepted orders and are evaluated alone, then leased or locally deferred for 60 seconds. A 5,000-target flag-off command measured about 25.5k–25.6k buffers fresh; stale repeat 35,484, with a measured first-touch maximum 40,138 including 5,063 stale-seed window buffers. This cost recurs while off-format writers remain. It is not a general bound or a modern-path gate pass. A blocked wide head is not re-evaluated in intervening windows.

Mass deferral/completion and NULL-provider relabeling leave dead due-index entries. The first scan can pay heap reads; LP_DEAD hints reduce repeat heap work, while dead index-page overhead can remain until vacuum. A cold ~170k-buffer fixture was 99% garbage in its empty NULL-provider lane from stale-seed derivation. The production analogue is the one-time legacy NULL-lane drain. Four real SQL-session claimants had a maximum total 313 ms, waiters' post-lock windows were 3–17 ms, and no timeout or error occurred. These SQL-session timings are separate from the compiled native method timings above. The separate clean stale-statistics series uses exact D=5k/20k/80k changes at 100k links and fixed D=5k at 10k/50k/100k links. It measured 1,166/1,172/1,221 whole buffers for the former, with a 1,166-buffer zero-change floor, and 869/1,096/1,191 for the latter; repeats were similar. Completion selected IDs spread through the due range, so this characterizes scattered changes and does NOT measure the clean front-loaded worst case or establish worst-case dead-count scaling. VACUUM VERBOSE output was not captured. It is nonblocking characterization, not additional gate evidence.

The inherited 5,000-message receipt read costs about 20k buffers on the baseline too; grouping adds 3–5. Its custom plan can read the entire retained target relation. This per-request read is tracked separately under `mac-imap-smtp.117`, not counted as a claim-loop regression.

## Migration and write cost

The forward migration installs target-insert and parent-transition triggers before filling only targets of unfinished commands. Old writers are covered; terminal history is untouched, and nonterminal status changes do not rewrite targets. The in-flight fill is covered only by the manual isolated upgrade rehearsal: normal SQLx tests apply migrations to empty databases.

At 100k links, one million retained terminal targets and 10,129 unfinished targets, the atomic metadata transaction measured about 0.12 s, with no heap rewrite and exact live facts. Target reads and writes wait for that transaction; ordinary command reads remain open. Either blocked lock point rolls back after about five seconds. Both timers were five seconds, so the reported error was statement timeout rather than lock timeout. Fresh and isolated 2cc/e48-schema rehearsals reached 943 versions with exact ledgers and valid indexes; the kept preview and its separate ledger limitation were not changed.

Parent EXPLAIN buffers exclude AFTER-trigger SPI work. Trigger time and actual target writes are therefore reported separately: 5,000 one-target completions measured 280→610 ms, a 5,000-target completion 43.9 ms, and nonterminal transitions zero child writes. These are local synthetic observations. Hosted dev had zero unfinished targets at its authorized read; production backlog is unmeasured. A large deploy-time backlog requires withholding the atomic migration and reviewing the documented conservative-blocker/bounded-fill alternative; that alternative is not implemented here.

## Limits

No production database access, deploy, remote flag change, preview reset, real-provider or throughput claim. The unchanged local preview does not prove this batch. Historical and harness-only attempts remain labelled in the evidence; malformed fixtures are not treated as product failures. 

HOLD MERGE; no deploy.
