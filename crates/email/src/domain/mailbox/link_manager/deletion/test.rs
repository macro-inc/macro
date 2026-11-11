use super::*;
use crate::domain::mailbox::link_manager::test::events::{Output, assert_event};
use email_api_client::domain::models::EmailApiError;
use fakes::*;
use tracing::instrument::WithSubscriber;

mod fakes;

#[tokio::test]
async fn deletion_keeps_effect_order_payloads_default_pacing_and_held_connection() {
    let (service, fake) = service();
    service
        .delete(&link(), &DeletionReason::Unused)
        .await
        .unwrap();
    let calls = fake.calls();
    assert_eq!(calls, expected_calls("unused", false));
}

#[tokio::test]
async fn every_reason_reaches_history_and_the_disconnected_event_unchanged() {
    for (reason, text) in [
        (DeletionReason::Unused, "unused"),
        (DeletionReason::Inactive, "inactive"),
        (DeletionReason::ManuallyDisabled, "manually_disabled"),
        (DeletionReason::UserDeleted, "user_deleted"),
        (DeletionReason::AccessRevoked, "access_revoked"),
    ] {
        let (service, fake) = service();
        service.delete(&link(), &reason).await.unwrap();
        assert_eq!(fake.calls(), expected_calls(text, false));
    }
}

#[tokio::test]
async fn mark_and_purge_errors_stop_at_the_same_boundary_with_original_context() {
    for (point, context, count) in [
        ("mark", "Failed to mark link as deleting", 1),
        ("purge", "Failed to purge link in background task", 8),
    ] {
        let (service, fake) = service();
        fake.0.lock().unwrap().fail.insert(point);
        let error = service
            .delete(&link(), &DeletionReason::Unused)
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), context);
        assert_eq!(error.downcast_ref::<Failure>().unwrap().0, point);
        assert_eq!(format!("{error:#}"), format!("{context}: {point}"));
        assert_eq!(fake.calls(), expected_calls("unused", false)[..count]);
    }
}

#[tokio::test]
async fn each_best_effort_failure_still_reaches_later_effects() {
    for point in [
        "cancel",
        "cache",
        "unlink",
        "crm_delete",
        "event",
        "history",
        "stub",
    ] {
        let (service, fake) = service();
        {
            let mut state = fake.0.lock().unwrap();
            state.fail.insert(point);
            state.minted = Some(MINTED);
        }
        service
            .delete(&link(), &DeletionReason::Unused)
            .await
            .unwrap();
        assert_eq!(fake.calls(), expected_calls("unused", true), "{point}");
    }
}

#[tokio::test]
async fn team_absence_and_lookup_failure_skip_only_crm_depopulation() {
    for failure in [false, true] {
        let (service, fake) = service();
        {
            let mut state = fake.0.lock().unwrap();
            state.team = None;
            if failure {
                state.fail.insert("team");
            }
        }
        service
            .delete(&link(), &DeletionReason::Unused)
            .await
            .unwrap();
        let expected: Vec<_> = expected_calls("unused", false)
            .into_iter()
            .filter(|call| !matches!(call, Call::CrmDelete(..)))
            .collect();
        assert_eq!(fake.calls(), expected);
    }
}

#[tokio::test]
async fn promoted_cleanup_acquisition_and_delete_failures_are_distinct_and_best_effort() {
    for point in ["acquire", "promoted"] {
        let (service, fake) = service();
        {
            let mut state = fake.0.lock().unwrap();
            state.fail.insert(point);
            state.minted = Some(MINTED);
        }
        service
            .delete(&link(), &DeletionReason::Unused)
            .await
            .unwrap();
        let expected = expected_calls("unused", false);
        if point == "acquire" {
            assert_eq!(fake.calls(), expected[..expected.len() - 2]);
        } else {
            assert_eq!(fake.calls(), expected);
        }
        assert!(!fake.0.lock().unwrap().held);
    }
}

#[tokio::test]
async fn promoted_cleanup_uses_the_minted_id_even_when_the_link_points_elsewhere() {
    for matches in [false, true] {
        let (service, fake) = service();
        fake.0.lock().unwrap().minted = Some(MINTED);
        let mut link = link();
        if matches {
            link.fusionauth_user_id = MINTED.to_string();
        }
        service
            .delete(&link, &DeletionReason::Unused)
            .await
            .unwrap();
        let calls = fake.calls();
        assert_eq!(
            &calls[calls.len() - 3..],
            [
                Call::Promoted(OWNER.into()),
                Call::Stub(MINTED.to_string()),
                Call::Release,
            ]
        );
    }
}

#[tokio::test(start_paused = true)]
async fn gmail_stop_retries_before_cache_eviction_and_keeps_real_backoff_values() {
    for succeeds in [false, true] {
        let (service, fake) = service();
        {
            let mut state = fake.0.lock().unwrap();
            state.stop_results.extend([
                Err(EmailApiError::Transient {
                    message: "one".into(),
                }),
                Err(EmailApiError::Transient {
                    message: "two".into(),
                }),
                if succeeds {
                    Ok(())
                } else {
                    Err(EmailApiError::Transient {
                        message: "three".into(),
                    })
                },
            ]);
        }
        service
            .delete(&link(), &DeletionReason::Unused)
            .await
            .unwrap();
        let mut expected = expected_calls("unused", false);
        expected.splice(2..2, [Call::Stop(LINK), Call::Stop(LINK)]);
        assert_eq!(fake.calls(), expected);
        let state = fake.0.lock().unwrap();
        assert_eq!(state.stop_times.len(), 3);
        assert_eq!(
            state.stop_times[1] - state.stop_times[0],
            std::time::Duration::from_millis(200)
        );
        assert_eq!(
            state.stop_times[2] - state.stop_times[1],
            std::time::Duration::from_millis(400)
        );
    }
}

#[tokio::test]
async fn permanent_stop_errors_continue_without_retry_and_outlook_skips_all_gmail_effects() {
    for error in [
        EmailApiError::AuthRequired,
        EmailApiError::Forbidden,
        EmailApiError::Permanent {
            message: "gone".into(),
        },
    ] {
        let (service, fake) = service();
        fake.0.lock().unwrap().stop_results.push_back(Err(error));
        service
            .delete(&link(), &DeletionReason::Unused)
            .await
            .unwrap();
        assert_eq!(fake.calls(), expected_calls("unused", false));
    }
    let (service, fake) = service();
    let mut link = link();
    link.provider = models_email::service::link::UserProvider::Outlook;
    service
        .delete(&link, &DeletionReason::Unused)
        .await
        .unwrap();
    let expected: Vec<_> = expected_calls("unused", false)
        .into_iter()
        .filter(|call| !matches!(call, Call::Stop(..) | Call::Cache(..) | Call::Unlink(..)))
        .collect();
    assert_eq!(fake.calls(), expected);
}

#[tokio::test]
async fn no_team_emits_exactly_one_debug_event_inside_handle_delete_and_other_results_emit_none() {
    for outcome in ["none", "some", "error"] {
        let (service, fake) = service();
        {
            let mut state = fake.0.lock().unwrap();
            if outcome != "some" {
                state.team = None;
            }
            if outcome == "error" {
                state.fail.insert("team");
            }
        }
        let output = Output::default();
        service
            .delete(&link(), &DeletionReason::Unused)
            .with_subscriber(output.subscriber())
            .await
            .unwrap();
        let message = "User has no team; skipping CRM teardown before link delete";
        if outcome == "none" {
            assert_event(&output, tracing::Level::DEBUG, message, "handle_delete", []);
        } else {
            assert_eq!(output.count(message), 0);
        }
    }
}

#[tokio::test]
async fn best_effort_errors_keep_their_messages_fields_and_span() {
    for (point, level, message, mut fields) in [
        (
            "cancel",
            tracing::Level::ERROR,
            "Failed to update backfill job statuses",
            vec![("error", "cancel".into())],
        ),
        (
            "cache",
            tracing::Level::WARN,
            "Failed to delete Gmail access token",
            vec![("error", "cache".into())],
        ),
        (
            "unlink",
            tracing::Level::WARN,
            "Failed to remove FusionAuth IdP link",
            vec![("error", "Failure(\"unlink\")".into())],
        ),
        (
            "team",
            tracing::Level::ERROR,
            "Failed to look up team for CRM teardown before link delete",
            vec![
                ("error", "InvalidRequest(\"team\")".into()),
                ("link_id", LINK.to_string()),
            ],
        ),
        (
            "crm_delete",
            tracing::Level::ERROR,
            "Failed to depopulate CRM rows before link delete; orphan crm_contacts/crm_companies may remain",
            vec![
                ("error", "InvalidRequest(\"crm_delete\")".into()),
                ("team_id", TEAM.to_string()),
                ("link_id", LINK.to_string()),
            ],
        ),
        (
            "event",
            tracing::Level::ERROR,
            "failed to publish email macro event",
            vec![("error", "Publish(\"event\")".into())],
        ),
        (
            "history",
            tracing::Level::ERROR,
            "Failed to set deleted_at on email link history",
            vec![("error", "history".into()), ("link_id", LINK.to_string())],
        ),
        (
            "acquire",
            tracing::Level::ERROR,
            "Failed to acquire connection for promoted mailbox cleanup",
            vec![("error", "Failure(\"acquire\")".into())],
        ),
        (
            "promoted",
            tracing::Level::ERROR,
            "Failed to delete minted user for promoted shared mailbox",
            vec![("error", "promoted".into())],
        ),
        (
            "stub",
            tracing::Level::ERROR,
            "Failed to delete FusionAuth stub for promoted shared mailbox",
            vec![("error", "Failure(\"stub\")".into())],
        ),
    ] {
        let (service, fake) = service();
        {
            let mut state = fake.0.lock().unwrap();
            state.fail.insert(point);
            state.minted = Some(MINTED);
        }
        let output = Output::default();
        service
            .delete(&link(), &DeletionReason::Unused)
            .with_subscriber(output.subscriber())
            .await
            .unwrap();
        if let Some(native_error) = fake.0.lock().unwrap().errors.get(point) {
            // Compare the complete original Debug, including its backtrace when enabled.
            fields
                .iter_mut()
                .find(|(name, _)| *name == "error")
                .unwrap()
                .1 = native_error.clone();
        }
        assert_event(&output, level, message, "handle_delete", fields);
    }
}

#[tokio::test]
async fn promoted_id_warning_is_conditional_and_has_both_ids() {
    for matches in [false, true] {
        let (service, fake) = service();
        fake.0.lock().unwrap().minted = Some(MINTED);
        let mut link = link();
        if matches {
            link.fusionauth_user_id = MINTED.to_string();
        }
        let output = Output::default();
        service
            .delete(&link, &DeletionReason::Unused)
            .with_subscriber(output.subscriber())
            .await
            .unwrap();
        let message =
            "Promoted mailbox link did not point at its minted stub; deleting stub by minted id";
        if matches {
            assert_eq!(output.count(message), 0);
        } else {
            assert_event(
                &output,
                tracing::Level::WARN,
                message,
                "handle_delete",
                [
                    ("link_fusionauth_user_id", "credential-owner".into()),
                    ("minted_id", MINTED.to_string()),
                ],
            );
        }
    }
}
