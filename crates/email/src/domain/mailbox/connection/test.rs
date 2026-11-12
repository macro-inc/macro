use super::*;
use fixtures::*;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::{Layer, layer::SubscriberExt};
use uuid::Uuid;

mod fixtures;

#[tokio::test]
async fn recognized_provider_bypasses_legacy_cleanup_even_when_it_fails() {
    for failure in [None, Some("initialize"), Some("recognizes")] {
        let (service, fake) = service(Data {
            recognizes: true,
            fail: failure,
            ..Data::default()
        });
        let result = service.connect(request(true)).await;
        if failure.is_some() {
            assert!(matches!(
                result,
                Err(ConnectionError::MailboxInitialization(_))
            ));
        } else {
            assert_eq!(
                result.unwrap(),
                ConnectionOutcome {
                    link_id: LINK,
                    backfill_job_id: None
                }
            );
        }
        let expected = if failure == Some("recognizes") {
            vec!["recognizes"]
        } else {
            vec!["recognizes", "initialize"]
        };
        assert_eq!(fake.0.lock().unwrap().calls, expected);
    }
}

#[tokio::test]
async fn invalid_identity_stops_before_recognition_and_cleanup() {
    let (service, fake) = service(Data::default());
    let mut request = request(true);
    request.actor_fusion_id = "invalid".into();
    assert!(matches!(
        service.connect(request).await,
        Err(ConnectionError::InvalidUserIdentity)
    ));
    assert!(fake.0.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn unowned_incomplete_and_non_gmail_attempts_are_rejected_before_account_lookup() {
    for invalid in ["owner", "incomplete", "provider"] {
        let mut data = Data::default();
        match invalid {
            "owner" => data.attempt.owner = Uuid::from_u128(900),
            "incomplete" => data.attempt.email = None,
            _ => data.attempt.provider = "OUTLOOK".into(),
        }
        let (service, fake) = service(data);
        let error = service.connect(request(true)).await.unwrap_err();
        match invalid {
            "owner" => assert!(matches!(error, ConnectionError::AttemptOwnerMismatch)),
            "incomplete" => assert!(matches!(
                error,
                ConnectionError::AttemptAuthenticationIncomplete
            )),
            _ => assert!(matches!(error, ConnectionError::InvalidAttemptProvider)),
        }
        assert_eq!(
            fake.0.lock().unwrap().calls,
            ["recognizes", "attempt", "failure", "cleanup"]
        );
    }
}

#[tokio::test]
async fn delegation_commits_before_grant_and_never_starts_a_second_backfill() {
    let (service, fake) = service(Data {
        owner: Some("macro|child@example.com".into()),
        by_email: Some(link("macro|child@example.com")),
        ..Data::default()
    });
    assert_eq!(
        service.connect(request(true)).await.unwrap(),
        ConnectionOutcome {
            link_id: LINK,
            backfill_job_id: None
        }
    );
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_email",
            "delegate",
            "apply:false:",
            "consume",
            "clear_reauth"
        ]
    );
}

#[tokio::test]
async fn child_lookup_failures_preserve_context_and_stop_before_delegation_or_bootstrap() {
    for (failure, context) in [
        ("by_email", "Failed to look up child link before delegation"),
        (
            "child_fusion",
            "Failed to look up child's fusion id for self-link bootstrap",
        ),
    ] {
        let (service, fake) = service(Data {
            owner: Some("macro|child@example.com".into()),
            fail: Some(failure),
            ..Data::default()
        });
        let error = service.connect(request(true)).await.unwrap_err();
        let debug = format!("{error:?}");
        let ConnectionError::DatabaseError(source) = error else {
            panic!("expected database error, got {debug}");
        };
        assert_eq!(
            source.chain().map(ToString::to_string).collect::<Vec<_>>(),
            [context, "scripted failure"]
        );
        assert!(debug.contains(context), "{debug}");
        assert!(debug.contains("scripted failure"), "{debug}");
        let mut expected = vec!["recognizes", "attempt", "account", "by_email"];
        if failure == "child_fusion" {
            expected.push("child_fusion");
        }
        expected.extend(["failure", "cleanup"]);
        assert_eq!(fake.0.lock().unwrap().calls, expected);
    }
}

#[tokio::test]
async fn bootstrap_uses_the_child_credential_owner_and_starts_one_backfill() {
    let (service, fake) = service(Data {
        owner: Some("macro|child@example.com".into()),
        ..Data::default()
    });
    assert_eq!(
        service.connect(request(true)).await.unwrap(),
        ConnectionOutcome {
            link_id: LINK,
            backfill_job_id: Some(JOB)
        }
    );
    let data = fake.0.lock().unwrap();
    assert_eq!(
        data.calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_email",
            "child_fusion",
            "watch",
            "bootstrap",
            "apply:false:",
            "consume",
            "clear_reauth",
            "backfill"
        ]
    );
    let watched = data.watched.as_ref().unwrap();
    assert_eq!(watched.macro_id.as_ref(), "macro|child@example.com");
    assert_eq!(watched.fusionauth_user_id, Uuid::from_u128(5).to_string());
}

#[tokio::test]
async fn disappearing_child_is_not_provisioned_with_the_callers_identity() {
    let (service, fake) = service(Data {
        owner: Some("macro|child@example.com".into()),
        child_fusion: None,
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(true)).await,
        Err(ConnectionError::DatabaseError(_))
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_email",
            "child_fusion",
            "failure",
            "cleanup"
        ]
    );
}

#[tokio::test]
async fn shared_conflict_keeps_the_attempt_for_confirmation() {
    let (service, fake) = service(Data {
        by_email: Some(link("macro|owner@example.com")),
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(true)).await,
        Err(ConnectionError::SharedInboxConflict {
            existing_link_id: LINK,
            ..
        })
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_grant",
            "by_email",
            "failure"
        ]
    );
}

/// The mailbox has its own account, but an older inbox for it in another account holds
/// its Google grant, so the replaced grant never reached the caller. Provisioning a second
/// inbox would fail at the provider; init refuses before calling it.
#[tokio::test]
async fn own_mailbox_held_as_an_inbox_in_another_account_is_connected_elsewhere() {
    let (service, fake) = service(Data {
        owner: Some("macro|actor@example.com".into()),
        by_email: Some(link("macro|other@example.com")),
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(true)).await,
        Err(ConnectionError::MailboxConnectedElsewhere)
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_grant",
            "by_email",
            "failure",
            "cleanup"
        ]
    );
}

#[tokio::test]
async fn inbox_under_another_fusionauth_user_of_the_same_account_is_connected_elsewhere() {
    // The fake grant lookup ignores its arguments; leaving `by_grant` empty is what
    // models the caller's FusionAuth user not holding this inbox.
    let mut held = link("macro|actor@example.com");
    held.fusionauth_user_id = Uuid::from_u128(6).to_string();
    let (service, fake) = service(Data {
        by_email: Some(held),
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(true)).await,
        Err(ConnectionError::MailboxConnectedElsewhere)
    ));
    assert!(!fake.0.lock().unwrap().calls.contains(&"watch".into()));
}

#[tokio::test(start_paused = true)]
async fn promotion_is_durable_before_relocation_and_survives_its_failure() {
    for failure in [None, Some("relocate")] {
        let (service, fake) = service(Data {
            by_email: Some(link("macro|owner@example.com")),
            fail: failure,
            ..Data::default()
        });
        let mut request = request(true);
        request.force_share = true;
        assert_eq!(
            service.connect(request).await.unwrap(),
            ConnectionOutcome {
                link_id: LINK,
                backfill_job_id: None
            }
        );
        let mut expected = vec![
            "recognizes",
            "attempt",
            "account",
            "by_grant",
            "by_email",
            "organization",
            "promote",
            "relocate",
        ];
        if failure.is_none() {
            expected.push("update_owner");
        }
        expected.extend(["apply:false:", "consume", "clear_reauth"]);
        assert_eq!(fake.0.lock().unwrap().calls, expected);
    }
}

#[tokio::test(start_paused = true)]
async fn relocation_retries_only_the_owner_write_and_keeps_terminal_failure_best_effort() {
    for failures in [1, 2, 3] {
        let (service, fake) = service(Data {
            by_email: Some(link("macro|owner@example.com")),
            update_failures: failures,
            ..Data::default()
        });
        let mut request = request(true);
        request.force_share = true;
        assert!(service.connect(request).await.is_ok());
        let data = fake.0.lock().unwrap();
        assert_eq!(
            data.calls.iter().filter(|call| *call == "relocate").count(),
            1
        );
        assert_eq!(
            data.calls
                .iter()
                .filter(|call| *call == "update_owner")
                .count(),
            (failures + 1).min(3)
        );
        assert!(data.calls.ends_with(&[
            "apply:false:".into(),
            "consume".into(),
            "clear_reauth".into()
        ]));
    }
}

#[tokio::test(start_paused = true)]
async fn credential_owner_retry_backoff_totals_600ms_before_third_attempt_succeeds() {
    assert_credential_owner_retry_backoff(2, false).await;
}

#[tokio::test(start_paused = true)]
async fn credential_owner_retry_exhaustion_has_no_sleep_after_the_third_failure() {
    assert_credential_owner_retry_backoff(3, true).await;
}

async fn assert_credential_owner_retry_backoff(failures: usize, terminal_failure: bool) {
    let (service, fake) = service(Data {
        by_email: Some(link("macro|owner@example.com")),
        update_failures: failures,
        ..Data::default()
    });
    let mut request = request(true);
    request.force_share = true;
    let logs = Logs(Arc::new(Mutex::new(Vec::new())));
    let started = tokio::time::Instant::now();
    assert_eq!(
        service
            .connect(request)
            .with_subscriber(tracing_subscriber::registry().with(logs.clone()))
            .await
            .unwrap(),
        ConnectionOutcome {
            link_id: LINK,
            backfill_job_id: None,
        }
    );
    assert_eq!(started.elapsed(), std::time::Duration::from_millis(600));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_grant",
            "by_email",
            "organization",
            "promote",
            "relocate",
            "update_owner",
            "update_owner",
            "update_owner",
            "apply:false:",
            "consume",
            "clear_reauth",
        ]
    );
    let mut expected = [1, 2]
        .into_iter()
        .map(|attempt| Log {
            level: "WARN".into(),
            fields: BTreeMap::from([
                (
                    "message".into(),
                    "Retrying link fusionauth_user_id update after grant relocation".into(),
                ),
                ("error".into(), "FakeError(\"update\")".into()),
                ("attempt".into(), attempt.to_string()),
            ]),
        })
        .collect::<Vec<_>>();
    if terminal_failure {
        expected.push(Log {
            level: "ERROR".into(),
            fields: BTreeMap::from([
                (
                    "message".into(),
                    "Failed to re-home link fusionauth_user_id after grant relocation; inbox token fetches will fail until the link is re-homed to the shared user".into(),
                ),
                ("error".into(), "FakeError(\"update\")".into()),
                ("link_id".into(), LINK.to_string()),
                ("shared_fusionauth_user_id".into(), "shared-owner".into()),
            ]),
        });
    }
    let actual = logs
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|log| matches!(log.level.as_str(), "WARN" | "ERROR"))
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
}

#[tokio::test]
async fn an_existing_grant_applies_permissions_without_registering_a_watch() {
    let mut data = Data {
        by_grant: Some(link("macro|actor@example.com")),
        ..Data::default()
    };
    data.attempt.requested_scopes = calendar_events::domain::models::GOOGLE_CALENDAR_SCOPES
        .map(str::to_owned)
        .to_vec();
    let (service, fake) = service(data);
    let logs = Logs(Arc::new(Mutex::new(Vec::new())));
    assert_eq!(
        service
            .connect(request(true))
            .with_subscriber(tracing_subscriber::registry().with(logs.clone()))
            .await
            .unwrap(),
        ConnectionOutcome {
            link_id: LINK,
            backfill_job_id: None,
        }
    );
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "recognizes",
            "attempt",
            "account",
            "by_grant",
            "apply:true:",
            "consume",
            "clear_reauth"
        ]
    );
    let logs = logs.0.lock().unwrap();
    let upgrade = logs
        .iter()
        .find(|log| {
            log.fields.get("message").map(String::as_str)
                == Some("Applied Google permission upgrade to existing inbox")
        })
        .expect("permission upgrade is logged");
    assert_eq!(
        upgrade,
        &Log {
            level: "INFO".into(),
            fields: BTreeMap::from([
                (
                    "message".into(),
                    "Applied Google permission upgrade to existing inbox".into()
                ),
                ("link_id".into(), LINK.to_string()),
                ("grant_version".into(), "1".into()),
                ("changed".into(), "true".into()),
                ("calendar_jobs".into(), "0".into()),
            ]),
        }
    );
}

#[tokio::test]
async fn the_callers_existing_primary_inbox_is_a_noop_without_cleanup() {
    let (service, fake) = service(Data {
        by_identity: Some(link("macro|actor@example.com")),
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(false)).await,
        Err(ConnectionError::AlreadyInitialized)
    ));
    assert_eq!(fake.0.lock().unwrap().calls, ["by_identity", "failure"]);
}

#[tokio::test]
async fn failures_stop_at_the_correct_partial_state_and_cleanup_follows_reporting() {
    for failure in ["watch", "apply", "consume", "backfill"] {
        let (service, fake) = service(Data {
            fail: Some(failure),
            ..Data::default()
        });
        let result = service.connect(request(true)).await;
        if failure == "watch" {
            assert!(matches!(result, Err(ConnectionError::NoGmailGrant)));
        } else {
            assert!(result.is_err());
        }
        let data = fake.0.lock().unwrap();
        assert!(data.calls.ends_with(&["failure".into(), "cleanup".into()]));
        assert_eq!(data.calls.contains(&"create".into()), failure != "watch");
        assert_eq!(
            data.calls.contains(&"consume".into()),
            matches!(failure, "consume" | "backfill")
        );
        assert_eq!(
            data.calls.contains(&"clear_reauth".into()),
            failure == "backfill"
        );
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Log {
    level: String,
    fields: BTreeMap<String, String>,
}
#[derive(Clone)]
struct Logs(Arc<Mutex<Vec<Log>>>);
#[derive(Default)]
struct Fields(BTreeMap<String, String>);
impl tracing::field::Visit for Fields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let mut debug = format!("{value:?}");
        // Assert the complete diagnostic independently of process backtrace settings,
        // retaining any enclosing Debug enum delimiters after the trace.
        if field.name() == "error"
            && let Some((message, backtrace)) = debug.split_once("\n\nStack backtrace:")
        {
            let backtrace = backtrace.trim_end();
            let closing = &backtrace[backtrace.trim_end_matches(')').len()..];
            debug = format!("{message}{closing}");
        }
        self.0.insert(field.name().into(), debug);
    }
}
impl<S: tracing::Subscriber> Layer<S> for Logs {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        self.0.lock().unwrap().push(Log {
            level: event.metadata().level().to_string(),
            fields: fields.0,
        });
    }
}

#[tokio::test]
async fn discovery_preserves_every_outcome_call_order_and_warning() {
    for mode in [
        "recorded", "token", "scopes", "empty", "gmail", "calendar", "apply",
    ] {
        let data = Data {
            unrecorded: mode != "recorded",
            fail: match mode {
                "token" => Some("token"),
                "scopes" => Some("scopes"),
                "apply" => Some("apply"),
                _ => None,
            },
            scopes: if mode == "calendar" {
                calendar_events::domain::models::GOOGLE_CALENDAR_SCOPES
                    .map(str::to_owned)
                    .to_vec()
            } else if mode == "gmail" {
                vec!["https://www.googleapis.com/auth/gmail.modify".to_owned()]
            } else {
                vec![]
            },
            ..Data::default()
        };
        let (service, fake) = service(data);
        let logs = Logs(Arc::new(Mutex::new(Vec::new())));
        let subscriber = tracing_subscriber::registry().with(logs.clone());
        grants::discover(
            &service.grants,
            &service.provider,
            &link("macro|actor@example.com"),
        )
        .with_subscriber(subscriber)
        .await;
        let data = fake.0.lock().unwrap();
        let mut expected = vec!["unrecorded".to_string()];
        if mode != "recorded" {
            expected.push("token".into());
        }
        if !["recorded", "token"].contains(&mode) {
            expected.push("scopes".into());
        }
        if ["empty", "gmail", "calendar", "apply"].contains(&mode) {
            expected.push(format!("apply:false:{}", data.scopes.join(",")));
        }
        assert_eq!(data.calls, expected, "{mode}");
        let expected_log = match mode {
            "token" => Some(("skipping grant discovery: no Google token", "AuthRequired")),
            "scopes" => Some((
                "failed to discover Google token scopes",
                "FakeError(\"scripted failure\")",
            )),
            "apply" => Some((
                "failed to apply discovered Google grant",
                "DatabaseError(apply failed)",
            )),
            _ => None,
        };
        let expected: Vec<_> = expected_log
            .into_iter()
            .map(|(message, error)| Log {
                level: "WARN".into(),
                fields: BTreeMap::from([
                    ("message".into(), message.into()),
                    ("error".into(), error.into()),
                    ("link_id".into(), LINK.to_string()),
                ]),
            })
            .collect();
        assert_eq!(*logs.0.lock().unwrap(), expected, "{mode}");
    }
}

#[tokio::test]
async fn first_login_discovery_failure_does_not_block_backfill() {
    for fail in ["token", "scopes", "apply"] {
        let (service, fake) = service(Data {
            unrecorded: true,
            fail: Some(fail),
            ..Data::default()
        });
        assert_eq!(
            service
                .connect(request(false))
                .await
                .unwrap()
                .backfill_job_id,
            Some(JOB)
        );
        assert_eq!(
            fake.0.lock().unwrap().calls.last().map(String::as_str),
            Some("backfill")
        );
        assert!(!fake.0.lock().unwrap().calls.contains(&"cleanup".into()));
    }
}

#[tokio::test]
async fn unavailable_login_email_is_a_typed_refusal_before_provider_calls() {
    let (service, fake) = service(Data {
        fail: Some("login_email"),
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(false)).await,
        Err(ConnectionError::LoginEmailUnavailable)
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        ["by_identity", "login_email", "failure"]
    );
}

#[tokio::test]
async fn invalid_login_email_stops_before_watch_registration_and_persistence() {
    let (service, fake) = service(Data {
        login_email: "invalid-email".into(),
        ..Data::default()
    });
    assert!(matches!(
        service.connect(request(false)).await,
        Err(ConnectionError::Parse(_))
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        ["by_identity", "login_email", "failure"]
    );
}

#[tokio::test]
async fn first_login_discovers_permissions_before_starting_backfill_without_consuming_an_attempt() {
    let gmail_scope = "https://www.googleapis.com/auth/gmail.modify";
    let (service, fake) = service(Data {
        unrecorded: true,
        scopes: vec![gmail_scope.into()],
        ..Data::default()
    });
    assert_eq!(
        service.connect(request(false)).await.unwrap(),
        ConnectionOutcome {
            link_id: LINK,
            backfill_job_id: Some(JOB),
        }
    );
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            "by_identity",
            "login_email",
            "watch",
            "create",
            "unrecorded",
            "token",
            "scopes",
            &format!("apply:false:{gmail_scope}"),
            "backfill",
        ]
    );
}
