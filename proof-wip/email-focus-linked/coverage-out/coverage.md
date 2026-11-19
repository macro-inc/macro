## Email backend coverage

144 backend functions: Gmail 1 proved, 0 claimed, 25 performed only, 117 open; Outlook 1 proved, 0 claimed, 24 performed only, 113 open; 20 deferred to the full-stack tier (6 scenarios recorded)

197 functions of email are listed; the email backend has a part in 144 (20 more are carried out by other services and deferred to the full-stack tier). A function is **proved** on a provider when a passing scenario performed it there, is recorded as checking its result, and a deliberate break in product code made that scenario fail: only that counts as covered. It is **claimed** when the scenario is recorded as checking it and no break has shown it, **performed** when scenarios did it and none is recorded as checking it.

| Functions | total | proved | claimed | performed only | waived | open |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gmail | 143 | 1 | 0 | 25 | 0 | 117 |
| Outlook | 138 | 1 | 0 | 24 | 0 | 113 |

### Entry points reached

| Kind | Gmail total | reached | waived | deferred | open | Outlook total | reached | waived | deferred | open |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| elsewhere | 9 | 0 | 0 | 0 | 9 | 9 | 0 | 0 | 0 | 9 |
| gateway | 8 | 3 | 1 | 0 | 4 | 5 | 2 | 0 | 0 | 3 |
| graphql | 32 | 3 | 4 | 0 | 25 | 32 | 3 | 4 | 0 | 25 |
| http | 73 | 5 | 9 | 0 | 59 | 65 | 5 | 6 | 0 | 54 |
| kafka | 18 | 2 | 0 | 0 | 16 | 17 | 3 | 0 | 0 | 14 |
| lambda | 5 | 0 | 0 | 0 | 5 | 4 | 0 | 0 | 0 | 4 |
| provider | 42 | 10 | 11 | 1 | 20 | 51 | 12 | 8 | 4 | 27 |
| queue | 35 | 5 | 6 | 0 | 24 | 12 | 0 | 0 | 0 | 12 |
| tool | 7 | 0 | 0 | 0 | 7 | 7 | 0 | 0 | 0 | 7 |
| webhook | 0 | 0 | 0 | 0 | 0 | 5 | 2 | 0 | 0 | 3 |

### Scenarios

| Run | scenarios | failed | flaky | seconds |
| --- | ---: | ---: | ---: | ---: |
| email-e2e | 6 | 0 | 0 | 62 |

6 scenarios left a record that counts.

**The ledger is broken (this fails the job)**

- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_linked_inbox_is_listed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_linked_inbox_is_listed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_auth two_gmail_inboxes_of_a_user_each_use_their_own_grant` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_unlinking_removes_only_that_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_auth gmail_revoked_grant_asks_for_a_reconnect_that_restores_sync` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_owner_turns_sync_off` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_relinking_an_unlinked_mailbox_imports_its_mail_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_relinking_an_unlinked_mailbox_imports_its_mail_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_owner_turns_sync_off` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_unlinking_removes_only_that_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_owner_turns_sync_off` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_unlinking_removes_only_that_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_connect signing_in_with_every_scope_records_the_calendar_grant` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_auth refresh_job_marks_a_revoked_gmail_grant_and_is_not_retried` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_health_check_tells_healthy_from_revoked` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_backfill gmail_mail_present_before_linking_is_imported` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_backfill outlook_mail_present_before_linking_is_imported` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `gmail new_mail_arrives_through_push` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion gmail_received_message_fields_come_through` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `outlook new_mail_arrives_through_sync` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion outlook_received_message_fields_come_through` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_backfill outlook_mail_arriving_mid_import_shows_before_the_import_ends` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion gmail_mail_from_an_odd_address_is_still_announced` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_parity gmail_filing_at_the_provider` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state gmail_read_state_travels_both_ways` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_parity outlook_filing_at_the_provider` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_parity outlook_flag_both_ways` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_provider gmail_mail_deleted_at_the_provider_disappears` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_provider outlook_mail_deleted_at_the_provider_disappears` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachment_documents gmail_attachment_of_a_replaced_draft_is_not_found` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion gmail_odd_recipient_does_not_cost_the_other_contacts` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion outlook_odd_addresses_do_not_cost_the_message_or_other_contacts` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_resync_brings_back_a_lost_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_resync_brings_back_a_lost_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_provider gmail_sync_recovers_from_an_expired_cursor` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_reply_joins_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_reply_joins_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search gmail_mail_is_found_by_the_parts_of_an_address` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_mail_is_found_by_the_parts_of_an_address` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules gmail_noise_rule_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_inbox_lists_only_threads_with_received_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules outlook_noise_rule_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_inbox_lists_only_threads_with_received_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists gmail_all_mail_leaves_out_spam_and_trash` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists gmail_sent_lists_mail_from_every_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists outlook_all_mail_leaves_out_spam_and_trash` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists outlook_sent_lists_mail_from_every_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists gmail_trashed_and_junk_threads_open_and_change_by_id` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists outlook_trashed_and_junk_threads_open_and_change_by_id` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists gmail_unread_filter_lists_exactly_the_unread_threads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists outlook_unread_filter_lists_exactly_the_unread_threads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_reply_reopens_a_read_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_reply_reopens_a_read_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists gmail_all_mail_leaves_out_spam_and_trash` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists gmail_other_view_pages_over_its_own_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists outlook_all_mail_leaves_out_spam_and_trash` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_lists outlook_other_view_pages_over_its_own_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_reply_reopens_a_read_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_reply_reopens_a_read_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_reply_joins_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_reply_joins_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_done_for_several_threads_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_done_for_several_threads_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists gmail_unread_filter_lists_exactly_the_unread_threads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists outlook_unread_filter_lists_exactly_the_unread_threads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search gmail_a_quoted_query_finds_the_exact_phrase` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search gmail_mail_is_found_by_the_parts_of_an_address` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_a_quoted_query_finds_the_exact_phrase` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_mail_is_found_by_the_parts_of_an_address` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_mail_is_found_by_the_parts_of_an_address` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_reply_joins_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_reply_joins_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_dateless_draft_does_not_head_the_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_dateless_draft_does_not_head_the_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading gmail_read_everything_in_a_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_rendering gmail_sanitized_html_keeps_layout_and_drops_scripts` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading outlook_read_everything_in_a_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_rendering outlook_sanitized_html_keeps_layout_and_drops_scripts` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_rendering gmail_escaped_markup_stays_text` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_rendering gmail_sanitized_html_keeps_its_shape` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_rendering outlook_sanitized_html_keeps_its_shape` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading gmail_long_thread_pages_through_every_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_threading outlook_long_thread_pages_through_every_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading gmail_read_everything_in_a_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading outlook_read_everything_in_a_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading gmail_read_receipt_records_an_open` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading outlook_read_receipt_records_an_open` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading gmail_read_receipt_records_an_open` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_reading outlook_read_receipt_records_an_open` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state gmail_read_state_travels_both_ways` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state outlook_read_state_travels_both_ways` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_archive gmail_an_archived_thread_can_be_restored` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_archive outlook_an_archived_thread_can_be_restored` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_archive gmail_an_archived_thread_can_be_restored` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_archive outlook_an_archived_thread_can_be_restored` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_labels gmail_a_star_set_in_macro_reaches_gmail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_star_trash_and_restore` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules gmail_block_and_unblock_a_sender` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules outlook_block_and_unblock_a_sender` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules gmail_noise_rule_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules outlook_noise_rule_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_done_for_several_threads_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_done_for_several_threads_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_done_for_several_threads_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_archive gmail_an_archived_thread_can_be_restored` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_done_for_several_threads_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_archive outlook_an_archived_thread_can_be_restored` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search a_personal_tag_is_in_its_owners_search_results_only` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_own_label_from_creation_to_deletion` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_own_label_from_creation_to_deletion` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_labels outlook_a_label_on_one_message_reaches_outlook` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_thread_is_filed_in_a_project` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_thread_is_filed_in_a_project` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_parity gmail_label_made_at_the_provider` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_parity outlook_label_made_at_the_provider` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup gmail_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup outlook_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup gmail_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup outlook_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup gmail_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup outlook_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_from_switch gmail_draft_moves_to_the_outlook_inbox_chosen_in_from` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_from_switch outlook_draft_moves_to_the_gmail_inbox_chosen_in_from` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts gmail_authored_html_is_sanitized` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_authored_html_is_sanitized` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_sent_html_keeps_paragraphs_and_links` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_sent_html_keeps_paragraphs_and_links` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_sent_html_keeps_paragraphs_and_links` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_sent_html_keeps_paragraphs_and_links` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_forward_from_another_inbox_keeps_attachments` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_forward_from_another_inbox_keeps_attachments` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_new_message_to_several_people_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_reply_joins_the_thread_on_both_sides` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_reply_joins_the_thread_on_both_sides` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_quoted_thread_is_sent_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_quoted_thread_is_sent_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts gmail_draft_is_saved_and_updated` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_draft_is_saved_and_updated` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts gmail_draft_is_saved_and_updated` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_draft_is_saved_and_updated` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts gmail_reply_draft_stays_in_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_reply_draft_stays_in_its_thread` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts gmail_discarded_draft_is_gone` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_discarded_draft_is_gone` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_attachment_reserved_before_its_upload_is_sent_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_attachment_reserved_before_its_upload_is_sent_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_removed_attachment_is_not_sent` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_removed_attachment_is_not_sent` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_forward_from_another_inbox_keeps_attachments` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_forward_from_another_inbox_keeps_attachments` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_calendar_attachment_is_readable_and_not_a_document` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_calendar_attachment_is_readable_and_not_a_document` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachments gmail_received_attachment_downloads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachments outlook_received_attachment_downloads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachment_documents gmail_received_attachment_becomes_a_document` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_long_attachment_name_is_cut_for_its_document` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachment_documents outlook_received_attachment_becomes_a_document` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_long_attachment_name_is_cut_for_its_document` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_composer_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sending gmail_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_composer_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sending outlook_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_reply_joins_the_thread_on_both_sides` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_writes gmail_a_thread_can_be_archived_while_a_reply_is_sending` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_undo_restores_the_draft_as_written` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_undo_within_the_window_delivers_nothing` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_undo_restores_the_draft_as_written` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_undo_within_the_window_delivers_nothing` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_composer_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_refused_send_fails_and_can_be_taken_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_composer_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_refused_send_fails_and_can_be_taken_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_refused_send_fails_and_can_be_taken_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_refused_send_fails_and_can_be_taken_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_composer_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_composer_send_reaches_the_other_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_refused_send_is_reported_as_failed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_refused_send_is_reported_as_failed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_scheduled_message_goes_out_as_committed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_scheduled_message_goes_out_as_committed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_scheduled_message_waits_for_its_time` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled gmail_scheduled_message_goes_out_as_committed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_scheduled outlook_scheduled_message_goes_out_as_committed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt gmail_sweep_delivers_a_send_whose_queue_message_was_lost` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_correspondents_and_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_signatures gmail_new_message_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_correspondents_and_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_signatures outlook_new_message_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_signatures gmail_new_message_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_signatures outlook_new_message_carries_the_signature` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_correspondents_and_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_correspondents_and_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_imported_signature_keeps_an_image_pasted_from_a_message` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_correspondents_and_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_signatures gmail_signature_follows_the_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_correspondents_and_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_signatures outlook_signature_follows_the_settings` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `calendar_identity an_invitation_card_answers_as_the_inbox_its_mail_arrived_in` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `calendar_identity an_invitation_card_answers_as_the_inbox_its_mail_arrived_in` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_connect outlook_turning_the_calendar_off` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_agent gmail_agent_drafts_then_sends_a_signed_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_agent outlook_agent_drafts_then_sends_a_signed_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools gmail_agent_reads_a_thread_in_a_second_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools outlook_agent_reads_a_thread_in_a_second_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_agent gmail_agent_drafts_then_sends_a_signed_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_agent outlook_agent_drafts_then_sends_a_signed_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools gmail_agent_reads_a_thread_in_a_second_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools outlook_agent_reads_a_thread_in_a_second_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools gmail_agent_archive_reaches_the_provider` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools outlook_agent_archive_reaches_the_provider` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_agent gmail_agent_sets_where_a_senders_mail_lands` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_agent outlook_agent_sets_where_a_senders_mail_lands` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_delegation outlook_deleting_a_delegate_removes_their_access` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_delegation outlook_deleting_a_delegate_leaves_the_owner_their_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_free_plan_allows_two_inboxes` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_free_plan_allows_two_inboxes` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_delegation outlook_a_waiting_change_survives_a_reconnect` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_linked_inbox_is_listed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_linked_inbox_is_listed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_own_label_from_creation_to_deletion` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_own_label_from_creation_to_deletion` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules gmail_block_and_unblock_a_sender` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_sender_rules outlook_block_and_unblock_a_sender` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_junk_leaves_the_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_auth outlook_revoked_grant_asks_for_a_reconnect_that_restores_sync` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_health_check_tells_healthy_from_revoked` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_auth outlook_subscription_is_renewed_when_outlook_asks` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account outlook_health_check_tells_healthy_from_revoked` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion outlook_new_mail_tells_the_open_app_to_refresh` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_ingestion outlook_draft_written_in_outlook_shows_and_follows_its_edits` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_provider outlook_missed_notifications_are_made_up_for_at_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_contacts gmail_address_book_names_the_people_the_user_writes_to` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_contacts outlook_address_book_names_the_people_the_user_writes_to` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search gmail_a_search_of_everything_finds_mail_and_the_hit_opens` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_a_search_of_everything_finds_mail_and_the_hit_opens` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search gmail_a_search_hit_names_the_message_it_matched` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_a_search_hit_names_the_message_it_matched` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `search outlook_a_personal_tag_is_in_its_owners_search_results_only` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup gmail_changed_then_removed_reminder_gives_the_thread_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup outlook_changed_then_removed_reminder_gives_the_thread_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts gmail_removed_and_moved_recipients_are_what_is_sent` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_removed_and_moved_recipients_are_what_is_sent` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery gmail_reply_to_all_reaches_everyone_but_its_sender` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_reply_to_all_reaches_everyone_but_its_sender` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments gmail_forward_arrives_with_the_original_and_its_files` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attachments outlook_forward_arrives_with_the_original_and_its_files` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer outlook_reply_from_the_composer_round_trip` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_delivery outlook_reply_joins_the_thread_on_both_sides` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `thread_sharing gmail_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `thread_sharing outlook_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `thread_sharing gmail_a_thread_shared_by_someone_else_opens` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `thread_sharing outlook_a_thread_shared_by_someone_else_opens` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_delegation gmail_a_delegate_is_told_of_new_mail_and_can_open_it` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_notifications gmail_new_mail_is_announced_to_the_notification_service` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_notifications outlook_new_mail_is_announced_to_the_notification_service` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists gmail_mail_on_home_is_listed_and_marked_done` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists outlook_mail_on_home_is_listed_and_marked_done` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm gmail_a_contacts_page_lists_the_mail_exchanged_with_them` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm outlook_a_contacts_page_lists_the_mail_exchanged_with_them` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `mail_events gmail_received_and_sent_mail_is_published_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `mail_events outlook_received_and_sent_mail_is_published_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm gmail_a_correspondent_joins_the_crm_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm gmail_a_correspondent_leaves_the_crm_with_their_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm outlook_a_correspondent_joins_the_crm_once` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachments gmail_attachment_on_a_draft_downloads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `attachments outlook_attachment_on_a_draft_downloads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_confirming_the_share_gives_both_users_the_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_confirming_the_share_gives_both_users_the_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_account gmail_health_check_tells_healthy_from_revoked` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_from_list_is_the_verified_aliases_and_follows_gmail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists gmail_choosing_an_inbox_lists_only_its_threads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `lists outlook_choosing_an_inbox_lists_only_its_threads` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_labels outlook_a_star_set_in_macro_reaches_outlook` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_not_junk_returns_to_the_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_not_junk_returns_to_the_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_a_property_set_on_a_thread_is_kept` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise outlook_a_property_set_on_a_thread_is_kept` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup gmail_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_followup outlook_remind_me_if_no_reply` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_labels gmail_a_refused_label_deletion_is_reported_until_it_goes_through` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_labels outlook_a_refused_label_deletion_is_reported_until_it_goes_through` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_junk_is_filed_under_spam` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `maintenance gmail_abandoned_sign_in_is_swept` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `maintenance outlook_abandoned_sign_in_is_swept` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_from_switch gmail_draft_written_in_gmail_and_moved_is_settled_by_keeping_the_original` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_keeping_my_version_of_a_conflicting_draft_overwrites_outlooks` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_drafts outlook_taking_outlooks_version_of_a_conflicting_draft_brings_it_into_macro` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `maintenance gmail_stored_file_of_a_discarded_draft_is_deleted` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_composer gmail_from_list_is_the_verified_aliases_and_follows_gmail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `send_attempt outlook_sweep_delivers_a_send_whose_queue_message_was_lost` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `calendar_shares gmail_a_forwarded_event_is_added_to_the_calendar_from_its_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `calendar_shares outlook_a_forwarded_event_is_added_to_the_calendar_from_its_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_connect gmail_turning_a_syncing_calendar_off_stops_googles_pushes` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking gmail_deleting_the_account_removes_its_inbox_and_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_linking outlook_deleting_the_account_removes_its_inbox_and_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `maintenance gmail_bounced_and_reported_addresses_are_suppressed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `maintenance outlook_bounced_and_reported_addresses_are_suppressed` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `calendar_shares gmail_a_forwarded_event_arrives_with_its_file` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `calendar_shares outlook_a_forwarded_event_arrives_with_its_file` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `sync_backfill gmail_a_cancelled_import_stops_reading_the_mailbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `maintenance gmail_hourly_maintenance_finds_a_revoked_grant` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `state_contacts outlook_a_contacts_photo_shows_in_macro` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `journey_organise gmail_junk_leaves_the_inbox` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `ai_tools gmail_agent_reports_spam_and_takes_it_back` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm outlook_a_correspondent_leaves_the_crm_with_their_mail` is not in the results
- crates/email_e2e/coverage/proofs.tsv: the scenario `crm outlook_a_correspondent_leaves_the_crm_with_their_mail` is not in the results

**Checks, proofs, waivers and deferrals the records do not bear out**

- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_linked_inbox_is_listed` is said to check F-001, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_linked_inbox_is_listed` is said to check F-002, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth two_gmail_inboxes_of_a_user_each_use_their_own_grant` is said to check F-004, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_unlinking_removes_only_that_inbox` is said to check F-004, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth gmail_revoked_grant_asks_for_a_reconnect_that_restores_sync` is said to check F-007, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth outlook_revoked_grant_asks_for_a_reconnect_that_restores_sync` is said to check F-007, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_owner_turns_sync_off` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_owner_turns_sync_off` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_unlinking_removes_only_that_inbox` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_unlinking_removes_only_that_inbox` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_connect signing_in_with_every_scope_records_the_calendar_grant` is said to check F-011, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_health_check_tells_healthy_from_revoked` is said to check F-012, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth refresh_job_marks_a_revoked_gmail_grant_and_is_not_retried` is said to check F-013, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_health_check_tells_healthy_from_revoked` is said to check F-014, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_health_check_tells_healthy_from_revoked` is said to check F-014, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill gmail_mail_present_before_linking_is_imported` is said to check F-016, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill outlook_mail_present_before_linking_is_imported` is said to check F-016, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `gmail new_mail_arrives_through_push` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `outlook new_mail_arrives_through_sync` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion gmail_received_message_fields_come_through` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_received_message_fields_come_through` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill outlook_mail_arriving_mid_import_shows_before_the_import_ends` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion gmail_mail_from_an_odd_address_is_still_announced` is said to check F-018, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity gmail_filing_at_the_provider` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity outlook_filing_at_the_provider` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity outlook_flag_both_ways` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state gmail_read_state_travels_both_ways` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider gmail_mail_deleted_at_the_provider_disappears` is said to check F-020, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider outlook_mail_deleted_at_the_provider_disappears` is said to check F-020, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion gmail_odd_recipient_does_not_cost_the_other_contacts` is said to check F-022, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_odd_addresses_do_not_cost_the_message_or_other_contacts` is said to check F-022, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_resync_brings_back_a_lost_thread` is said to check F-023, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_resync_brings_back_a_lost_thread` is said to check F-023, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider gmail_pushes_for_an_inbox_that_needs_reauth_are_not_synced` is said to check F-024, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider gmail_sync_recovers_from_an_expired_cursor` is said to check F-024, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_joins_its_thread` is said to check F-025, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_joins_its_thread` is said to check F-025, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_mail_is_found_by_the_parts_of_an_address` is said to check F-028, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_mail_is_found_by_the_parts_of_an_address` is said to check F-028, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_noise_rule_round_trip` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_noise_rule_round_trip` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_inbox_lists_only_threads_with_received_mail` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_inbox_lists_only_threads_with_received_mail` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_all_mail_leaves_out_spam_and_trash` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_sent_lists_mail_from_every_inbox` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_all_mail_leaves_out_spam_and_trash` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_sent_lists_mail_from_every_inbox` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_trashed_and_junk_threads_open_and_change_by_id` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_trashed_and_junk_threads_open_and_change_by_id` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_unread_filter_lists_exactly_the_unread_threads` is said to check F-034, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_unread_filter_lists_exactly_the_unread_threads` is said to check F-034, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_reopens_a_read_thread` is said to check F-035, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_reopens_a_read_thread` is said to check F-035, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_all_mail_leaves_out_spam_and_trash` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_other_view_pages_over_its_own_mail` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_all_mail_leaves_out_spam_and_trash` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_other_view_pages_over_its_own_mail` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_joins_its_thread` is said to check F-041, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_joins_its_thread` is said to check F-041, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_done_for_several_threads_at_once` is said to check F-044, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_done_for_several_threads_at_once` is said to check F-044, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_a_quoted_query_finds_the_exact_phrase` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_mail_is_found_by_the_parts_of_an_address` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_quoted_query_finds_the_exact_phrase` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_mail_is_found_by_the_parts_of_an_address` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_joins_its_thread` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_joins_its_thread` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_dateless_draft_does_not_head_the_thread` is said to check F-055, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_dateless_draft_does_not_head_the_thread` is said to check F-055, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_everything_in_a_message` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_everything_in_a_message` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering gmail_sanitized_html_keeps_layout_and_drops_scripts` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering outlook_sanitized_html_keeps_layout_and_drops_scripts` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering gmail_escaped_markup_stays_text` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering outlook_escaped_markup_stays_text` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering gmail_sanitized_html_keeps_its_shape` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering outlook_sanitized_html_keeps_its_shape` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_long_thread_pages_through_every_message` is said to check F-060, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_long_thread_pages_through_every_message` is said to check F-060, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_everything_in_a_message` is said to check F-064, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_everything_in_a_message` is said to check F-064, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_receipt_records_an_open` is said to check F-066, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_receipt_records_an_open` is said to check F-066, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_receipt_records_an_open` is said to check F-067, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_receipt_records_an_open` is said to check F-067, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state gmail_read_state_travels_both_ways` is said to check F-068, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state outlook_read_state_travels_both_ways` is said to check F-068, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-069, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-069, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-070, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-070, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive gmail_an_archived_thread_can_be_restored` is said to check F-071, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive outlook_an_archived_thread_can_be_restored` is said to check F-071, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive gmail_an_archived_thread_can_be_restored` is said to check F-072, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive outlook_an_archived_thread_can_be_restored` is said to check F-072, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-073, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-073, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels gmail_a_star_set_in_macro_reaches_gmail` is said to check F-074, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-075, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-075, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-076, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-076, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_block_and_unblock_a_sender` is said to check F-080, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_block_and_unblock_a_sender` is said to check F-080, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_noise_rule_round_trip` is said to check F-081, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_noise_rule_round_trip` is said to check F-081, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_done_for_several_threads_at_once` is said to check F-082, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_done_for_several_threads_at_once` is said to check F-082, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_done_for_several_threads_at_once` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_done_for_several_threads_at_once` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive gmail_an_archived_thread_can_be_restored` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive outlook_an_archived_thread_can_be_restored` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_own_label_from_creation_to_deletion` is said to check F-086, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_own_label_from_creation_to_deletion` is said to check F-086, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels outlook_a_label_on_one_message_reaches_outlook` is said to check F-086, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_thread_is_filed_in_a_project` is said to check F-087, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_thread_is_filed_in_a_project` is said to check F-087, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity gmail_label_made_at_the_provider` is said to check F-089, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity outlook_label_made_at_the_provider` is said to check F-089, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-090, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-090, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-093, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-093, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-094, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-094, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-097, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-097, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-099, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-099, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_from_switch gmail_draft_moves_to_the_outlook_inbox_chosen_in_from` is said to check F-100, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_from_switch outlook_draft_moves_to_the_gmail_inbox_chosen_in_from` is said to check F-100, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-101, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-101, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_authored_html_is_sanitized` is said to check F-102, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_authored_html_is_sanitized` is said to check F-102, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_reply_joins_the_thread_on_both_sides` is said to check F-108, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_reply_joins_the_thread_on_both_sides` is said to check F-108, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_draft_is_saved_and_updated` is said to check F-115, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_draft_is_saved_and_updated` is said to check F-115, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_draft_is_saved_and_updated` is said to check F-116, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_reply_draft_stays_in_its_thread` is said to check F-117, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_reply_draft_stays_in_its_thread` is said to check F-117, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_discarded_draft_is_gone` is said to check F-119, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_discarded_draft_is_gone` is said to check F-119, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_attachment_reserved_before_its_upload_is_sent_once` is said to check F-122, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_attachment_reserved_before_its_upload_is_sent_once` is said to check F-122, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_removed_attachment_is_not_sent` is said to check F-123, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_removed_attachment_is_not_sent` is said to check F-123, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_forward_from_another_inbox_keeps_attachments` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_forward_from_another_inbox_keeps_attachments` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_calendar_attachment_is_readable_and_not_a_document` is said to check F-126, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_calendar_attachment_is_readable_and_not_a_document` is said to check F-126, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments gmail_received_attachment_downloads` is said to check F-127, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments outlook_received_attachment_downloads` is said to check F-127, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachment_documents gmail_received_attachment_becomes_a_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachment_documents outlook_received_attachment_becomes_a_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_long_attachment_name_is_cut_for_its_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_long_attachment_name_is_cut_for_its_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_composer_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_composer_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sending gmail_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sending outlook_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_reply_joins_the_thread_on_both_sides` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_reply_joins_the_thread_on_both_sides` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-133, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_writes gmail_a_thread_can_be_archived_while_a_reply_is_sending` is said to check F-133, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_undo_restores_the_draft_as_written` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_undo_restores_the_draft_as_written` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_undo_within_the_window_delivers_nothing` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_undo_within_the_window_delivers_nothing` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_composer_send_reaches_the_other_mailbox` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_refused_send_fails_and_can_be_taken_back` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_composer_send_reaches_the_other_mailbox` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_refused_send_fails_and_can_be_taken_back` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_refused_send_fails_and_can_be_taken_back` is said to check F-136, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_refused_send_fails_and_can_be_taken_back` is said to check F-136, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_composer_send_reaches_the_other_mailbox` is said to check F-137, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_composer_send_reaches_the_other_mailbox` is said to check F-137, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_refused_send_is_reported_as_failed` is said to check F-140, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_refused_send_is_reported_as_failed` is said to check F-140, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_bounces gmail_a_bounce_shows_the_failure_not_the_returned_message` is said to check F-140, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-142, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-142, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-143, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-143, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-144, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-144, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_goes_out_as_committed` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_goes_out_as_committed` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_goes_out_as_committed` is said to check F-146, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_goes_out_as_committed` is said to check F-146, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_correspondents_and_settings` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_correspondents_and_settings` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures gmail_new_message_carries_the_signature` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures outlook_new_message_carries_the_signature` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_correspondents_and_settings` is said to check F-150, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_correspondents_and_settings` is said to check F-150, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_imported_signature_keeps_an_image_pasted_from_a_message` is said to check F-151, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_correspondents_and_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_correspondents_and_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures gmail_signature_follows_the_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures outlook_signature_follows_the_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_identity an_invitation_card_answers_as_the_inbox_its_mail_arrived_in` is said to check F-153, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_connect outlook_turning_the_calendar_off` is said to check F-157, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation gmail_a_delegate_is_told_of_new_mail_and_can_open_it` is said to check F-163, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent gmail_agent_drafts_then_sends_a_signed_reply` is said to check F-166, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent outlook_agent_drafts_then_sends_a_signed_reply` is said to check F-166, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_reads_a_thread_in_a_second_inbox` is said to check F-167, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_reads_a_thread_in_a_second_inbox` is said to check F-167, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent gmail_agent_drafts_then_sends_a_signed_reply` is said to check F-168, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent outlook_agent_drafts_then_sends_a_signed_reply` is said to check F-168, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_reads_a_thread_in_a_second_inbox` is said to check F-169, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_reads_a_thread_in_a_second_inbox` is said to check F-169, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_archive_reaches_the_provider` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_archive_reaches_the_provider` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent gmail_agent_sets_where_a_senders_mail_lands` is said to check F-171, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent outlook_agent_sets_where_a_senders_mail_lands` is said to check F-171, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_free_plan_allows_two_inboxes` is said to check F-174, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_free_plan_allows_two_inboxes` is said to check F-174, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_linked_inbox_is_listed` is said to check F-189, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_linked_inbox_is_listed` is said to check F-189, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_owner_turns_sync_off` is said to check F-008, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_relinking_an_unlinked_mailbox_imports_its_mail_once` is said to check F-008, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_relinking_an_unlinked_mailbox_imports_its_mail_once` is said to check F-008, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachment_documents gmail_attachment_of_a_replaced_draft_is_not_found` is said to check F-021, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_reopens_a_read_thread` is said to check F-037, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_reopens_a_read_thread` is said to check F-037, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_unread_filter_lists_exactly_the_unread_threads` is said to check F-046, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_unread_filter_lists_exactly_the_unread_threads` is said to check F-046, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_mail_is_found_by_the_parts_of_an_address` is said to check F-051, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search a_personal_tag_is_in_its_owners_search_results_only` is said to check F-084, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_sent_html_keeps_paragraphs_and_links` is said to check F-103, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_sent_html_keeps_paragraphs_and_links` is said to check F-103, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_sent_html_keeps_paragraphs_and_links` is said to check F-104, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_sent_html_keeps_paragraphs_and_links` is said to check F-104, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_forward_from_another_inbox_keeps_attachments` is said to check F-105, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_forward_from_another_inbox_keeps_attachments` is said to check F-105, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-107, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-107, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_quoted_thread_is_sent_once` is said to check F-111, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_quoted_thread_is_sent_once` is said to check F-111, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_draft_is_saved_and_updated` is said to check F-116, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-133, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_sweep_delivers_a_send_whose_queue_message_was_lost` is said to check F-147, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures gmail_new_message_carries_the_signature` is said to check F-149, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures outlook_new_message_carries_the_signature` is said to check F-149, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation outlook_deleting_a_delegate_removes_their_access` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation outlook_deleting_a_delegate_leaves_the_owner_their_inbox` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation outlook_a_waiting_change_survives_a_reconnect` is said to check F-180, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_own_label_from_creation_to_deletion` is said to check F-193, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_own_label_from_creation_to_deletion` is said to check F-193, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_block_and_unblock_a_sender` is said to check F-196, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_block_and_unblock_a_sender` is said to check F-196, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_junk_leaves_the_inbox` is said to check F-197, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth outlook_subscription_is_renewed_when_outlook_asks` is said to check F-013, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_new_mail_tells_the_open_app_to_refresh` is said to check F-018, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_draft_written_in_outlook_shows_and_follows_its_edits` is said to check F-021, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider outlook_missed_notifications_are_made_up_for_at_once` is said to check F-024, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_contacts gmail_address_book_names_the_people_the_user_writes_to` is said to check F-026, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_contacts outlook_address_book_names_the_people_the_user_writes_to` is said to check F-026, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_a_search_of_everything_finds_mail_and_the_hit_opens` is said to check F-051, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_search_of_everything_finds_mail_and_the_hit_opens` is said to check F-051, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_a_search_hit_names_the_message_it_matched` is said to check F-052, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_search_hit_names_the_message_it_matched` is said to check F-052, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_personal_tag_is_in_its_owners_search_results_only` is said to check F-084, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_changed_then_removed_reminder_gives_the_thread_back` is said to check F-091, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_changed_then_removed_reminder_gives_the_thread_back` is said to check F-091, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_removed_and_moved_recipients_are_what_is_sent` is said to check F-098, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_removed_and_moved_recipients_are_what_is_sent` is said to check F-098, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_reply_to_all_reaches_everyone_but_its_sender` is said to check F-109, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_reply_to_all_reaches_everyone_but_its_sender` is said to check F-109, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_forward_arrives_with_the_original_and_its_files` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_forward_arrives_with_the_original_and_its_files` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing gmail_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox` is said to check F-141, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing outlook_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox` is said to check F-141, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing gmail_a_thread_shared_by_someone_else_opens` is said to check F-159, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing outlook_a_thread_shared_by_someone_else_opens` is said to check F-159, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_notifications gmail_new_mail_is_announced_to_the_notification_service` is said to check F-163, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_notifications outlook_new_mail_is_announced_to_the_notification_service` is said to check F-163, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_mail_on_home_is_listed_and_marked_done` is said to check F-164, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_mail_on_home_is_listed_and_marked_done` is said to check F-164, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm gmail_a_contacts_page_lists_the_mail_exchanged_with_them` is said to check F-165, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm outlook_a_contacts_page_lists_the_mail_exchanged_with_them` is said to check F-165, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `mail_events gmail_received_and_sent_mail_is_published_once` is said to check F-175, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `mail_events outlook_received_and_sent_mail_is_published_once` is said to check F-175, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm gmail_a_correspondent_joins_the_crm_once` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm gmail_a_correspondent_leaves_the_crm_with_their_mail` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm outlook_a_correspondent_joins_the_crm_once` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `email_policy gmail_replaced_policy_history_is_generation_bound` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `email_policy outlook_replaced_policy_history_is_generation_bound` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments gmail_attachment_on_a_draft_downloads` is said to check F-185, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments outlook_attachment_on_a_draft_downloads` is said to check F-185, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_confirming_the_share_gives_both_users_the_inbox` is said to check F-005, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_confirming_the_share_gives_both_users_the_inbox` is said to check F-005, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_health_check_tells_healthy_from_revoked` is said to check F-012, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_from_list_is_the_verified_aliases_and_follows_gmail` is said to check F-015, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_choosing_an_inbox_lists_only_its_threads` is said to check F-033, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_choosing_an_inbox_lists_only_its_threads` is said to check F-033, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels outlook_a_star_set_in_macro_reaches_outlook` is said to check F-074, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_not_junk_returns_to_the_inbox` is said to check F-078, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_not_junk_returns_to_the_inbox` is said to check F-078, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_a_property_set_on_a_thread_is_kept` is said to check F-088, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_a_property_set_on_a_thread_is_kept` is said to check F-088, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-092, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-092, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels gmail_a_refused_label_deletion_is_reported_until_it_goes_through` is said to check F-180, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels outlook_a_refused_label_deletion_is_reported_until_it_goes_through` is said to check F-180, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_junk_is_filed_under_spam` is said to check F-197, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance gmail_abandoned_sign_in_is_swept` is said to check F-006, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance outlook_abandoned_sign_in_is_swept` is said to check F-006, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_keeping_my_version_of_a_conflicting_draft_overwrites_outlooks` is said to check F-120, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_taking_outlooks_version_of_a_conflicting_draft_brings_it_into_macro` is said to check F-120, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_from_switch gmail_draft_written_in_gmail_and_moved_is_settled_by_keeping_the_original` is said to check F-120, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_from_list_is_the_verified_aliases_and_follows_gmail` is said to check F-138, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_sweep_delivers_a_send_whose_queue_message_was_lost` is said to check F-147, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares gmail_a_forwarded_event_is_added_to_the_calendar_from_its_mail` is said to check F-156, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares outlook_a_forwarded_event_is_added_to_the_calendar_from_its_mail` is said to check F-156, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_connect gmail_turning_a_syncing_calendar_off_stops_googles_pushes` is said to check F-157, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_deleting_the_account_removes_its_inbox_and_mail` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_deleting_the_account_removes_its_inbox_and_mail` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance gmail_bounced_and_reported_addresses_are_suppressed` is said to check F-173, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance outlook_bounced_and_reported_addresses_are_suppressed` is said to check F-173, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares gmail_a_forwarded_event_arrives_with_its_file` is said to check F-194, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares outlook_a_forwarded_event_arrives_with_its_file` is said to check F-194, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill gmail_a_cancelled_import_stops_reading_the_mailbox` is said to check F-195, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance gmail_hourly_maintenance_finds_a_revoked_grant` is said to check F-012, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_contacts outlook_a_contacts_photo_shows_in_macro` is said to check F-026, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_junk_leaves_the_inbox` is said to check F-197, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_reports_spam_and_takes_it_back` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_reports_spam_and_takes_it_back` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm outlook_a_correspondent_leaves_the_crm_with_their_mail` is said to check F-176, and no record shows it performing the function

**Gaps (each fails the job under --enforce)**

- function F-001 (Connect a Gmail inbox) is not proved on gmail: scenarios perform it and none is said to check it
- function F-002 (Connect an Outlook inbox) is not proved on outlook: scenarios perform it and none is said to check it
- function F-004 (Connect a second inbox to the same account) is not proved on gmail: scenarios perform it and none is said to check it
- function F-004 (Connect a second inbox to the same account) is not proved on outlook: scenarios perform it and none is said to check it
- function F-005 (Share an inbox another user already connected) is not proved on gmail: no scenario performs it
- function F-005 (Share an inbox another user already connected) is not proved on outlook: no scenario performs it
- function F-006 (Cancel or fail the provider consent and return to the app) is not proved on gmail: no scenario performs it
- function F-006 (Cancel or fail the provider consent and return to the app) is not proved on outlook: no scenario performs it
- function F-007 (Reconnect an inbox whose access expired or was revoked) is not proved on gmail: no scenario performs it
- function F-007 (Reconnect an inbox whose access expired or was revoked) is not proved on outlook: no scenario performs it
- function F-008 (Enable a disabled inbox) is not proved on gmail: scenarios perform it and none is said to check it
- function F-008 (Enable a disabled inbox) is not proved on outlook: scenarios perform it and none is said to check it
- function F-009 (Remove an inbox (own: clears its mail; shared: removes access)) is not proved on gmail: no scenario performs it
- function F-009 (Remove an inbox (own: clears its mail; shared: removes access)) is not proved on outlook: no scenario performs it
- function F-011 (Link Gmail automatically on Google sign-in) is not proved on gmail: scenarios perform it and none is said to check it
- function F-012 (Refresh provider access tokens) is not proved on gmail: no scenario performs it
- function F-012 (Refresh provider access tokens) is not proved on outlook: no scenario performs it
- function F-013 (Renew the provider's change notifications (Gmail watch, Outlook subscriptions)) is not proved on gmail: no scenario performs it
- function F-013 (Renew the provider's change notifications (Gmail watch, Outlook subscriptions)) is not proved on outlook: no scenario performs it
- function F-014 (Show inbox health and prompt to reconnect) is not proved on gmail: no scenario performs it
- function F-014 (Show inbox health and prompt to reconnect) is not proved on outlook: no scenario performs it
- function F-015 (Send-as aliases: list them and keep them in sync) is not proved on gmail: no scenario performs it
- function F-016 (Import existing mail when an inbox is connected (backfill)) is not proved on gmail: no scenario performs it
- function F-016 (Import existing mail when an inbox is connected (backfill)) is not proved on outlook: scenarios perform it and none is said to check it
- function F-017 (Receive a new message from the provider) is not proved on gmail: scenarios perform it and none is said to check it
- function F-017 (Receive a new message from the provider) is not proved on outlook: scenarios perform it and none is said to check it
- function F-018 (Show a new message in the open list without reloading) is not proved on gmail: scenarios perform it and none is said to check it
- function F-018 (Show a new message in the open list without reloading) is not proved on outlook: scenarios perform it and none is said to check it
- function F-019 (Pick up a change made in the provider's own client (read, archive, star, trash, label)) is not proved on gmail: no scenario performs it
- function F-019 (Pick up a change made in the provider's own client (read, archive, star, trash, label)) is not proved on outlook: no scenario performs it
- function F-020 (Pick up a message deleted at the provider) is not proved on gmail: no scenario performs it
- function F-020 (Pick up a message deleted at the provider) is not proved on outlook: no scenario performs it
- function F-021 (Pick up a draft created or changed at the provider) is not proved on gmail: no scenario performs it
- function F-021 (Pick up a draft created or changed at the provider) is not proved on outlook: no scenario performs it
- function F-022 (Pick up mail sent from the provider's own client) is not proved on gmail: no scenario performs it
- function F-022 (Pick up mail sent from the provider's own client) is not proved on outlook: no scenario performs it
- function F-023 (Force a sync of an inbox) is not proved on gmail: no scenario performs it
- function F-023 (Force a sync of an inbox) is not proved on outlook: no scenario performs it
- function F-024 (Recover after missed or failed provider notifications) is not proved on gmail: scenarios perform it and none is said to check it
- function F-024 (Recover after missed or failed provider notifications) is not proved on outlook: no scenario performs it
- function F-025 (Thread messages into conversations) is not proved on gmail: scenarios perform it and none is said to check it
- function F-025 (Thread messages into conversations) is not proved on outlook: scenarios perform it and none is said to check it
- function F-026 (Sync the provider address book into contacts) is not proved on gmail: scenarios perform it and none is said to check it
- function F-026 (Sync the provider address book into contacts) is not proved on outlook: scenarios perform it and none is said to check it
- function F-028 (Index mail for search) is not proved on gmail: scenarios perform it and none is said to check it
- function F-028 (Index mail for search) is not proved on outlook: scenarios perform it and none is said to check it
- function F-029 (Open the Inbox and switch between Focus, Signal and Noise) is not proved on gmail: scenarios perform it and none is said to check it
- function F-029 (Open the Inbox and switch between Focus, Signal and Noise) is not proved on outlook: scenarios perform it and none is said to check it
- function F-030 (Open a mailbox tab: Drafts, Sent, Scheduled, All mail, Archived, Starred) is not proved on gmail: no scenario performs it
- function F-030 (Open a mailbox tab: Drafts, Sent, Scheduled, All mail, Archived, Starred) is not proved on outlook: no scenario performs it
- function F-031 (Open Spam and Trash) is not proved on gmail: no scenario performs it
- function F-031 (Open Spam and Trash) is not proved on outlook: no scenario performs it
- function F-033 (Choose which inboxes or alias the list shows) is not proved on gmail: no scenario performs it
- function F-033 (Choose which inboxes or alias the list shows) is not proved on outlook: no scenario performs it
- function F-034 (Filter the list by read state, done state, star, attachments, people, tags, importance, activity) is not proved on gmail: no scenario performs it
- function F-034 (Filter the list by read state, done state, star, attachments, people, tags, importance, activity) is not proved on outlook: no scenario performs it
- function F-035 (Sort the list) is not proved on gmail: no scenario performs it
- function F-035 (Sort the list) is not proved on outlook: no scenario performs it
- function F-036 (Page through a long list (load more)) is not proved on gmail: no scenario performs it
- function F-036 (Page through a long list (load more)) is not proved on outlook: no scenario performs it
- function F-037 (Refresh the list) is not proved on gmail: scenarios perform it and none is said to check it
- function F-037 (Refresh the list) is not proved on outlook: scenarios perform it and none is said to check it
- function F-041 (See a thread's row: sender, subject, snippet, time, unread, star, attachment, draft and count marks) is not proved on gmail: scenarios perform it and none is said to check it
- function F-041 (See a thread's row: sender, subject, snippet, time, unread, star, attachment, draft and count marks) is not proved on outlook: scenarios perform it and none is said to check it
- function F-044 (Undo the last list action) is not proved on gmail: no scenario performs it
- function F-044 (Undo the last list action) is not proved on outlook: no scenario performs it
- function F-046 (Open a saved view) is not proved on gmail: no scenario performs it
- function F-046 (Open a saved view) is not proved on outlook: no scenario performs it
- function F-050 (Search mail by text from the list) is not proved on gmail: no scenario performs it
- function F-050 (Search mail by text from the list) is not proved on outlook: no scenario performs it
- function F-051 (Search mail from global search and Cmd+K and open a result) is not proved on gmail: no scenario performs it
- function F-051 (Search mail from global search and Cmd+K and open a result) is not proved on outlook: no scenario performs it
- function F-052 (Open a thread at the message a search hit names) is not proved on gmail: scenarios perform it and none is said to check it
- function F-052 (Open a thread at the message a search hit names) is not proved on outlook: scenarios perform it and none is said to check it
- function F-053 (Open a thread) is not proved on gmail: scenarios perform it and none is said to check it
- function F-053 (Open a thread) is not proved on outlook: scenarios perform it and none is said to check it
- function F-055 (Open a thread from a link, mention or notification) is not proved on gmail: scenarios perform it and none is said to check it
- function F-055 (Open a thread from a link, mention or notification) is not proved on outlook: scenarios perform it and none is said to check it
- function F-056 (Read a message: sanitized HTML body, plain text, inline images) is not proved on gmail: no scenario performs it
- function F-056 (Read a message: sanitized HTML body, plain text, inline images) is not proved on outlook: no scenario performs it
- function F-060 (Read a long thread (hidden middle messages, expand all)) is not proved on gmail: no scenario performs it
- function F-060 (Read a long thread (hidden middle messages, expand all)) is not proved on outlook: no scenario performs it
- function F-064 (Download a message as .eml) is not proved on gmail: no scenario performs it
- function F-064 (Download a message as .eml) is not proved on outlook: no scenario performs it
- function F-066 (See read receipts for sent mail) is not proved on gmail: no scenario performs it
- function F-066 (See read receipts for sent mail) is not proved on outlook: no scenario performs it
- function F-067 (Turn read receipts on or off for an inbox) is not proved on gmail: no scenario performs it
- function F-067 (Turn read receipts on or off for an inbox) is not proved on outlook: no scenario performs it
- function F-068 (Mark a thread read) is not proved on gmail: no scenario performs it
- function F-068 (Mark a thread read) is not proved on outlook: no scenario performs it
- function F-069 (Mark a thread unread) is not proved on gmail: no scenario performs it
- function F-069 (Mark a thread unread) is not proved on outlook: no scenario performs it
- function F-070 (Mark a thread read automatically when it is opened) is not proved on gmail: no scenario performs it
- function F-070 (Mark a thread read automatically when it is opened) is not proved on outlook: no scenario performs it
- function F-071 (Mark a thread done (archive)) is not proved on gmail: no scenario performs it
- function F-071 (Mark a thread done (archive)) is not proved on outlook: no scenario performs it
- function F-072 (Mark a thread not done (back to the inbox)) is not proved on gmail: no scenario performs it
- function F-072 (Mark a thread not done (back to the inbox)) is not proved on outlook: no scenario performs it
- function F-073 (Star a thread) is not proved on gmail: no scenario performs it
- function F-073 (Star a thread) is not proved on outlook: no scenario performs it
- function F-074 (Unstar a thread) is not proved on gmail: no scenario performs it
- function F-074 (Unstar a thread) is not proved on outlook: no scenario performs it
- function F-075 (Move a thread to Trash) is not proved on gmail: no scenario performs it
- function F-075 (Move a thread to Trash) is not proved on outlook: no scenario performs it
- function F-076 (Restore a thread from Trash) is not proved on gmail: no scenario performs it
- function F-076 (Restore a thread from Trash) is not proved on outlook: no scenario performs it
- function F-078 (Report a thread as not spam) is not proved on gmail: no scenario performs it
- function F-078 (Report a thread as not spam) is not proved on outlook: no scenario performs it
- function F-080 (Block a sender) is not proved on gmail: no scenario performs it
- function F-080 (Block a sender) is not proved on outlook: no scenario performs it
- function F-081 (Set a sender to Signal or Noise) is not proved on gmail: scenarios perform it and none is said to check it
- function F-081 (Set a sender to Signal or Noise) is not proved on outlook: scenarios perform it and none is said to check it
- function F-082 (Act on several selected threads at once (done, read, star, trash, tag)) is not proved on gmail: no scenario performs it
- function F-082 (Act on several selected threads at once (done, read, star, trash, tag)) is not proved on outlook: no scenario performs it
- function F-083 (Undo an action from its toast) is not proved on gmail: no scenario performs it
- function F-083 (Undo an action from its toast) is not proved on outlook: no scenario performs it
- function F-084 (Add and remove a tag on a thread) is not proved on gmail: no scenario performs it
- function F-084 (Add and remove a tag on a thread) is not proved on outlook: no scenario performs it
- function F-086 (Change a thread's provider labels or folder) is not proved on gmail: no scenario performs it
- function F-086 (Change a thread's provider labels or folder) is not proved on outlook: no scenario performs it
- function F-087 (Move a thread to a folder or project in Macro) is not proved on gmail: no scenario performs it
- function F-087 (Move a thread to a folder or project in Macro) is not proved on outlook: no scenario performs it
- function F-088 (Edit a thread's properties in the side panel) is not proved on gmail: no scenario performs it
- function F-088 (Edit a thread's properties in the side panel) is not proved on outlook: no scenario performs it
- function F-089 (List the provider's labels and folders) is not proved on gmail: no scenario performs it
- function F-089 (List the provider's labels and folders) is not proved on outlook: no scenario performs it
- function F-090 (Set a reminder on a thread (preset, typed time, if no reply or regardless)) is not proved on gmail: no scenario performs it
- function F-090 (Set a reminder on a thread (preset, typed time, if no reply or regardless)) is not proved on outlook: no scenario performs it
- function F-091 (Change or remove a reminder) is not proved on gmail: no scenario performs it
- function F-091 (Change or remove a reminder) is not proved on outlook: no scenario performs it
- function F-092 (See reminders in the Reminders tab) is not proved on gmail: no scenario performs it
- function F-092 (See reminders in the Reminders tab) is not proved on outlook: no scenario performs it
- function F-093 (A due reminder brings the thread back and notifies) is not proved on gmail: no scenario performs it
- function F-093 (A due reminder brings the thread back and notifies) is not proved on outlook: no scenario performs it
- function F-094 (A reply cancels an if-no-reply reminder) is not proved on gmail: scenarios perform it and none is said to check it
- function F-094 (A reply cancels an if-no-reply reminder) is not proved on outlook: scenarios perform it and none is said to check it
- function F-097 (Add recipients by typing, pasting or picking a suggestion) is not proved on gmail: no scenario performs it
- function F-097 (Add recipients by typing, pasting or picking a suggestion) is not proved on outlook: no scenario performs it
- function F-098 (Remove a recipient and move one between To, Cc and Bcc) is not proved on gmail: no scenario performs it
- function F-098 (Remove a recipient and move one between To, Cc and Bcc) is not proved on outlook: no scenario performs it
- function F-099 (Add Cc and Bcc recipients) is not proved on gmail: no scenario performs it
- function F-099 (Add Cc and Bcc recipients) is not proved on outlook: no scenario performs it
- function F-100 (Choose the sending inbox or alias) is not proved on gmail: no scenario performs it
- function F-100 (Choose the sending inbox or alias) is not proved on outlook: no scenario performs it
- function F-101 (Write the subject) is not proved on gmail: no scenario performs it
- function F-101 (Write the subject) is not proved on outlook: no scenario performs it
- function F-102 (Write the body) is not proved on gmail: no scenario performs it
- function F-102 (Write the body) is not proved on outlook: no scenario performs it
- function F-103 (Format the body (bold, italic, lists, quote, code, highlight)) is not proved on gmail: no scenario performs it
- function F-103 (Format the body (bold, italic, lists, quote, code, highlight)) is not proved on outlook: no scenario performs it
- function F-104 (Insert and edit a link) is not proved on gmail: no scenario performs it
- function F-104 (Insert and edit a link) is not proved on outlook: no scenario performs it
- function F-105 (Insert an inline image) is not proved on gmail: no scenario performs it
- function F-105 (Insert an inline image) is not proved on outlook: no scenario performs it
- function F-107 (Send with the signature, or without it) is not proved on gmail: no scenario performs it
- function F-107 (Send with the signature, or without it) is not proved on outlook: no scenario performs it
- function F-108 (Reply to a message) is not proved on gmail: no scenario performs it
- function F-108 (Reply to a message) is not proved on outlook: no scenario performs it
- function F-109 (Reply to all) is not proved on gmail: no scenario performs it
- function F-109 (Reply to all) is not proved on outlook: no scenario performs it
- function F-111 (Include or leave out the quoted original) is not proved on gmail: no scenario performs it
- function F-111 (Include or leave out the quoted original) is not proved on outlook: no scenario performs it
- function F-115 (Save a draft automatically while typing) is not proved on gmail: no scenario performs it
- function F-115 (Save a draft automatically while typing) is not proved on outlook: no scenario performs it
- function F-116 (Reopen a draft from Drafts and keep editing) is not proved on gmail: no scenario performs it
- function F-116 (Reopen a draft from Drafts and keep editing) is not proved on outlook: no scenario performs it
- function F-117 (Keep a reply draft with its thread and reopen it there) is not proved on gmail: no scenario performs it
- function F-117 (Keep a reply draft with its thread and reopen it there) is not proved on outlook: no scenario performs it
- function F-119 (Discard a draft) is not proved on gmail: no scenario performs it
- function F-119 (Discard a draft) is not proved on outlook: no scenario performs it
- function F-120 (See and resolve a draft that failed to save or conflicts with the mailbox) is not proved on gmail: no scenario performs it
- function F-120 (See and resolve a draft that failed to save or conflicts with the mailbox) is not proved on outlook: no scenario performs it
- function F-122 (Attach a file to a message (picker, drop, paste)) is not proved on gmail: no scenario performs it
- function F-122 (Attach a file to a message (picker, drop, paste)) is not proved on outlook: no scenario performs it
- function F-123 (Remove an attachment from a draft) is not proved on gmail: no scenario performs it
- function F-123 (Remove an attachment from a draft) is not proved on outlook: no scenario performs it
- function F-124 (Forward a message with its attachments) is not proved on gmail: no scenario performs it
- function F-124 (Forward a message with its attachments) is not proved on outlook: no scenario performs it
- function F-126 (Open and preview a received attachment) is not proved on gmail: no scenario performs it
- function F-126 (Open and preview a received attachment) is not proved on outlook: no scenario performs it
- function F-127 (Download a received attachment) is not proved on gmail: no scenario performs it
- function F-127 (Download a received attachment) is not proved on outlook: no scenario performs it
- function F-128 (Save a received attachment to Drive) is not proved on gmail: no scenario performs it
- function F-128 (Save a received attachment to Drive) is not proved on outlook: no scenario performs it
- function F-130 (Clean up stored files of discarded drafts) is not proved on gmail: no scenario performs it
- function F-131 (Send a new message) is not proved on gmail: no scenario performs it
- function F-131 (Send a new message) is not proved on outlook: no scenario performs it
- function F-132 (Send a reply in its thread with the right headers) is not proved on gmail: no scenario performs it
- function F-132 (Send a reply in its thread with the right headers) is not proved on outlook: no scenario performs it
- function F-133 (Send and mark done) is not proved on gmail: no scenario performs it
- function F-133 (Send and mark done) is not proved on outlook: no scenario performs it
- function F-134 (Undo send) is not proved on gmail: no scenario performs it
- function F-134 (Undo send) is not proved on outlook: no scenario performs it
- function F-135 (See that a message is sending, sent or failed) is not proved on gmail: no scenario performs it
- function F-135 (See that a message is sending, sent or failed) is not proved on outlook: no scenario performs it
- function F-136 (Retry or cancel a failed or queued send and get the draft back) is not proved on gmail: no scenario performs it
- function F-136 (Retry or cancel a failed or queued send and get the draft back) is not proved on outlook: no scenario performs it
- function F-137 (Send exactly once across retries, reloads and two tabs) is not proved on gmail: no scenario performs it
- function F-137 (Send exactly once across retries, reloads and two tabs) is not proved on outlook: no scenario performs it
- function F-138 (Send from an alias) is not proved on gmail: no scenario performs it
- function F-140 (Handle a bounce or a provider rejection) is not proved on gmail: scenarios perform it and none is said to check it
- function F-140 (Handle a bounce or a provider rejection) is not proved on outlook: scenarios perform it and none is said to check it
- function F-141 (Reply on a thread shared by a teammate) is not proved on gmail: no scenario performs it
- function F-141 (Reply on a thread shared by a teammate) is not proved on outlook: no scenario performs it
- function F-142 (Schedule a message for later (preset, typed, custom time)) is not proved on gmail: no scenario performs it
- function F-142 (Schedule a message for later (preset, typed, custom time)) is not proved on outlook: no scenario performs it
- function F-143 (Change the time of a scheduled message) is not proved on gmail: no scenario performs it
- function F-143 (Change the time of a scheduled message) is not proved on outlook: no scenario performs it
- function F-144 (Cancel a scheduled message back to a draft) is not proved on gmail: no scenario performs it
- function F-144 (Cancel a scheduled message back to a draft) is not proved on outlook: no scenario performs it
- function F-145 (See scheduled messages in the Scheduled tab) is not proved on gmail: no scenario performs it
- function F-145 (See scheduled messages in the Scheduled tab) is not proved on outlook: no scenario performs it
- function F-146 (Deliver a scheduled message when it is due) is not proved on gmail: no scenario performs it
- function F-146 (Deliver a scheduled message when it is due) is not proved on outlook: no scenario performs it
- function F-147 (Report and recover a scheduled send that failed) is not proved on gmail: no scenario performs it
- function F-147 (Report and recover a scheduled send that failed) is not proved on outlook: no scenario performs it
- function F-148 (Write and save a signature) is not proved on gmail: no scenario performs it
- function F-148 (Write and save a signature) is not proved on outlook: no scenario performs it
- function F-149 (Edit a signature as rich text or HTML and preview it) is not proved on gmail: no scenario performs it
- function F-149 (Edit a signature as rich text or HTML and preview it) is not proved on outlook: no scenario performs it
- function F-150 (Clear a signature) is not proved on gmail: no scenario performs it
- function F-150 (Clear a signature) is not proved on outlook: no scenario performs it
- function F-151 (Import the signature from Gmail) is not proved on gmail: no scenario performs it
- function F-152 (Choose whether replies and forwards get the signature) is not proved on gmail: no scenario performs it
- function F-152 (Choose whether replies and forwards get the signature) is not proved on outlook: no scenario performs it
- function F-153 (See an invitation card in a thread) is not proved on gmail: no scenario performs it
- function F-153 (See an invitation card in a thread) is not proved on outlook: no scenario performs it
- function F-156 (Add a forwarded invitation to the calendar) is not proved on gmail: no scenario performs it
- function F-156 (Add a forwarded invitation to the calendar) is not proved on outlook: no scenario performs it
- function F-157 (Turn calendar access on or off for an inbox) is not proved on gmail: no scenario performs it
- function F-157 (Turn calendar access on or off for an inbox) is not proved on outlook: no scenario performs it
- function F-159 (Open a thread shared by someone else) is not proved on gmail: scenarios perform it and none is said to check it
- function F-159 (Open a thread shared by someone else) is not proved on outlook: scenarios perform it and none is said to check it
- function F-163 (Open the thread from a notification) is not proved on gmail: scenarios perform it and none is said to check it
- function F-163 (Open the thread from a notification) is not proved on outlook: scenarios perform it and none is said to check it
- function F-164 (See and act on mail from Home (open, mark done)) is not proved on gmail: no scenario performs it
- function F-164 (See and act on mail from Home (open, mark done)) is not proved on outlook: no scenario performs it
- function F-165 (Compose an email to a CRM contact and see their mail) is not proved on gmail: no scenario performs it
- function F-165 (Compose an email to a CRM contact and see their mail) is not proved on outlook: no scenario performs it
- function F-166 (Draft or send an email from the universal input) is not proved on gmail: no scenario performs it
- function F-166 (Draft or send an email from the universal input) is not proved on outlook: no scenario performs it
- function F-167 (Create a task or ask the assistant about a thread) is not proved on gmail: no scenario performs it
- function F-167 (Create a task or ask the assistant about a thread) is not proved on outlook: no scenario performs it
- function F-168 (Assistant drafts an email the user edits and sends from a card) is not proved on gmail: no scenario performs it
- function F-168 (Assistant drafts an email the user edits and sends from a card) is not proved on outlook: no scenario performs it
- function F-169 (Assistant reads threads and attachments) is not proved on gmail: no scenario performs it
- function F-169 (Assistant reads threads and attachments) is not proved on outlook: no scenario performs it
- function F-170 (Assistant lists inboxes and labels and changes a thread's labels) is not proved on gmail: no scenario performs it
- function F-170 (Assistant lists inboxes and labels and changes a thread's labels) is not proved on outlook: no scenario performs it
- function F-171 (Assistant sets a sender policy) is not proved on gmail: no scenario performs it
- function F-171 (Assistant sets a sender policy) is not proved on outlook: no scenario performs it
- function F-172 (Remove a user's mail and links when the account is deleted) is not proved on gmail: no scenario performs it
- function F-172 (Remove a user's mail and links when the account is deleted) is not proved on outlook: no scenario performs it
- function F-173 (Stop sending to addresses that bounced or complained) is not proved on gmail: no scenario performs it
- function F-173 (Stop sending to addresses that bounced or complained) is not proved on outlook: no scenario performs it
- function F-174 (Enforce the plan's inbox entitlement) is not proved on gmail: scenarios perform it and none is said to check it
- function F-174 (Enforce the plan's inbox entitlement) is not proved on outlook: scenarios perform it and none is said to check it
- function F-175 (Feed mail events to activity, routines and suggestions) is not proved on gmail: scenarios perform it and none is said to check it
- function F-175 (Feed mail events to activity, routines and suggestions) is not proved on outlook: scenarios perform it and none is said to check it
- function F-176 (Enrich CRM contacts from mail and clean up after removal) is not proved on gmail: scenarios perform it and none is said to check it
- function F-176 (Enrich CRM contacts from mail and clean up after removal) is not proved on outlook: scenarios perform it and none is said to check it
- function F-180 (See that a change is waiting for, or was refused by, the mailbox) is not proved on gmail: no scenario performs it
- function F-180 (See that a change is waiting for, or was refused by, the mailbox) is not proved on outlook: no scenario performs it
- function F-185 (Open and preview an attachment on a draft) is not proved on gmail: no scenario performs it
- function F-185 (Open and preview an attachment on a draft) is not proved on outlook: no scenario performs it
- function F-189 (See the connected inboxes in Settings (provider, primary or shared, loading and failed states)) is not proved on gmail: scenarios perform it and none is said to check it
- function F-189 (See the connected inboxes in Settings (provider, primary or shared, loading and failed states)) is not proved on outlook: scenarios perform it and none is said to check it
- function F-193 (Create and delete a provider label) is not proved on gmail: no scenario performs it
- function F-193 (Create and delete a provider label) is not proved on outlook: no scenario performs it
- function F-194 (Forward a calendar event by email) is not proved on gmail: no scenario performs it
- function F-194 (Forward a calendar event by email) is not proved on outlook: no scenario performs it
- function F-195 (Cancel a running mail import) is not proved on gmail: no scenario performs it
- function F-196 (Unblock a sender) is not proved on gmail: no scenario performs it
- function F-196 (Unblock a sender) is not proved on outlook: no scenario performs it
- function F-197 (Report a thread as spam) is not proved on gmail: no scenario performs it
- function F-197 (Report a thread as spam) is not proved on outlook: no scenario performs it
- entry point `elsewhere document_storage_service DELETE /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service DELETE /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service GET /reminders/email/collection` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service GET /reminders/email/collection` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service GET /reminders/email/{thread_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service GET /reminders/email/{thread_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /items/soup/ast` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /items/soup/ast` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /properties/tags` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /properties/tags` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /search` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service POST /search` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service PUT /properties/entities/{entity_type}/{entity_id}/{property_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service PUT /properties/entities/{entity_type}/{entity_id}/{property_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `elsewhere document_storage_service PUT /reminders/email/{thread_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `elsewhere document_storage_service PUT /reminders/email/{thread_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `gateway refresh_email:Backfill` is not reached on gmail, and is neither waived nor deferred
- entry point `gateway refresh_email:BackfillProgress` is not reached on outlook, and is neither waived nor deferred
- entry point `gateway refresh_email:DeleteMessage` is not reached on gmail, and is neither waived nor deferred
- entry point `gateway refresh_email:LinkRemoved` is not reached on gmail, and is neither waived nor deferred
- entry point `gateway refresh_email:LinkRemoved` is not reached on outlook, and is neither waived nor deferred
- entry point `gateway refresh_email:PhotoSynced` is not reached on outlook, and is neither waived nor deferred
- entry point `gateway refresh_email:UpdateLabels` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.cancelEmailSend` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.cancelEmailSend` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.deleteEmailDraft` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.deleteEmailDraft` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.markEmailThreadSeen` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.markEmailThreadSeen` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.markEmailThreadUnread` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.markEmailThreadUnread` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.saveEmailDraft` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.saveEmailDraft` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.sendEmailAttempt` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.sendEmailAttempt` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.setEmailThreadArchived` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.setEmailThreadArchived` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.setEmailThreadState` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.setEmailThreadState` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.setEmailThreadsArchived` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.setEmailThreadsArchived` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.updateEmailThreadLabel` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql CompleteMutationRoot.updateEmailThreadLabel` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlEmailLink.sendAs` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlEmailLink.sendAs` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.hasReceivedMail` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.hasReceivedMail` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.latestInboundMessageTs` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.latestInboundMessageTs` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.latestNonSpamMessageTs` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.latestNonSpamMessageTs` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.latestOutboundMessageTs` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.latestOutboundMessageTs` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.linkId` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.linkId` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailAllPreview` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailAllPreview` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailDraftPreview` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailDraftPreview` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailDraftState` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailDraftState` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailSentPreview` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.mailSentPreview` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.messages` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.messages` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.reminderReturnedAt` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlSoupEmailThread.reminderReturnedAt` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlUser.emailLinks` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlUser.emailLinks` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlUser.emailSendAttempt` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlUser.emailSendAttempt` is not reached on outlook, and is neither waived nor deferred
- entry point `graphql GraphqlUser.pendingEmailSends` is not reached on gmail, and is neither waived nor deferred
- entry point `graphql GraphqlUser.pendingEmailSends` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/backfill/gmail` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/scheduled/{message_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/scheduled/{message_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/{id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/{id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/{id}/attachments/{attachment_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/{id}/attachments/{attachment_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/{id}/forwarded-attachments/{attachment_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/drafts/{id}/forwarded-attachments/{attachment_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/filters/{id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/filters/{id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/labels/{id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/labels/{id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/links/{link_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/links/{link_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/links/{link_id}/calendar` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/links/{link_id}/calendar` is not reached on outlook, and is neither waived nor deferred
- entry point `http DELETE /email/sync` is not reached on gmail, and is neither waived nor deferred
- entry point `http DELETE /email/sync` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/attachments/{id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/attachments/{id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/attachments/{id}/document_id` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/attachments/{id}/document_id` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/backfill/gmail` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/backfill/gmail/active` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/backfill/gmail/{id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/contacts` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/contacts` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/contacts/blocked` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/contacts/blocked` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/drafts/scheduled` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/drafts/scheduled` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/drafts/{id}/operation` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/drafts/{id}/operation` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/filters` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/filters` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/labels` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/labels` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/messages/{id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/messages/{id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/messages/{id}/eml` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/messages/{id}/eml` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/settings/operations` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/settings/operations` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/threads/{id}/messages` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/threads/{id}/messages` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/threads/{id}/operations` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/threads/{id}/operations` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/threads/{thread_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/threads/{thread_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/threads/{thread_id}/calendar-invitations` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/threads/{thread_id}/calendar-invitations` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /email/threads/{thread_id}/read-receipts` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /email/threads/{thread_id}/read-receipts` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /internal/recent_messages/{user_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /internal/recent_messages/{user_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `http GET /opens/{token}` is not reached on gmail, and is neither waived nor deferred
- entry point `http GET /opens/{token}` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/messages/labels` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/messages/labels` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/settings` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/settings` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/threads/archived` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/threads/archived` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{id}/archived` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{id}/archived` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{id}/labels` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{id}/labels` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{id}/state` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{id}/state` is not reached on outlook, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{thread_id}/project` is not reached on gmail, and is neither waived nor deferred
- entry point `http PATCH /email/threads/{thread_id}/project` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/calendar-events/{event_id}/forward` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/calendar-events/{event_id}/forward` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/contacts/block` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/contacts/block` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/contacts/unblock` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/contacts/unblock` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/draft-transfers/{id}/recover` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/draft-transfers/{id}/recover` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/drafts` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/drafts` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/attachments` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/attachments` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/attachments/{attachment_id}/complete` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/attachments/{attachment_id}/complete` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/forwarded-attachments` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/forwarded-attachments` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/resolve` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/resolve` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/transfer` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/drafts/{id}/transfer` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/labels` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/labels` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/links/health-check` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/links/health-check` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/links/{link_id}/resync` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/links/{link_id}/resync` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/messages` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/messages` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/messages/batch` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/messages/batch` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/settings/import-signature` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/threads/{id}/seen` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/threads/{id}/seen` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /internal/messages/senders` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /internal/messages/senders` is not reached on outlook, and is neither waived nor deferred
- entry point `http POST /internal/threads/histories` is not reached on gmail, and is neither waived nor deferred
- entry point `http POST /internal/threads/histories` is not reached on outlook, and is neither waived nor deferred
- entry point `http PUT /email/drafts/scheduled/{message_id}` is not reached on gmail, and is neither waived nor deferred
- entry point `http PUT /email/drafts/scheduled/{message_id}` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:LinkDisconnected` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:LinkDisconnected` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:LinkReauthRequired` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:LinkReauthRequired` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:MessageDeleted` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:MessageDraftSynced` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:MessageDraftSynced` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:MessageSendCancelled` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:MessageSendCancelled` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:MessageSendQueued` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:MessageSendQueued` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:MessageSent` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:MessageSent` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadArchived` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadArchived` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadBackfilled` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadBackfilled` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadLabelsUpdated` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadLabelsUpdated` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadProjectChanged` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadProjectChanged` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadRead` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadRead` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadSpamChanged` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadSpamChanged` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadStarred` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadStarred` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadTrashed` is not reached on gmail, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadTrashed` is not reached on outlook, and is neither waived nor deferred
- entry point `kafka macro.email:ThreadsReindexRequested` is not reached on gmail, and is neither waived nor deferred
- entry point `lambda email_refresh_handler` is not reached on gmail, and is neither waived nor deferred
- entry point `lambda email_scheduled_handler` is not reached on gmail, and is neither waived nor deferred
- entry point `lambda email_scheduled_handler` is not reached on outlook, and is neither waived nor deferred
- entry point `lambda email_sfs_delete_handler` is not reached on gmail, and is neither waived nor deferred
- entry point `lambda email_suppression_handler` is not reached on gmail, and is neither waived nor deferred
- entry point `lambda email_suppression_handler` is not reached on outlook, and is neither waived nor deferred
- entry point `lambda user_link_cleanup_handler` is not reached on gmail, and is neither waived nor deferred
- entry point `lambda user_link_cleanup_handler` is not reached on outlook, and is neither waived nor deferred
- entry point `provider gmail:channels.stop` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:drafts.create` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:drafts.delete` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:drafts.update` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:events.import` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:labels.create` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:labels.delete` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:messages.attachments.get` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:messages.batchModify` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:messages.list` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:messages.modify` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:messages.send` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:oauth.authorize` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:oauth.tokeninfo` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:settings.filters.create` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:settings.filters.delete` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:settings.filters.list` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:settings.sendAs.list` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:stop` is not reached on gmail, and is neither waived nor deferred
- entry point `provider gmail:threads.list` is not reached on gmail, and is neither waived nor deferred
- entry point `provider outlook:attachments.create` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:attachments.delete` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:attachments.value` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:categories.create` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:categories.delete` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:contacts.delta` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:contacts.photo` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:folders.create` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:mailboxSettings.get` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:me.photo` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.create` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.createReply` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.delete` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.list` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.move` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.send` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.update` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:messages.value` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:oauth.authorize` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:rules.create` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:rules.delete` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:rules.list` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:subscriptions.delete` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:subscriptions.update` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:uploads.create` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:uploads.get` is not reached on outlook, and is neither waived nor deferred
- entry point `provider outlook:uploads.put` is not reached on outlook, and is neither waived nor deferred
- entry point `queue backfill:BackfillAttachment` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:BackfillThread` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:DepopulateCrmForUser` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:ListThreads` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:PopulateCrmForUser` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:PopulateCrmPolicy` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:PopulateCrmPolicy` is not reached on outlook, and is neither waived nor deferred
- entry point `queue backfill:SeedSentContact` is not reached on gmail, and is neither waived nor deferred
- entry point `queue backfill:UpdateThreadMetadata` is not reached on gmail, and is neither waived nor deferred
- entry point `queue crm-cleanup:ListCandidates` is not reached on gmail, and is neither waived nor deferred
- entry point `queue crm-cleanup:ListCandidates` is not reached on outlook, and is neither waived nor deferred
- entry point `queue crm-cleanup:ProcessCandidate` is not reached on gmail, and is neither waived nor deferred
- entry point `queue crm-cleanup:ProcessCandidate` is not reached on outlook, and is neither waived nor deferred
- entry point `queue crm-cleanup:StartJob` is not reached on gmail, and is neither waived nor deferred
- entry point `queue crm-cleanup:StartJob` is not reached on outlook, and is neither waived nor deferred
- entry point `queue gmail-inbox-sync:DeleteMessage` is not reached on gmail, and is neither waived nor deferred
- entry point `queue gmail-inbox-sync:UpdateLabels` is not reached on gmail, and is neither waived nor deferred
- entry point `queue gmail-ops:ModifyMessageLabels` is not reached on gmail, and is neither waived nor deferred
- entry point `queue gmail-ops:ModifyMessageLabelsBatch` is not reached on gmail, and is neither waived nor deferred
- entry point `queue link-manager:DeleteLink` is not reached on gmail, and is neither waived nor deferred
- entry point `queue link-manager:DeleteLink` is not reached on outlook, and is neither waived nor deferred
- entry point `queue link-manager:DeleteUser` is not reached on gmail, and is neither waived nor deferred
- entry point `queue link-manager:DeleteUser` is not reached on outlook, and is neither waived nor deferred
- entry point `queue link-manager:HealthCheck` is not reached on gmail, and is neither waived nor deferred
- entry point `queue link-manager:HealthCheck` is not reached on outlook, and is neither waived nor deferred
- entry point `queue link-manager:NotifyReauthRequired` is not reached on gmail, and is neither waived nor deferred
- entry point `queue link-manager:Refresh` is not reached on gmail, and is neither waived nor deferred
- entry point `queue link-manager:Refresh` is not reached on outlook, and is neither waived nor deferred
- entry point `queue reminder-dispatch:Deliver` is not reached on gmail, and is neither waived nor deferred
- entry point `queue reminder-dispatch:Deliver` is not reached on outlook, and is neither waived nor deferred
- entry point `queue reminder-dispatch:Sweep` is not reached on gmail, and is neither waived nor deferred
- entry point `queue reminder-dispatch:Sweep` is not reached on outlook, and is neither waived nor deferred
- entry point `queue scheduled:ScheduledPubsubMessage` is not reached on gmail, and is neither waived nor deferred
- entry point `queue scheduled:ScheduledPubsubMessage` is not reached on outlook, and is neither waived nor deferred
- entry point `queue sfs-delete:SFSDeleteMessage` is not reached on gmail, and is neither waived nor deferred
- entry point `tool GetThread` is not reached on gmail, and is neither waived nor deferred
- entry point `tool GetThread` is not reached on outlook, and is neither waived nor deferred
- entry point `tool ListInboxes` is not reached on gmail, and is neither waived nor deferred
- entry point `tool ListInboxes` is not reached on outlook, and is neither waived nor deferred
- entry point `tool ListLabels` is not reached on gmail, and is neither waived nor deferred
- entry point `tool ListLabels` is not reached on outlook, and is neither waived nor deferred
- entry point `tool SendConfirmedEmail` is not reached on gmail, and is neither waived nor deferred
- entry point `tool SendConfirmedEmail` is not reached on outlook, and is neither waived nor deferred
- entry point `tool SendEmail` is not reached on gmail, and is neither waived nor deferred
- entry point `tool SendEmail` is not reached on outlook, and is neither waived nor deferred
- entry point `tool SetSenderPolicy` is not reached on gmail, and is neither waived nor deferred
- entry point `tool SetSenderPolicy` is not reached on outlook, and is neither waived nor deferred
- entry point `tool UpdateThreadLabels` is not reached on gmail, and is neither waived nor deferred
- entry point `tool UpdateThreadLabels` is not reached on outlook, and is neither waived nor deferred
- entry point `webhook outlook:lifecycle:missed` is not reached on outlook, and is neither waived nor deferred
- entry point `webhook outlook:lifecycle:reauthorizationRequired` is not reached on outlook, and is neither waived nor deferred
- entry point `webhook outlook:lifecycle:subscriptionRemoved` is not reached on outlook, and is neither waived nor deferred
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_linked_inbox_is_listed` is said to check F-001, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_linked_inbox_is_listed` is said to check F-002, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth two_gmail_inboxes_of_a_user_each_use_their_own_grant` is said to check F-004, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_unlinking_removes_only_that_inbox` is said to check F-004, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth gmail_revoked_grant_asks_for_a_reconnect_that_restores_sync` is said to check F-007, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth outlook_revoked_grant_asks_for_a_reconnect_that_restores_sync` is said to check F-007, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_owner_turns_sync_off` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_owner_turns_sync_off` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_unlinking_removes_only_that_inbox` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_unlinking_removes_only_that_inbox` is said to check F-009, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_connect signing_in_with_every_scope_records_the_calendar_grant` is said to check F-011, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_health_check_tells_healthy_from_revoked` is said to check F-012, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth refresh_job_marks_a_revoked_gmail_grant_and_is_not_retried` is said to check F-013, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_health_check_tells_healthy_from_revoked` is said to check F-014, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_health_check_tells_healthy_from_revoked` is said to check F-014, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill gmail_mail_present_before_linking_is_imported` is said to check F-016, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill outlook_mail_present_before_linking_is_imported` is said to check F-016, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `gmail new_mail_arrives_through_push` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `outlook new_mail_arrives_through_sync` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion gmail_received_message_fields_come_through` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_received_message_fields_come_through` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill outlook_mail_arriving_mid_import_shows_before_the_import_ends` is said to check F-017, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion gmail_mail_from_an_odd_address_is_still_announced` is said to check F-018, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity gmail_filing_at_the_provider` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity outlook_filing_at_the_provider` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity outlook_flag_both_ways` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state gmail_read_state_travels_both_ways` is said to check F-019, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider gmail_mail_deleted_at_the_provider_disappears` is said to check F-020, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider outlook_mail_deleted_at_the_provider_disappears` is said to check F-020, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion gmail_odd_recipient_does_not_cost_the_other_contacts` is said to check F-022, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_odd_addresses_do_not_cost_the_message_or_other_contacts` is said to check F-022, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_resync_brings_back_a_lost_thread` is said to check F-023, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_resync_brings_back_a_lost_thread` is said to check F-023, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider gmail_pushes_for_an_inbox_that_needs_reauth_are_not_synced` is said to check F-024, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider gmail_sync_recovers_from_an_expired_cursor` is said to check F-024, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_joins_its_thread` is said to check F-025, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_joins_its_thread` is said to check F-025, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_mail_is_found_by_the_parts_of_an_address` is said to check F-028, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_mail_is_found_by_the_parts_of_an_address` is said to check F-028, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_noise_rule_round_trip` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_noise_rule_round_trip` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_inbox_lists_only_threads_with_received_mail` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_inbox_lists_only_threads_with_received_mail` is said to check F-029, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_all_mail_leaves_out_spam_and_trash` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_sent_lists_mail_from_every_inbox` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_all_mail_leaves_out_spam_and_trash` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_sent_lists_mail_from_every_inbox` is said to check F-030, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_trashed_and_junk_threads_open_and_change_by_id` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_trashed_and_junk_threads_open_and_change_by_id` is said to check F-031, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_unread_filter_lists_exactly_the_unread_threads` is said to check F-034, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_unread_filter_lists_exactly_the_unread_threads` is said to check F-034, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_reopens_a_read_thread` is said to check F-035, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_reopens_a_read_thread` is said to check F-035, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_all_mail_leaves_out_spam_and_trash` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists gmail_other_view_pages_over_its_own_mail` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_all_mail_leaves_out_spam_and_trash` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_lists outlook_other_view_pages_over_its_own_mail` is said to check F-036, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_joins_its_thread` is said to check F-041, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_joins_its_thread` is said to check F-041, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_done_for_several_threads_at_once` is said to check F-044, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_done_for_several_threads_at_once` is said to check F-044, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_a_quoted_query_finds_the_exact_phrase` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_mail_is_found_by_the_parts_of_an_address` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_quoted_query_finds_the_exact_phrase` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_mail_is_found_by_the_parts_of_an_address` is said to check F-050, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_joins_its_thread` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_joins_its_thread` is said to check F-053, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_dateless_draft_does_not_head_the_thread` is said to check F-055, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_dateless_draft_does_not_head_the_thread` is said to check F-055, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_everything_in_a_message` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_everything_in_a_message` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering gmail_sanitized_html_keeps_layout_and_drops_scripts` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering outlook_sanitized_html_keeps_layout_and_drops_scripts` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering gmail_escaped_markup_stays_text` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering outlook_escaped_markup_stays_text` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering gmail_sanitized_html_keeps_its_shape` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_rendering outlook_sanitized_html_keeps_its_shape` is said to check F-056, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_long_thread_pages_through_every_message` is said to check F-060, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_long_thread_pages_through_every_message` is said to check F-060, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_everything_in_a_message` is said to check F-064, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_everything_in_a_message` is said to check F-064, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_receipt_records_an_open` is said to check F-066, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_receipt_records_an_open` is said to check F-066, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading gmail_read_receipt_records_an_open` is said to check F-067, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_reading outlook_read_receipt_records_an_open` is said to check F-067, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state gmail_read_state_travels_both_ways` is said to check F-068, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state outlook_read_state_travels_both_ways` is said to check F-068, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-069, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-069, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-070, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-070, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive gmail_an_archived_thread_can_be_restored` is said to check F-071, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive outlook_an_archived_thread_can_be_restored` is said to check F-071, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive gmail_an_archived_thread_can_be_restored` is said to check F-072, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive outlook_an_archived_thread_can_be_restored` is said to check F-072, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-073, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-073, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels gmail_a_star_set_in_macro_reaches_gmail` is said to check F-074, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-075, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-075, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_star_trash_and_restore` is said to check F-076, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_star_trash_and_restore` is said to check F-076, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_block_and_unblock_a_sender` is said to check F-080, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_block_and_unblock_a_sender` is said to check F-080, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_noise_rule_round_trip` is said to check F-081, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_noise_rule_round_trip` is said to check F-081, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_done_for_several_threads_at_once` is said to check F-082, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_done_for_several_threads_at_once` is said to check F-082, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_done_for_several_threads_at_once` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_done_for_several_threads_at_once` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive gmail_an_archived_thread_can_be_restored` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_archive outlook_an_archived_thread_can_be_restored` is said to check F-083, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_own_label_from_creation_to_deletion` is said to check F-086, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_own_label_from_creation_to_deletion` is said to check F-086, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels outlook_a_label_on_one_message_reaches_outlook` is said to check F-086, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_thread_is_filed_in_a_project` is said to check F-087, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_thread_is_filed_in_a_project` is said to check F-087, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity gmail_label_made_at_the_provider` is said to check F-089, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_parity outlook_label_made_at_the_provider` is said to check F-089, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-090, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-090, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-093, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-093, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-094, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-094, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-097, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-097, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-099, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-099, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_from_switch gmail_draft_moves_to_the_outlook_inbox_chosen_in_from` is said to check F-100, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_from_switch outlook_draft_moves_to_the_gmail_inbox_chosen_in_from` is said to check F-100, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-101, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-101, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_authored_html_is_sanitized` is said to check F-102, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_authored_html_is_sanitized` is said to check F-102, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_reply_joins_the_thread_on_both_sides` is said to check F-108, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_reply_joins_the_thread_on_both_sides` is said to check F-108, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_draft_is_saved_and_updated` is said to check F-115, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_draft_is_saved_and_updated` is said to check F-115, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_draft_is_saved_and_updated` is said to check F-116, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_reply_draft_stays_in_its_thread` is said to check F-117, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_reply_draft_stays_in_its_thread` is said to check F-117, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_discarded_draft_is_gone` is said to check F-119, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_discarded_draft_is_gone` is said to check F-119, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_attachment_reserved_before_its_upload_is_sent_once` is said to check F-122, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_attachment_reserved_before_its_upload_is_sent_once` is said to check F-122, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_removed_attachment_is_not_sent` is said to check F-123, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_removed_attachment_is_not_sent` is said to check F-123, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_forward_from_another_inbox_keeps_attachments` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_forward_from_another_inbox_keeps_attachments` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_calendar_attachment_is_readable_and_not_a_document` is said to check F-126, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_calendar_attachment_is_readable_and_not_a_document` is said to check F-126, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments gmail_received_attachment_downloads` is said to check F-127, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments outlook_received_attachment_downloads` is said to check F-127, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachment_documents gmail_received_attachment_becomes_a_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachment_documents outlook_received_attachment_becomes_a_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_long_attachment_name_is_cut_for_its_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_long_attachment_name_is_cut_for_its_document` is said to check F-128, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_composer_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_composer_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sending gmail_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sending outlook_send_reaches_the_other_mailbox` is said to check F-131, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_reply_joins_the_thread_on_both_sides` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_reply_joins_the_thread_on_both_sides` is said to check F-132, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_reply_from_the_composer_round_trip` is said to check F-133, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_writes gmail_a_thread_can_be_archived_while_a_reply_is_sending` is said to check F-133, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_undo_restores_the_draft_as_written` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_undo_restores_the_draft_as_written` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_undo_within_the_window_delivers_nothing` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_undo_within_the_window_delivers_nothing` is said to check F-134, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_composer_send_reaches_the_other_mailbox` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_refused_send_fails_and_can_be_taken_back` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_composer_send_reaches_the_other_mailbox` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_refused_send_fails_and_can_be_taken_back` is said to check F-135, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_refused_send_fails_and_can_be_taken_back` is said to check F-136, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_refused_send_fails_and_can_be_taken_back` is said to check F-136, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_composer_send_reaches_the_other_mailbox` is said to check F-137, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_composer_send_reaches_the_other_mailbox` is said to check F-137, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_refused_send_is_reported_as_failed` is said to check F-140, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_refused_send_is_reported_as_failed` is said to check F-140, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_bounces gmail_a_bounce_shows_the_failure_not_the_returned_message` is said to check F-140, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-142, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-142, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-143, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-143, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-144, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-144, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_goes_out_as_committed` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_waits_for_its_time` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_goes_out_as_committed` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_waits_for_its_time` is said to check F-145, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled gmail_scheduled_message_goes_out_as_committed` is said to check F-146, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_scheduled outlook_scheduled_message_goes_out_as_committed` is said to check F-146, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_correspondents_and_settings` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_correspondents_and_settings` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures gmail_new_message_carries_the_signature` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures outlook_new_message_carries_the_signature` is said to check F-148, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_correspondents_and_settings` is said to check F-150, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_correspondents_and_settings` is said to check F-150, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_imported_signature_keeps_an_image_pasted_from_a_message` is said to check F-151, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_correspondents_and_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account outlook_correspondents_and_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures gmail_signature_follows_the_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures outlook_signature_follows_the_settings` is said to check F-152, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_identity an_invitation_card_answers_as_the_inbox_its_mail_arrived_in` is said to check F-153, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_connect outlook_turning_the_calendar_off` is said to check F-157, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation gmail_a_delegate_is_told_of_new_mail_and_can_open_it` is said to check F-163, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent gmail_agent_drafts_then_sends_a_signed_reply` is said to check F-166, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent outlook_agent_drafts_then_sends_a_signed_reply` is said to check F-166, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_reads_a_thread_in_a_second_inbox` is said to check F-167, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_reads_a_thread_in_a_second_inbox` is said to check F-167, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent gmail_agent_drafts_then_sends_a_signed_reply` is said to check F-168, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent outlook_agent_drafts_then_sends_a_signed_reply` is said to check F-168, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_reads_a_thread_in_a_second_inbox` is said to check F-169, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_reads_a_thread_in_a_second_inbox` is said to check F-169, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_archive_reaches_the_provider` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_archive_reaches_the_provider` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent gmail_agent_sets_where_a_senders_mail_lands` is said to check F-171, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_agent outlook_agent_sets_where_a_senders_mail_lands` is said to check F-171, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_free_plan_allows_two_inboxes` is said to check F-174, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_free_plan_allows_two_inboxes` is said to check F-174, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_linked_inbox_is_listed` is said to check F-189, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_linked_inbox_is_listed` is said to check F-189, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_owner_turns_sync_off` is said to check F-008, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_relinking_an_unlinked_mailbox_imports_its_mail_once` is said to check F-008, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_relinking_an_unlinked_mailbox_imports_its_mail_once` is said to check F-008, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachment_documents gmail_attachment_of_a_replaced_draft_is_not_found` is said to check F-021, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading gmail_reply_reopens_a_read_thread` is said to check F-037, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_threading outlook_reply_reopens_a_read_thread` is said to check F-037, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_unread_filter_lists_exactly_the_unread_threads` is said to check F-046, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_unread_filter_lists_exactly_the_unread_threads` is said to check F-046, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_mail_is_found_by_the_parts_of_an_address` is said to check F-051, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search a_personal_tag_is_in_its_owners_search_results_only` is said to check F-084, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_sent_html_keeps_paragraphs_and_links` is said to check F-103, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_sent_html_keeps_paragraphs_and_links` is said to check F-103, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_sent_html_keeps_paragraphs_and_links` is said to check F-104, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_sent_html_keeps_paragraphs_and_links` is said to check F-104, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_forward_from_another_inbox_keeps_attachments` is said to check F-105, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_forward_from_another_inbox_keeps_attachments` is said to check F-105, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_new_message_to_several_people_carries_the_signature` is said to check F-107, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_new_message_to_several_people_carries_the_signature` is said to check F-107, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_quoted_thread_is_sent_once` is said to check F-111, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_quoted_thread_is_sent_once` is said to check F-111, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_draft_is_saved_and_updated` is said to check F-116, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer outlook_reply_from_the_composer_round_trip` is said to check F-133, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt gmail_sweep_delivers_a_send_whose_queue_message_was_lost` is said to check F-147, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures gmail_new_message_carries_the_signature` is said to check F-149, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_signatures outlook_new_message_carries_the_signature` is said to check F-149, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation outlook_deleting_a_delegate_removes_their_access` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation outlook_deleting_a_delegate_leaves_the_owner_their_inbox` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_delegation outlook_a_waiting_change_survives_a_reconnect` is said to check F-180, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_own_label_from_creation_to_deletion` is said to check F-193, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_own_label_from_creation_to_deletion` is said to check F-193, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules gmail_block_and_unblock_a_sender` is said to check F-196, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_sender_rules outlook_block_and_unblock_a_sender` is said to check F-196, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_junk_leaves_the_inbox` is said to check F-197, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_auth outlook_subscription_is_renewed_when_outlook_asks` is said to check F-013, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_new_mail_tells_the_open_app_to_refresh` is said to check F-018, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_ingestion outlook_draft_written_in_outlook_shows_and_follows_its_edits` is said to check F-021, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_provider outlook_missed_notifications_are_made_up_for_at_once` is said to check F-024, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_contacts gmail_address_book_names_the_people_the_user_writes_to` is said to check F-026, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_contacts outlook_address_book_names_the_people_the_user_writes_to` is said to check F-026, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_a_search_of_everything_finds_mail_and_the_hit_opens` is said to check F-051, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_search_of_everything_finds_mail_and_the_hit_opens` is said to check F-051, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search gmail_a_search_hit_names_the_message_it_matched` is said to check F-052, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_search_hit_names_the_message_it_matched` is said to check F-052, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `search outlook_a_personal_tag_is_in_its_owners_search_results_only` is said to check F-084, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_changed_then_removed_reminder_gives_the_thread_back` is said to check F-091, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_changed_then_removed_reminder_gives_the_thread_back` is said to check F-091, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts gmail_removed_and_moved_recipients_are_what_is_sent` is said to check F-098, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_removed_and_moved_recipients_are_what_is_sent` is said to check F-098, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery gmail_reply_to_all_reaches_everyone_but_its_sender` is said to check F-109, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_delivery outlook_reply_to_all_reaches_everyone_but_its_sender` is said to check F-109, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments gmail_forward_arrives_with_the_original_and_its_files` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attachments outlook_forward_arrives_with_the_original_and_its_files` is said to check F-124, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing gmail_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox` is said to check F-141, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing outlook_a_reply_on_a_shared_thread_leaves_from_the_repliers_inbox` is said to check F-141, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing gmail_a_thread_shared_by_someone_else_opens` is said to check F-159, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `thread_sharing outlook_a_thread_shared_by_someone_else_opens` is said to check F-159, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_notifications gmail_new_mail_is_announced_to_the_notification_service` is said to check F-163, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_notifications outlook_new_mail_is_announced_to_the_notification_service` is said to check F-163, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_mail_on_home_is_listed_and_marked_done` is said to check F-164, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_mail_on_home_is_listed_and_marked_done` is said to check F-164, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm gmail_a_contacts_page_lists_the_mail_exchanged_with_them` is said to check F-165, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm outlook_a_contacts_page_lists_the_mail_exchanged_with_them` is said to check F-165, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `mail_events gmail_received_and_sent_mail_is_published_once` is said to check F-175, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `mail_events outlook_received_and_sent_mail_is_published_once` is said to check F-175, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm gmail_a_correspondent_joins_the_crm_once` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm gmail_a_correspondent_leaves_the_crm_with_their_mail` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm outlook_a_correspondent_joins_the_crm_once` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `email_policy gmail_replaced_policy_history_is_generation_bound` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `email_policy outlook_replaced_policy_history_is_generation_bound` is said to check F-176, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments gmail_attachment_on_a_draft_downloads` is said to check F-185, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `attachments outlook_attachment_on_a_draft_downloads` is said to check F-185, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_confirming_the_share_gives_both_users_the_inbox` is said to check F-005, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_confirming_the_share_gives_both_users_the_inbox` is said to check F-005, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_account gmail_health_check_tells_healthy_from_revoked` is said to check F-012, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_from_list_is_the_verified_aliases_and_follows_gmail` is said to check F-015, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists gmail_choosing_an_inbox_lists_only_its_threads` is said to check F-033, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `lists outlook_choosing_an_inbox_lists_only_its_threads` is said to check F-033, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels outlook_a_star_set_in_macro_reaches_outlook` is said to check F-074, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_not_junk_returns_to_the_inbox` is said to check F-078, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_not_junk_returns_to_the_inbox` is said to check F-078, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_a_property_set_on_a_thread_is_kept` is said to check F-088, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise outlook_a_property_set_on_a_thread_is_kept` is said to check F-088, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup gmail_remind_me_if_no_reply` is said to check F-092, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_followup outlook_remind_me_if_no_reply` is said to check F-092, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels gmail_a_refused_label_deletion_is_reported_until_it_goes_through` is said to check F-180, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_labels outlook_a_refused_label_deletion_is_reported_until_it_goes_through` is said to check F-180, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_junk_is_filed_under_spam` is said to check F-197, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance gmail_abandoned_sign_in_is_swept` is said to check F-006, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance outlook_abandoned_sign_in_is_swept` is said to check F-006, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_keeping_my_version_of_a_conflicting_draft_overwrites_outlooks` is said to check F-120, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_drafts outlook_taking_outlooks_version_of_a_conflicting_draft_brings_it_into_macro` is said to check F-120, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_from_switch gmail_draft_written_in_gmail_and_moved_is_settled_by_keeping_the_original` is said to check F-120, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_composer gmail_from_list_is_the_verified_aliases_and_follows_gmail` is said to check F-138, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `send_attempt outlook_sweep_delivers_a_send_whose_queue_message_was_lost` is said to check F-147, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares gmail_a_forwarded_event_is_added_to_the_calendar_from_its_mail` is said to check F-156, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares outlook_a_forwarded_event_is_added_to_the_calendar_from_its_mail` is said to check F-156, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_connect gmail_turning_a_syncing_calendar_off_stops_googles_pushes` is said to check F-157, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking gmail_deleting_the_account_removes_its_inbox_and_mail` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_linking outlook_deleting_the_account_removes_its_inbox_and_mail` is said to check F-172, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance gmail_bounced_and_reported_addresses_are_suppressed` is said to check F-173, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance outlook_bounced_and_reported_addresses_are_suppressed` is said to check F-173, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares gmail_a_forwarded_event_arrives_with_its_file` is said to check F-194, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `calendar_shares outlook_a_forwarded_event_arrives_with_its_file` is said to check F-194, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `sync_backfill gmail_a_cancelled_import_stops_reading_the_mailbox` is said to check F-195, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `maintenance gmail_hourly_maintenance_finds_a_revoked_grant` is said to check F-012, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `state_contacts outlook_a_contacts_photo_shows_in_macro` is said to check F-026, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `journey_organise gmail_junk_leaves_the_inbox` is said to check F-197, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools gmail_agent_reports_spam_and_takes_it_back` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `ai_tools outlook_agent_reports_spam_and_takes_it_back` is said to check F-170, and no record shows it performing the function
- crates/email_e2e/coverage/checks.tsv: `crm outlook_a_correspondent_leaves_the_crm_with_their_mail` is said to check F-176, and no record shows it performing the function

### Dead code candidates

Entry points waived because nothing in the repository calls them.

| Entry point | Source | Reason |
| --- | --- | --- |
| `queue gmail-ops:DeleteLabel` | `crates/models_email/src/gmail/gmail_ops.rs:28` | unreachable: candidate for removal (the handler has no sender: nothing in the repository builds this message) |
| `http GET /internal/messages/{id}` | `services/email_service/src/api/internal.rs:17` | unreachable: candidate for removal (no client in the repository requests this internal route) |
| `http POST /internal/messages/batch` | `services/email_service/src/api/internal.rs:18` | unreachable: candidate for removal (no client in the repository requests this internal route) |
| `http GET /internal/threads/{id}/messages` | `services/email_service/src/api/internal.rs:24` | unreachable: candidate for removal (no client in the repository requests this internal route) |
| `http GET /internal/threads/{id}/owner` | `services/email_service/src/api/internal.rs:32` | unreachable: candidate for removal (no client in the repository requests this internal route) |
| `graphql GraphqlSoupEmailThread.latestContentMessage` | `crates/complete_graph/src/edges.rs:706` | unreachable: candidate for removal (no client document selects the field; only the crates' own tests do) |
| `graphql GraphqlUser.emailLabels` | `crates/graphql_email/src/user_query.rs:45` | unreachable: candidate for removal (no client document selects the field; the app lists labels through GET /email/labels) |
| `graphql CompleteMutationRoot.sendEmailMessage` | `crates/graphql_email/src/mutation.rs:894` | unreachable: candidate for removal (clients send through sendEmailAttempt, which the app only aliases to this name) |
| `graphql CompleteMutationRoot.resolveEmailMessageOperation` | `crates/graphql_email/src/mutation.rs:755` | unreachable: candidate for removal (the app and the SDK resolve an operation through POST /email/drafts/{id}/resolve) |
| `http POST /internal/backfill/provider/gmail` | `services/email_service/src/api/internal.rs:28` | unreachable: candidate for removal (no client in the repository requests this internal route; a backfill starts from POST /email/init) |
| `http GET /internal/backfill/provider/gmail/{id}` | `services/email_service/src/api/internal.rs:30` | unreachable: candidate for removal (no client in the repository requests this internal route; the app reads GET /email/backfill/gmail/{id}) |
| `http DELETE /internal/backfill/provider/gmail` | `services/email_service/src/api/internal.rs:29` | unreachable: candidate for removal (no client in the repository requests this internal route; the app cancels through DELETE /email/backfill/gmail) |
| `http DELETE /internal/delete_user/{id}` | `services/email_service/src/api/internal.rs:31` | unreachable: candidate for removal (no client in the repository requests this internal route; account deletion puts DeleteUser on the queue itself) |
| `queue backfill:BackfillMessage` | `crates/models_email/src/email/service/backfill.rs:75` | unreachable: candidate for removal (the handler has no sender: a backfill writes whole threads, and nothing builds this message any more) |
| `queue backfill:DepopulateCrmContact` | `crates/models_email/src/email/service/backfill.rs:106` | unreachable: candidate for removal (the handler has no sender: the nightly CRM cleanup replaced the fan-out that built this message) |
| `queue gmail-ops:BlockSender` | `crates/models_email/src/gmail/gmail_ops.rs:30` | unreachable: candidate for removal (the port method that queues it has no caller: blocking writes the Gmail filter directly) |
| `queue gmail-ops:UnblockSender` | `crates/models_email/src/gmail/gmail_ops.rs:32` | unreachable: candidate for removal (the port method that queues it has no caller: unblocking deletes the Gmail filter directly) |

### Counted with the calendar functions

Entry points the calendar functions call, not email's: counted there, and in none of the totals above.

| Entry point | Source | Gmail | Outlook |
| --- | --- | --- | --- |
| `provider gmail:calendarList.list` | `crates/gmail_emulator/src/fault.rs:131` | not reached | n/a |
| `provider gmail:events.delete` | `crates/gmail_emulator/src/fault.rs:152` | not reached | n/a |
| `provider gmail:events.get` | `crates/gmail_emulator/src/fault.rs:137` | not reached | n/a |
| `provider gmail:events.insert` | `crates/gmail_emulator/src/fault.rs:143` | not reached | n/a |
| `provider gmail:events.instances` | `crates/gmail_emulator/src/fault.rs:140` | not reached | n/a |
| `provider gmail:events.list` | `crates/gmail_emulator/src/fault.rs:134` | not reached | n/a |
| `provider gmail:events.patch` | `crates/gmail_emulator/src/fault.rs:149` | not reached | n/a |
| `provider gmail:events.watch` | `crates/gmail_emulator/src/fault.rs:155` | not reached | n/a |
| `provider outlook:calendarView.delta` | `crates/outlook_emulator/src/fault.rs:142` | n/a | not reached |
| `provider outlook:calendarView.list` | `crates/outlook_emulator/src/fault.rs:145` | n/a | not reached |
| `provider outlook:calendars.get` | `crates/outlook_emulator/src/fault.rs:139` | n/a | not reached |
| `provider outlook:calendars.list` | `crates/outlook_emulator/src/fault.rs:136` | n/a | not reached |
| `provider outlook:events.create` | `crates/outlook_emulator/src/fault.rs:157` | n/a | not reached |
| `provider outlook:events.delete` | `crates/outlook_emulator/src/fault.rs:163` | n/a | not reached |
| `provider outlook:events.get` | `crates/outlook_emulator/src/fault.rs:151` | n/a | not reached |
| `provider outlook:events.instances` | `crates/outlook_emulator/src/fault.rs:154` | n/a | not reached |
| `provider outlook:events.list` | `crates/outlook_emulator/src/fault.rs:148` | n/a | not reached |
| `provider outlook:events.respond` | `crates/outlook_emulator/src/fault.rs:167` | n/a | not reached |
| `provider outlook:events.update` | `crates/outlook_emulator/src/fault.rs:160` | n/a | not reached |

<details><summary>Every backend function (143 of 164 not proved on a provider)</summary>

| Function | | Gmail | Outlook |
| --- | --- | --- | --- |
| F-001 | Connect a Gmail inbox | performed | n/a |
| F-002 | Connect an Outlook inbox | n/a | performed |
| F-003 | Connect an Outlook inbox that needs administrator approval | deferred | deferred |
| F-004 | Connect a second inbox to the same account | performed | performed |
| F-005 | Share an inbox another user already connected | open | open |
| F-006 | Cancel or fail the provider consent and return to the app | open | open |
| F-007 | Reconnect an inbox whose access expired or was revoked | open | open |
| F-008 | Enable a disabled inbox | performed | performed |
| F-009 | Remove an inbox (own: clears its mail; shared: removes access) | open | open |
| F-011 | Link Gmail automatically on Google sign-in | performed | n/a |
| F-012 | Refresh provider access tokens | open | open |
| F-013 | Renew the provider's change notifications (Gmail watch, Outlook subscriptions) | open | open |
| F-014 | Show inbox health and prompt to reconnect | open | open |
| F-015 | Send-as aliases: list them and keep them in sync | open | n/a |
| F-016 | Import existing mail when an inbox is connected (backfill) | open | performed |
| F-017 | Receive a new message from the provider | performed | performed |
| F-018 | Show a new message in the open list without reloading | performed | performed |
| F-019 | Pick up a change made in the provider's own client (read, archive, star, trash, label) | open | open |
| F-020 | Pick up a message deleted at the provider | open | open |
| F-021 | Pick up a draft created or changed at the provider | open | open |
| F-022 | Pick up mail sent from the provider's own client | open | open |
| F-023 | Force a sync of an inbox | open | open |
| F-024 | Recover after missed or failed provider notifications | performed | open |
| F-025 | Thread messages into conversations | performed | performed |
| F-026 | Sync the provider address book into contacts | performed | performed |
| F-027 | Classify mail as Focus, Signal or Noise | proved | proved |
| F-028 | Index mail for search | performed | performed |
| F-029 | Open the Inbox and switch between Focus, Signal and Noise | performed | performed |
| F-030 | Open a mailbox tab: Drafts, Sent, Scheduled, All mail, Archived, Starred | open | open |
| F-031 | Open Spam and Trash | open | open |
| F-032 | Open Shared with me | deferred | deferred |
| F-033 | Choose which inboxes or alias the list shows | open | open |
| F-034 | Filter the list by read state, done state, star, attachments, people, tags, importance, activity | open | open |
| F-035 | Sort the list | open | open |
| F-036 | Page through a long list (load more) | open | open |
| F-037 | Refresh the list | performed | performed |
| F-041 | See a thread's row: sender, subject, snippet, time, unread, star, attachment, draft and count marks | performed | performed |
| F-042 | See the unread badge on Mail | deferred | deferred |
| F-044 | Undo the last list action | open | open |
| F-045 | Create a saved view from filters | deferred | deferred |
| F-046 | Open a saved view | open | open |
| F-047 | Edit, rename or duplicate a saved view | deferred | deferred |
| F-048 | Delete a saved view | deferred | deferred |
| F-049 | Reorder saved views | deferred | deferred |
| F-050 | Search mail by text from the list | open | open |
| F-051 | Search mail from global search and Cmd+K and open a result | open | open |
| F-052 | Open a thread at the message a search hit names | performed | performed |
| F-053 | Open a thread | performed | performed |
| F-055 | Open a thread from a link, mention or notification | performed | performed |
| F-056 | Read a message: sanitized HTML body, plain text, inline images | open | open |
| F-057 | Load remote images through the image proxy | deferred | deferred |
| F-060 | Read a long thread (hidden middle messages, expand all) | open | open |
| F-064 | Download a message as .eml | open | open |
| F-066 | See read receipts for sent mail | open | open |
| F-067 | Turn read receipts on or off for an inbox | open | open |
| F-068 | Mark a thread read | open | open |
| F-069 | Mark a thread unread | open | open |
| F-070 | Mark a thread read automatically when it is opened | open | open |
| F-071 | Mark a thread done (archive) | open | open |
| F-072 | Mark a thread not done (back to the inbox) | open | open |
| F-073 | Star a thread | open | open |
| F-074 | Unstar a thread | open | open |
| F-075 | Move a thread to Trash | open | open |
| F-076 | Restore a thread from Trash | open | open |
| F-078 | Report a thread as not spam | open | open |
| F-079 | Mute and unmute a thread's notifications | deferred | deferred |
| F-080 | Block a sender | open | open |
| F-081 | Set a sender to Signal or Noise | performed | performed |
| F-082 | Act on several selected threads at once (done, read, star, trash, tag) | open | open |
| F-083 | Undo an action from its toast | open | open |
| F-084 | Add and remove a tag on a thread | open | open |
| F-086 | Change a thread's provider labels or folder | open | open |
| F-087 | Move a thread to a folder or project in Macro | open | open |
| F-088 | Edit a thread's properties in the side panel | open | open |
| F-089 | List the provider's labels and folders | open | open |
| F-090 | Set a reminder on a thread (preset, typed time, if no reply or regardless) | open | open |
| F-091 | Change or remove a reminder | open | open |
| F-092 | See reminders in the Reminders tab | open | open |
| F-093 | A due reminder brings the thread back and notifies | open | open |
| F-094 | A reply cancels an if-no-reply reminder | performed | performed |
| F-097 | Add recipients by typing, pasting or picking a suggestion | open | open |
| F-098 | Remove a recipient and move one between To, Cc and Bcc | open | open |
| F-099 | Add Cc and Bcc recipients | open | open |
| F-100 | Choose the sending inbox or alias | open | open |
| F-101 | Write the subject | open | open |
| F-102 | Write the body | open | open |
| F-103 | Format the body (bold, italic, lists, quote, code, highlight) | open | open |
| F-104 | Insert and edit a link | open | open |
| F-105 | Insert an inline image | open | open |
| F-106 | Mention a person or a document in the body | deferred | deferred |
| F-107 | Send with the signature, or without it | open | open |
| F-108 | Reply to a message | open | open |
| F-109 | Reply to all | open | open |
| F-110 | Forward a message | open (known bug forward-sent-as-reply) | open (known bug forward-sent-as-reply) |
| F-111 | Include or leave out the quoted original | open | open |
| F-114 | Create a calendar event from a draft or thread | deferred | deferred |
| F-115 | Save a draft automatically while typing | open | open |
| F-116 | Reopen a draft from Drafts and keep editing | open | open |
| F-117 | Keep a reply draft with its thread and reopen it there | open | open |
| F-119 | Discard a draft | open | open |
| F-120 | See and resolve a draft that failed to save or conflicts with the mailbox | open | open |
| F-122 | Attach a file to a message (picker, drop, paste) | open | open |
| F-123 | Remove an attachment from a draft | open | open |
| F-124 | Forward a message with its attachments | open | open |
| F-125 | Share a file too large to attach as a link | deferred | deferred |
| F-126 | Open and preview a received attachment | open | open |
| F-127 | Download a received attachment | open | open |
| F-128 | Save a received attachment to Drive | open | open |
| F-130 | Clean up stored files of discarded drafts | open (known bug outlook-discarded-draft-file-kept) | open (known bug outlook-discarded-draft-file-kept) |
| F-131 | Send a new message | open | open |
| F-132 | Send a reply in its thread with the right headers | open | open |
| F-133 | Send and mark done | open | open |
| F-134 | Undo send | open | open |
| F-135 | See that a message is sending, sent or failed | open | open |
| F-136 | Retry or cancel a failed or queued send and get the draft back | open | open |
| F-137 | Send exactly once across retries, reloads and two tabs | open | open |
| F-138 | Send from an alias | open | n/a |
| F-140 | Handle a bounce or a provider rejection | performed | performed |
| F-141 | Reply on a thread shared by a teammate | open | open |
| F-142 | Schedule a message for later (preset, typed, custom time) | open | open |
| F-143 | Change the time of a scheduled message | open | open |
| F-144 | Cancel a scheduled message back to a draft | open | open |
| F-145 | See scheduled messages in the Scheduled tab | open | open |
| F-146 | Deliver a scheduled message when it is due | open | open |
| F-147 | Report and recover a scheduled send that failed | open | open |
| F-148 | Write and save a signature | open | open |
| F-149 | Edit a signature as rich text or HTML and preview it | open | open |
| F-150 | Clear a signature | open | open |
| F-151 | Import the signature from Gmail | open | n/a |
| F-152 | Choose whether replies and forwards get the signature | open | open |
| F-153 | See an invitation card in a thread | open | open |
| F-154 | RSVP to an invitation from the thread | deferred | deferred |
| F-156 | Add a forwarded invitation to the calendar | open | open |
| F-157 | Turn calendar access on or off for an inbox | open | open |
| F-158 | Share a thread with people or channels and set their access | deferred | deferred |
| F-159 | Open a thread shared by someone else | performed | performed |
| F-160 | Request and grant access to a thread | deferred | deferred |
| F-161 | Notify about a new email (push, in-app, Mail badge) | deferred | deferred |
| F-162 | Turn new-email notifications and the digest on or off | deferred | deferred |
| F-163 | Open the thread from a notification | performed | performed |
| F-164 | See and act on mail from Home (open, mark done) | open | open |
| F-165 | Compose an email to a CRM contact and see their mail | open | open |
| F-166 | Draft or send an email from the universal input | open | open |
| F-167 | Create a task or ask the assistant about a thread | open | open |
| F-168 | Assistant drafts an email the user edits and sends from a card | open | open |
| F-169 | Assistant reads threads and attachments | open | open |
| F-170 | Assistant lists inboxes and labels and changes a thread's labels | open | open |
| F-171 | Assistant sets a sender policy | open | open |
| F-172 | Remove a user's mail and links when the account is deleted | open | open |
| F-173 | Stop sending to addresses that bounced or complained | open | open |
| F-174 | Enforce the plan's inbox entitlement | performed | performed |
| F-175 | Feed mail events to activity, routines and suggestions | performed | performed |
| F-176 | Enrich CRM contacts from mail and clean up after removal | performed | performed |
| F-180 | See that a change is waiting for, or was refused by, the mailbox | open | open |
| F-185 | Open and preview an attachment on a draft | open | open |
| F-188 | See a thread's details in the side panel (activity, references, dates) | deferred | deferred |
| F-189 | See the connected inboxes in Settings (provider, primary or shared, loading and failed states) | performed | performed |
| F-191 | Mention an email thread in a document, message or chat | deferred | deferred |
| F-192 | Exclude domains from the mail shared with CRM | deferred | deferred |
| F-193 | Create and delete a provider label | open | open |
| F-194 | Forward a calendar event by email | open | open |
| F-195 | Cancel a running mail import | open | n/a |
| F-196 | Unblock a sender | open | open |
| F-197 | Report a thread as spam | open | open |

</details>

<details><summary>201 entry points no scenario reaches on a provider</summary>

| Entry point | Gmail | Outlook |
| --- | --- | --- |
| `elsewhere document_storage_service DELETE /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}` | open | open |
| `elsewhere document_storage_service GET /reminders/email/collection` | open | open |
| `elsewhere document_storage_service GET /reminders/email/{thread_id}` | open | open |
| `elsewhere document_storage_service POST /items/soup/ast` | open | open |
| `elsewhere document_storage_service POST /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}` | open | open |
| `elsewhere document_storage_service POST /properties/tags` | open | open |
| `elsewhere document_storage_service POST /search` | open | open |
| `elsewhere document_storage_service PUT /properties/entities/{entity_type}/{entity_id}/{property_id}` | open | open |
| `elsewhere document_storage_service PUT /reminders/email/{thread_id}` | open | open |
| `gateway refresh_email:Backfill` | open | n/a |
| `gateway refresh_email:BackfillProgress` | covered | open |
| `gateway refresh_email:DeleteMessage` | open | n/a |
| `gateway refresh_email:LinkRemoved` | open | open |
| `gateway refresh_email:PhotoSynced` | waived | open |
| `gateway refresh_email:UpdateLabels` | open | n/a |
| `graphql CompleteMutationRoot.cancelEmailSend` | open | open |
| `graphql CompleteMutationRoot.deleteEmailDraft` | open | open |
| `graphql CompleteMutationRoot.markEmailThreadSeen` | open | open |
| `graphql CompleteMutationRoot.markEmailThreadUnread` | open | open |
| `graphql CompleteMutationRoot.saveEmailDraft` | open | open |
| `graphql CompleteMutationRoot.sendEmailAttempt` | open | open |
| `graphql CompleteMutationRoot.setEmailThreadArchived` | open | open |
| `graphql CompleteMutationRoot.setEmailThreadState` | open | open |
| `graphql CompleteMutationRoot.setEmailThreadsArchived` | open | open |
| `graphql CompleteMutationRoot.updateEmailThreadLabel` | open | open |
| `graphql GraphqlEmailLink.sendAs` | open | open |
| `graphql GraphqlSoupEmailThread.hasReceivedMail` | open | open |
| `graphql GraphqlSoupEmailThread.latestInboundMessageTs` | open | open |
| `graphql GraphqlSoupEmailThread.latestNonSpamMessageTs` | open | open |
| `graphql GraphqlSoupEmailThread.latestOutboundMessageTs` | open | open |
| `graphql GraphqlSoupEmailThread.linkId` | open | open |
| `graphql GraphqlSoupEmailThread.mailAllPreview` | open | open |
| `graphql GraphqlSoupEmailThread.mailDraftPreview` | open | open |
| `graphql GraphqlSoupEmailThread.mailDraftState` | open | open |
| `graphql GraphqlSoupEmailThread.mailSentPreview` | open | open |
| `graphql GraphqlSoupEmailThread.messages` | open | open |
| `graphql GraphqlSoupEmailThread.reminderReturnedAt` | open | open |
| `graphql GraphqlUser.emailLinks` | open | open |
| `graphql GraphqlUser.emailSendAttempt` | open | open |
| `graphql GraphqlUser.pendingEmailSends` | open | open |
| `http DELETE /email/backfill/gmail` | open | n/a |
| `http DELETE /email/drafts/scheduled/{message_id}` | open | open |
| `http DELETE /email/drafts/{id}` | open | open |
| `http DELETE /email/drafts/{id}/attachments/{attachment_id}` | open | open |
| `http DELETE /email/drafts/{id}/forwarded-attachments/{attachment_id}` | open | open |
| `http DELETE /email/filters/{id}` | open | open |
| `http DELETE /email/labels/{id}` | open | open |
| `http DELETE /email/links/{link_id}` | open | open |
| `http DELETE /email/links/{link_id}/calendar` | open | open |
| `http DELETE /email/sync` | open | open |
| `http GET /email/attachments/{id}` | open | open |
| `http GET /email/attachments/{id}/document_id` | open | open |
| `http GET /email/backfill/gmail` | open | n/a |
| `http GET /email/backfill/gmail/active` | open | n/a |
| `http GET /email/backfill/gmail/{id}` | open | n/a |
| `http GET /email/contacts` | open | open |
| `http GET /email/contacts/blocked` | open | open |
| `http GET /email/drafts/scheduled` | open | open |
| `http GET /email/drafts/{id}/operation` | open | open |
| `http GET /email/filters` | open | open |

The rest are in the report artifact.

</details>
