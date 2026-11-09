# GenericSurface story coverage

Every integration story runs all applicable fact-based invariants and exact replay,
including raw server-port bytes. `first.rs.inc` and `second.rs.inc` contain the literal
200-edit no-echo workload. Editor-only properties are explicitly pending below.

| S8 §10 story / S7 rows | Executed coverage |
| --- | --- |
| durable crash/reopen;36,25 | durability::crash_after_durable_wal_append_delivers_on_reopen |
| lost ack;30,53 | durability::lost_ack_resends_once_and_converges_with_concurrent_edit |
| pending dependency;16,21 | durability::missed_broadcast_is_pending_then_converged_without_reset |
| chatter dependency;2,122 | chatter::chatter_dependency_survives_writer_crash |
| frozen assistance;121 | chatter::frozen_tab_rows_are_assisted_before_thaw_and_own_replay_is_idempotent; actual foreign-owner push before thaw |
| reset flush/window;11,9 | reset::reset_flushes_the_window_and_keeps_edits_made_during_reset |
| pending flag after replacement;12,16 | rebased_pending::replacement_after_late_history_clears_pending_import; full literal coverage seed8 and minimal real-Loro core regressions |
| failed reset;12 | reset::corrupt_reset_snapshot_fails_then_a_later_reset_recovers |
| corrupt local cache;39 | recovery::corrupt_local_snapshot_is_deleted_and_remote_seed_recovers |
| corrupt WAL/poison;40,122 | recovery::poison_row_is_retained_quarantined_and_later_rows_deliver; exact exemption mutations |
| cached seed races;41,42,109 | existing world cached_local_s3_and_remote_each_win_once_without_replacing_later_edits and cached_reopen_adopts_and_replays_durable_wal_after_seed_choice |
| TTL;25 | durability::ttl_expires_orphans_without_pushing_expired_rows |
| revoke/regrant;80,82 | recovery::view_token_regrant_reconnects_without_quarantine; existing revoke_parks_rows_until_writable_regrant |
| failed metadata upgrade;13,122 | faults::failed_upgrade_does_not_leave_an_unrestorable_runtime_socket and faults::failed_routed_upgrade_closes_the_accepted_server_half; real close callback before cold restore |
| directory outage;122 | faults::d1_outage_never_quarantines_and_heal_cancels_its_old_timer |
| close coalesce;99,2 | existing close_inside_the_coalesce_window_appends_before_stopped and settlement_reopens_the_only_gracefully_closed_tab_to_drain_its_wal |
| shallow rebase;42,16 | reset::offline_reopen_remote_seed_wins_and_rebases_once |
| reconnect storm;13,16 | faults::reconnect_storm_has_no_terminal_corruption |
| no echo;2,122 | chatter::two_tabs_do_not_echo_delivered_foreign_updates;200 literal edits |
| read-only gossip;3 | chatter::read_only_tab_parks_nothing_foreign |
| retained parked rows;82 | recovery::revoked_rows_remain_parked_and_durable_without_regrant |
| large paste equivalent;76,89 | durability::large_form_text_is_one_wal_row_and_multiple_wire_frames; real incompressible form text; exactly one delivered update fragment before Hibernate and another afterward |
| heartbeat;69,70 | transport::heartbeat_death_and_late_pong |
| connect blackhole;73,75 | transport::connect_timeout_closes_abandoned_socket_then_recovers |
| pending authorize;72 | transport::reconnect_while_authorizing_keeps_one_token_fetch |
| token fallback/expiry;78,74 | lifecycle::token_fallback_and_expiry_fetch_again |
| flush;96,32 | transport::flush_reports_not_drained_then_drained_after_heal |
| host error stop;99 | lifecycle::host_editor_error_stops_and_clears_presence; exercises host stop, not an editor error producer |
| form presence;104,105 | transport::form_presence_refreshes_while_idle_and_remains_saved |
| AI;108,113,114 | lifecycle::ai_worker_is_hidden_and_flush_is_loud_while_partitioned; existing ai_close_flushes_then_lingers_before_clearing |
| skew;90 | lifecycle::clock_skew_presence_keeps_the_document_safe |
| stopped-tab power loss;R-6 | lifecycle::power_loss_after_stop_exempts_only_the_row_actually_rolled_back; exact loss/wrong-profile and strict ACK mutations |
| fixed host access;3,80 | storage_capabilities::initial_read_and_comment_hosts_skip_document_edits_until_reopened_writable; rejected edits never mutate Loro |
| durable recovery capability;25,82,114 | storage_capabilities::{memory_ai_does_not_make_a_readonly_browser_a_wal_recovery_opportunity,writable_browser_recovers_parked_rows_while_memory_ai_is_present}; actual durable Tab required for browser WAL |
| receiver lifecycle expiry;104 | lifecycle::receiver_crashed_before_source_has_no_stale_live_presence_obligation; removing receiver death still fails |
| power loss;R-6 | lifecycle::power_loss_window_reports_exact_lost_writes |

## Editor session foundation

`editor_basic` exercises real DocumentSession clients, concurrent astral/combining
text, UTF-16 surrogate-boundary resolution, durable append/crash/adoption and a
headless AI peer with real model selection. Every case runs all queries and exact
replay. Negative mutations reject changed editor JSON and missing observations.
Live synced JSON and independent persisted reconstruction are compared per step
and at settlement; sharedPeerIds remains synced, only policy-local data is excluded.

`editor_undo` covers S7:48 with actual collaborative undo/redo after another peer's
edit, including astral text. Both clients retain the other writer's content; real
removed IDs feed the unchanged ownership query. A foreign-removal mutation fails
that query, and empty history emits no applied-undo fact. The session collector is
read-only and observes IDs before projection fixups, not inferred new op spans.

## Remaining M2 producers

Real document_session/lexical_model/lexical_loro editor clients are integrated.
Remaining application/editor producers: comment commands, compound source paste,
editor generation and observed undo/backspace floors. Actual faulty-editor
integration and native gate parity are covered below.

Executor-only unit rows remain in their existing adapters/core suites: IDB abort retry
(S7:27), outage/TTL telemetry (25,33), stale connection events (61,64,71), Tauri read
errors/traceparent (77,79), and spreadsheet mount serialization (107). This native
harness does not claim browser/Tauri execution or spreadsheet adapter conformance.

Storage-error causal boundary: `failed_persistence::failed_pending_write_cannot_seed_a_durably_acked_dependency`
requires actual cold-server ACK durability after a failed AI parent write and new-tab snapshot.

Read-only epoch boundaries: storage_capabilities tests retain old-user parked rows
across reopen, reject missing row/parking evidence, and enforce CommentOnly server coverage.

`confirmed_gap::confirmed_foreign_rows_above_a_parked_gap_stay_quiet` retains the
complete literal197 and checks quiet replay. The native unit
`actual_delivery_above_a_true_gap_requires_both_core_and_cold_proof` independently
removes live delivery and cold-server proof while a genuinely missing row stays parked. `revoked_memory_ai_retains_its_own_parked_edits` removes actual
parked intervals and parking metadata separately; both mutations must fail edit survival.

`gap_parent::adopted_history_with_a_server_parent_survives_cold_recovery` retains
literal414 and checks actual delivery after the server supplies an adopted row's parent.

Settlement publication boundaries: lifecycle tests cover delayed issued selections,
bounded backward clocks, and overlapping one-millisecond refreshes on direct and
routed links with deferred server callbacks. `presence_snapshot` retains literal359
and requires the first snapshot to survive later heartbeat hold restarts. `faults`
and the routed native unit complete immutable issued token failures before healing
Online, preserving the real core's pending-attempt retry policy.

`gap_push::resolved_gaps_keep_the_existing_push_contiguous` retains literal280;
server-backed gap recovery must preserve an outstanding own batch until ACK/timeout.

Affected-link settlement: `lost_update` retains literal40. Transport regressions
cover exact direct and shared-router recovery, in-flight receive loss, explicit Heal,
a no-traffic partition, lost ACKs, and an already replaced socket generation.

Presence retirement and replacement: lifecycle cases cover opposite bounded source/
receiver clocks, strict stale-key mutation, AI fixed-key death, and peer replacement
with periodic refresh disabled. `presence_replacement` retains literal259. Actual
ClockSkew facts define the signed clock spread for strict expiry deadlines.

`idle_presence::late_data_quiescence_republishes_before_observing_presence` retains
literal157: a positive receiver clock can expire the entry-time selection before
late data ACKs drain. One fixed fresh-publication phase follows preliminary idle.

- `adoption_snapshot`: full246, changed shared-snapshot cover or exact source row
  selection cannot relabel adopted WAL payloads; actual ACK/cold VV stay strict.

Account-switch workload contracts: `account_drain` runs actual old-user drainage
before switching, and rejects a real ReadOnly parked row without deleting it.
Undrained switches retain the earlier isolation coverage, not writable convergence.
The generator's explicit assertions and real regression seed remain in T0.

- `idle_orphans`: full quiet-window counterexample, fixed real Visible rescan before
  capture, exact retained row/snapshot metadata remains checked.

`quiet_adoption::delayed_orphan_adoption_drains_before_quiet` retains literal
9486392389341030173. A later snapshot write changes orphan eligibility after the
first idle scan. Settlement repeats real Visible recovery after completed durable
write progress, drains actual adoption, and preserves every strict invariant and
exact replay. Failed-adoption load retries remain core InFlight work; no additional
orphan deletion or invariant exemption is introduced.

`editor_commands`: actual typing, astral segmented backspace, range deletion,
paragraph splitting, formatting and indent/outdent through both tab and headless
sessions. Every command must produce actual own spans; both replicas' synced JSON
and independent reconstruction pass unchanged invariants and exact replay. A second
literal checks repeated backspace follows the updated cursor across astral text.
Real package block/list/table operations are covered below; comment commands and
editor generator floors remain pending.

`editor_rich`: all six block forms preserve real application replacements and
eight-character identities; all three headless list commands create TaskListNode;
table behavior composes with the application-owned registry and preserves the
requested rows/columns. Every story retains all invariants and exact replay.
Markdown paste is covered below; comment commands and generated editor
floors remain pending.

`mixed_versions::real_shipping_editor_workspace_interoperates_with_native_sessions_and_replays_exactly`
uses the actual AI worker EditingWorkspace and upstream Lexical/loro-mirror over
real SyncEngine/WAL/socket ports. Native collaborative undo preserves TS typing;
source formatting, quote conversion and table insertion converge with native synced
JSON, independent reconstruction, raw persisted Loro state and VV. All actual WAL
rows are delivered. Both outcomes and the full IPC transcript replay exactly.
Rotated local peer ranges come from update metadata, never imported VV growth.
This direct source AI host has no browser movement/undo binding; native stories
own those paths. Browser reconcile, faults/reconnect and cross-account editor
interop remain outside this literal.

`editor_cursor`: literal seed1 headless model cursor across a remote astral prefix
insertion. Keep the actual original character cursor identity, strict projection,
all invariants and twice-exact replay. Session repair uses a private model command;
the core headless view-input guard remains intact.

`editor_markdown`: each short corpus paste through real package importers in tab
and headless sessions; the >1MB incompressible fenced paste produces one actual
WAL row over900KB and multiple transport fragments. Exactly one update fragment
is delivered before Hibernate and another afterward; complete code payload, strict
projection, all invariants and exact replay remain checked. The actual shipping
TS peer imports all three short snippets independently; native/editor/raw Loro/VV/WAL
and twice-exact IPC checks remain. Compound heading-start source insertion is a
separate known upstream stale-block case and is not covered by independent literals.

`editor_drafts`: exact stored application JSON contains an abandoned draft and a
published mark. Read-only initialization renders policy-filtered state without
writes. Writable initialization removes only the abandoned wrapper through one
actual full-sync local commit, preserving all text, the published mark and
protected local state. Every invariant and exact replay remains enabled.

`editor_shortcuts`: actual source-filtered package callbacks run through conditional
model follow-ups for each character of the S8 corpus. Heading/task-list/quote
conversions and literal triple-backtick decline match the source web-plugin probe.
Ordinary Type stays literal; the shipping AI host explicitly lacks this browser
capability. Strict projection/editor/WAL/quiet checks and exact replay remain enabled.

`editor_projection_fault`: a test-only local serialization producer emits actual
canonical-but-incorrect node type changes. Receiver resync errors and imported
spans remain visible; repeated real projection recoveries exhaust the core budget.
Reopen restores strict projection checks and retained-history convergence.
Negative mutations cover configuration-only, healthy peers, incarnation identity,
missing fault receipts, unrelated import spans and unchanged convergence checks.

The editor ReadOnly ruling is exercised by
`editor_readonly::revoked_editor_retains_exact_private_rows_and_delivers_after_regrant`:
private astral text remains durable and unsaved/access-revoked without a read-only
push, then delivers automatically on write regrant. Missing, quarantined,
already-delivered, unparked and foreign-user retention cannot exempt convergence;
missing bytes cannot exempt edit loss. Own projection and acknowledged-edit
checks remain strict.

Editor-room permission checks use the real native application comment gate,
including stored editor seeds and cold durable forks. T0's `gate_parity` test
runs all20,000 real service/adversarial cases and the570 exact fail-closed
partial-import divergences. Every ledger row binds the original oracle hash,
native error, source verdict and source parse-error messages. Source-error
observation is a separate generated sidecar; original oracle rows stay byte-identical.
Comment command producers remain a separate pending item.

The seed17 workload in `editor_replay_fixup.rs` waits for initialized editors before its list commands, then covers startup WAL adoption before model attachment and complete cold-server coverage of both dependent typed characters. This ordering prevents the former extra startup repair operation. Every settlement, quiet, loss and projection query and exact replay remains enabled.

`close_termination` covers native Close for Generic/editor, tab/AI, all access
levels, Loading/Running and automatic account revocation. Missing actual replies,
wrong request correlation and absent teardown fail every_close_terminates.

`close_before_start` uses Step::Create with both real surfaces, both client kinds
and all access levels; actual reply/teardown must occur without a token or WAL append.

Startup recovery also has a real editor WAL-only literal, an all-source core matrix
and256 shrinking startup cases in `src/test/startup_adoption.rs` (owner count,
callback order, source, before/after Load and delayed callbacks).
`no_seed_over_unadopted_wal` observes exact client/session/storage correlations in
every ordinary and hostile outcome; missing/wrong callbacks and same-output
early initialization are negative controls.
