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
| power loss;R-6 | lifecycle::power_loss_window_reports_exact_lost_writes |

## Pending editor/session producers

The approved scope uses GenericSurface/Loro directly. `document_session`,
`lexical_model`, `lexical_loro`, and `macro_document_model` integration remains pending:
collaborative undo after a remote edit; reset-budget closure driven by a faulty editor
projection; stripping abandoned draft comment marks; restoration of editor cursors
through remote edits; real Markdown corpus paste; comment-only gate verdict parity;
editor projection/JSON equality; undo/backspace generator floors. Existing core unit
reset-budget tests do not establish faulty-editor integration.

Executor-only unit rows remain in their existing adapters/core suites: IDB abort retry
(S7:27), outage/TTL telemetry (25,33), stale connection events (61,64,71), Tauri read
errors/traceparent (77,79), and spreadsheet mount serialization (107). This native
harness does not claim browser/Tauri execution or spreadsheet adapter conformance.
