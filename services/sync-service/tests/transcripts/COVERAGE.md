# Golden worker transcript coverage

The inventory IDs refer to S6 revision R1, sections 1 and 5.2. Each link is a representative scenario, not a claim that every branch has a native coverage measurement. Native replay and its coverage floor start at C8.

`cargo test -p sync_service_bebop_schema` checks every inventory and quirk row has a nonempty recorded fixture. Keep the paths current when moving code or tests. Fixtures contain local test data and local JWTs signed with the test key; no hosted environment is used.

Raw JSONL preserves clock values, socket UUIDs, frame bytes and structured-clone storage. `kv_bytes` additionally applies DurableKv’s Uint8Array conversion. The normalizer checks callback-local port/output order, independent per-socket delivery order, clock count/kinds, alarm delays and exact bytes except decoded awareness timestamps. Test client entropy is seeded; worker clocks and UUIDs are not substituted.

| ID | Representative transcript |
| --- | --- |
| E1 | [hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl](hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl) |
| E2 | [transcript_boundaries.test/E2_serializes_overlapping_fetches_across_a_pending_storage_put.jsonl](transcript_boundaries.test/E2_serializes_overlapping_fetches_across_a_pending_storage_put.jsonl) |
| E3 | [cors.test/CORS_middleware_tests_should_handle_preflight_OPTIONS_requests.jsonl](cors.test/CORS_middleware_tests_should_handle_preflight_OPTIONS_requests.jsonl) |
| E4 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| E5 | [permissions.test/should_respect_permissions_should_reject_a_WebSocket_token_issued_for_a_different_document.jsonl](permissions.test/should_respect_permissions_should_reject_a_WebSocket_token_issued_for_a_different_document.jsonl) |
| E6 | [transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl](transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl) |
| E7 | [transcript_boundaries.test/E7_websocket_errors_retain_existing_awareness.jsonl](transcript_boundaries.test/E7_websocket_errors_retain_existing_awareness.jsonl) |
| C1 | [permissions.test/should_respect_permissions_should_reject_a_WebSocket_token_issued_for_a_different_document.jsonl](permissions.test/should_respect_permissions_should_reject_a_WebSocket_token_issued_for_a_different_document.jsonl) |
| C2 | [surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl](surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl) |
| C3 | [hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl](hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl) |
| C4 | [transcript_boundaries.test/C4_expired-during-connect_grants_are_accepted_before_returning_403.jsonl](transcript_boundaries.test/C4_expired-during-connect_grants_are_accepted_before_returning_403.jsonl) |
| C5 | [document_sync.test/document_sync_tests_should_receive_initial_sync_on_connect.jsonl](document_sync.test/document_sync_tests_should_receive_initial_sync_on_connect.jsonl) |
| C6 | [activity.test/keeps_lifecycle_notifications_empty_when_opening_and_closing_without_edits.jsonl](activity.test/keeps_lifecycle_notifications_empty_when_opening_and_closing_without_edits.jsonl) |
| C7 | [surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl](surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl) |
| C8 | [hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl](hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl) |
| H1 | [hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl](hibernation.test/H1_restores_the_websocket_tag_after_eviction.jsonl) |
| H2 | [hibernation.test/H2_lazily_restores_stored_websocket_metadata.jsonl](hibernation.test/H2_lazily_restores_stored_websocket_metadata.jsonl) |
| H3 | [hibernation.test/H3_filters_signed_agents_and_reserved_AI_peers_after_eviction.jsonl](hibernation.test/H3_filters_signed_agents_and_reserved_AI_peers_after_eviction.jsonl) |
| H4 | [hibernation.test/H4_restores_edit_attribution_from_signed_socket_claims.jsonl](hibernation.test/H4_restores_edit_attribution_from_signed_socket_claims.jsonl) |
| H5 | [hibernation.test/H5_restores_read-only_write_permissions_after_eviction.jsonl](hibernation.test/H5_restores_read-only_write_permissions_after_eviction.jsonl) |
| H6 | [hibernation.test/H6_restores_DOCUMENT_ID_after_eviction.jsonl](hibernation.test/H6_restores_DOCUMENT_ID_after_eviction.jsonl) |
| H7 | [hibernation.test/H7_reconstructs_storage_with_the_original_room_identity.jsonl](hibernation.test/H7_reconstructs_storage_with_the_original_room_identity.jsonl) |
| H8 | [hibernation.test/H8_loads_the_snapshot_and_replays_pending_operations.jsonl](hibernation.test/H8_loads_the_snapshot_and_replays_pending_operations.jsonl) |
| H9 | [hibernation.test/H9_preserves_the_exists_reset_and_surviving_applied-key_quirk.jsonl](hibernation.test/H9_preserves_the_exists_reset_and_surviving_applied-key_quirk.jsonl) |
| H10 | [hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl](hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl) |
| M1 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| M2 | [transcript_boundaries.test/M2_ping_fails_after_DOCUMENT_ID_is_removed.jsonl](transcript_boundaries.test/M2_ping_fails_after_DOCUMENT_ID_is_removed.jsonl) |
| M3 | [websocket.test/websocket_tests_should_respond_to_ping_with_pong.jsonl](websocket.test/websocket_tests_should_respond_to_ping_with_pong.jsonl) |
| M4 | [hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl](hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl) |
| M5 | [transcript_boundaries.test/M14_unknown_Bebop_variants_produce_no_acknowledgement.jsonl](transcript_boundaries.test/M14_unknown_Bebop_variants_produce_no_acknowledgement.jsonl) |
| M6 | [chunking.test/large_update_batches_snapshots_and_reconnects_use_bounded_wire_frames.jsonl](chunking.test/large_update_batches_snapshots_and_reconnects_use_bounded_wire_frames.jsonl) |
| M7 | [surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl](surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl) |
| M8 | [user_peer.test/user_to_peer_ID_association_tests_should_store_user_id_to_peer_id_mapping.jsonl](user_peer.test/user_to_peer_ID_association_tests_should_store_user_id_to_peer_id_mapping.jsonl) |
| M9 | [document_sync.test/document_sync_tests_changes_should_transmit_between_users.jsonl](document_sync.test/document_sync_tests_changes_should_transmit_between_users.jsonl) |
| M10 | [comment_marks.test/a_commenter_update_is_refused_when_the_check_fails.jsonl](comment_marks.test/a_commenter_update_is_refused_when_the_check_fails.jsonl) |
| M11 | [awareness.test/awareness_sync_tests_should_include_awareness_on_connection_if_available.jsonl](awareness.test/awareness_sync_tests_should_include_awareness_on_connection_if_available.jsonl) |
| M12 | [transcript_boundaries.test/M12_echoes_the_exact_request_version_vector.jsonl](transcript_boundaries.test/M12_echoes_the_exact_request_version_vector.jsonl) |
| M13 | [hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl](hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl) |
| M14 | [transcript_boundaries.test/M14_unknown_Bebop_variants_produce_no_acknowledgement.jsonl](transcript_boundaries.test/M14_unknown_Bebop_variants_produce_no_acknowledgement.jsonl) |
| M15 | [document_sync.test/document_sync_tests_changes_should_transmit_between_users.jsonl](document_sync.test/document_sync_tests_changes_should_transmit_between_users.jsonl) |
| M16 | [chunking.test/large_update_batches_snapshots_and_reconnects_use_bounded_wire_frames.jsonl](chunking.test/large_update_batches_snapshots_and_reconnects_use_bounded_wire_frames.jsonl) |
| X1 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| X2 | [delete_endpoint.test/delete_endpoint_erases_the_document_s_session_peers_and_blame_without_touching_others.jsonl](delete_endpoint.test/delete_endpoint_erases_the_document_s_session_peers_and_blame_without_touching_others.jsonl) |
| X3 | [awareness.test/awareness_sync_tests_should_broadcast_awareness_when_one_client_disconnects.jsonl](awareness.test/awareness_sync_tests_should_broadcast_awareness_when_one_client_disconnects.jsonl) |
| X4 | [activity.test/preserves_agent_subjects_and_excludes_anonymous_editors_on_last_leave.jsonl](activity.test/preserves_agent_subjects_and_excludes_anonymous_editors_on_last_leave.jsonl) |
| X5 | [delete_endpoint.test/delete_endpoint_erases_the_document_s_session_peers_and_blame_without_touching_others.jsonl](delete_endpoint.test/delete_endpoint_erases_the_document_s_session_peers_and_blame_without_touching_others.jsonl) |
| A1 | [hibernation.test/H2_lazily_restores_stored_websocket_metadata.jsonl](hibernation.test/H2_lazily_restores_stored_websocket_metadata.jsonl) |
| A2 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| A3 | [transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl](transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl) |
| A4 | [transcript_boundaries.test/A4_compaction_drops_acknowledged_pending_imports_from_the_snapshot.jsonl](transcript_boundaries.test/A4_compaction_drops_acknowledged_pending_imports_from_the_snapshot.jsonl) |
| A5 | [transcript_boundaries.test/A5_flushes_blame_but_eviction_loses_the_pending_in-memory_batch.jsonl](transcript_boundaries.test/A5_flushes_blame_but_eviction_loses_the_pending_in-memory_batch.jsonl) |
| A6 | [document_sync.test/document_sync_tests_document_state_persists_after_15_second_timeout.jsonl](document_sync.test/document_sync_tests_document_state_persists_after_15_second_timeout.jsonl) |
| A7 | [document_api.test/document_api_tests_should_properly_initialize_the_document.jsonl](document_api.test/document_api_tests_should_properly_initialize_the_document.jsonl) |
| A8 | [transcript_boundaries.test/A8_wakeup_returns_the_previous_keepalive_tuple.jsonl](transcript_boundaries.test/A8_wakeup_returns_the_previous_keepalive_tuple.jsonl) |
| R1 | [raw_endpoint.test/raw_endpoint_tests_should_return_404_for_non-existent_document.jsonl](raw_endpoint.test/raw_endpoint_tests_should_return_404_for_non-existent_document.jsonl) |
| R2 | [transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl](transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl) |
| R3 | [snapshot_endpoint.test/snapshot_endpoint_tests_rejects_malformed_snapshot_versions_without_aborting_the_session.jsonl](snapshot_endpoint.test/snapshot_endpoint_tests_rejects_malformed_snapshot_versions_without_aborting_the_session.jsonl) |
| R4 | [active_peers.test/active_peers_endpoint_tests_should_return_multiple_active_peer_IDs_for_document_with_multiple_users.jsonl](active_peers.test/active_peers_endpoint_tests_should_return_multiple_active_peer_IDs_for_document_with_multiple_users.jsonl) |
| R5 | [user_peer.test/user_to_peer_ID_association_tests_should_store_user_id_to_peer_id_mapping.jsonl](user_peer.test/user_to_peer_ID_association_tests_should_store_user_id_to_peer_id_mapping.jsonl) |
| R6 | [metadata_endpoint.test/metadata_endpoint_tests_should_return_correct_metadata_for_document_with_single_user.jsonl](metadata_endpoint.test/metadata_endpoint_tests_should_return_correct_metadata_for_document_with_single_user.jsonl) |
| R7 | [peer_attribution.test/an_agent_s_AI_peer_resolves_to_the_agent_in_metadata_and_blame.jsonl](peer_attribution.test/an_agent_s_AI_peer_resolves_to_the_agent_in_metadata_and_blame.jsonl) |
| R8 | [debug_endpoint.test/debug_endpoint_tests_should_show_KV_contents_after_multiple_operations.jsonl](debug_endpoint.test/debug_endpoint_tests_should_show_KV_contents_after_multiple_operations.jsonl) |
| R9 | [document_atomic.test/atomic_document_API_allows_one_of_two_concurrent_CAS_writes_and_preserves_the_rejected_target.jsonl](document_atomic.test/atomic_document_API_allows_one_of_two_concurrent_CAS_writes_and_preserves_the_rejected_target.jsonl) |
| R10 | [delete_endpoint.test/delete_endpoint_erases_the_document_s_session_peers_and_blame_without_touching_others.jsonl](delete_endpoint.test/delete_endpoint_erases_the_document_s_session_peers_and_blame_without_touching_others.jsonl) |
| S1 | [surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl](surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl) |
| S2 | [surface_recovery.test/pending_legacy_snapshot_resumes_only_for_the_identical_seed.jsonl](surface_recovery.test/pending_legacy_snapshot_resumes_only_for_the_identical_seed.jsonl) |
| S3 | [surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl](surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl) |
| S4 | [surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl](surface_isolation.test/pending_revoked_and_expired_sessions_fail_closed_unsupported_endpoints_stay_unavailable.jsonl) |
| S5 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| S6 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| S7 | [surface_migration.test/an_occupied_target_and_forged_revision_digest_are_not_overwritten.jsonl](surface_migration.test/an_occupied_target_and_forged_revision_digest_are_not_overwritten.jsonl) |
| S8 | [surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl](surface_migration.test/freeze_drains_acknowledged_and_racing_edits_closes_writers_and_replays_pending_logs_after_restart.jsonl) |
| S9 | [transcript_boundaries.test/S9_serves_the_exact_checked-in_wire_schema.jsonl](transcript_boundaries.test/S9_serves_the_exact_checked-in_wire_schema.jsonl) |

Q1–Q12 name the rows of S6 section 5.2 in order; that section does not assign its own IDs. Telemetry (Q9) is intentionally not compared. Clock equality (Q8) is also pinned by the normalizer unit test.

| ID | Quirk | Representative transcript |
| --- | --- | --- |
| Q1 | exists/initialize reset the operation log | [hibernation.test/H9_preserves_the_exists_reset_and_surviving_applied-key_quirk.jsonl](hibernation.test/H9_preserves_the_exists_reset_and_surviving_applied-key_quirk.jsonl) |
| Q2 | load errors produce 500 | [transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl](transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl) |
| Q3 | awareness broadcasts the full state | [awareness.test/awareness_sync_tests_should_include_awareness_on_connection_if_available.jsonl](awareness.test/awareness_sync_tests_should_include_awareness_on_connection_if_available.jsonl) |
| Q4 | socket errors keep awareness | [transcript_boundaries.test/E7_websocket_errors_retain_existing_awareness.jsonl](transcript_boundaries.test/E7_websocket_errors_retain_existing_awareness.jsonl) |
| Q5 | expired surface connect remains accepted until close | [transcript_boundaries.test/C4_expired-during-connect_grants_are_accepted_before_returning_403.jsonl](transcript_boundaries.test/C4_expired-during-connect_grants_are_accepted_before_returning_403.jsonl) |
| Q6 | failed load skips alarm rearm | [transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl](transcript_boundaries.test/A3_and_R2_corrupt_state_gives_500_and_skips_alarm_rearming.jsonl) |
| Q7 | delete keeps the in-memory mapped-peer cache | [transcript_boundaries.test/R10_deletion_retains_the_mapped-writing-peer_cache.jsonl](transcript_boundaries.test/R10_deletion_retains_the_mapped-writing-peer_cache.jsonl) |
| Q8 | monotonic save comparisons, including equal readings when observed | [document_sync.test/document_sync_tests_changes_should_transmit_between_users.jsonl](document_sync.test/document_sync_tests_changes_should_transmit_between_users.jsonl) |
| Q9 | snapshot loader frontiers logging is ignored by comparison | [hibernation.test/H8_loads_the_snapshot_and_replays_pending_operations.jsonl](hibernation.test/H8_loads_the_snapshot_and_replays_pending_operations.jsonl) |
| Q10 | ping requires restored document identity | [transcript_boundaries.test/M2_ping_fails_after_DOCUMENT_ID_is_removed.jsonl](transcript_boundaries.test/M2_ping_fails_after_DOCUMENT_ID_is_removed.jsonl) |
| Q11 | pending imports disappear at compaction | [transcript_boundaries.test/A4_compaction_drops_acknowledged_pending_imports_from_the_snapshot.jsonl](transcript_boundaries.test/A4_compaction_drops_acknowledged_pending_imports_from_the_snapshot.jsonl) |
| Q12 | eviction loses pending blame | [transcript_boundaries.test/A5_flushes_blame_but_eviction_loses_the_pending_in-memory_batch.jsonl](transcript_boundaries.test/A5_flushes_blame_but_eviction_loses_the_pending_in-memory_batch.jsonl) |
