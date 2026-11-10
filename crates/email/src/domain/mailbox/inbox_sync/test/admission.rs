use super::fakes::{Call, input, make_service};
use super::*;

#[tokio::test]
async fn malformed_input_returns_the_original_error_without_accessing_a_port() {
    let (service, fake) = make_service(false);
    let outcome = service
        .process(Err(anyhow!("broken body").context("decode")), &fake)
        .await;
    let InboxSyncDisposition::InvalidDelete(error) = outcome else {
        panic!("invalid disposition")
    };
    assert_eq!(format!("{error:#}"), "decode: broken body");
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn missing_link_is_terminal_and_lookup_failure_is_retryable_before_prefixing() {
    for missing in [false, true] {
        let (service, fake) = make_service(false);
        if missing {
            fake.0.lock().unwrap().link = None;
        } else {
            fake.0.lock().unwrap().failures.push(("link", 1));
        }
        let (delete, error) = failure(
            service
                .process(Ok(input(gmail_notification())), &fake)
                .await,
        );
        assert_eq!(delete, missing);
        assert_eq!(
            error.reason,
            if missing {
                FailureReason::LinkNotFound
            } else {
                FailureReason::DatabaseQueryFailed
            }
        );
        assert!(!error.source.to_string().starts_with("gmail_message:"));
        assert_eq!(fake.calls(), vec![Call::Link]);
    }
}

#[tokio::test]
async fn admission_checks_only_skip_the_operations_the_link_flags_disallow() {
    for active in [false, true] {
        for reauth in [false, true] {
            for operation in std::iter::once(gmail_notification()).chain(fanned_out_operations()) {
                let history = matches!(operation, InboxSyncOperation::GmailMessage(_));
                let (service, fake) = make_service(false);
                {
                    let mut state = fake.0.lock().unwrap();
                    let link = state.link.as_mut().unwrap();
                    link.is_sync_active = active;
                    link.needs_reauth = reauth;
                }
                let outcome = service.process(Ok(input(operation)), &fake).await;
                assert!(matches!(outcome, InboxSyncDisposition::DoneDelete));
                assert_eq!(fake.calls().len() > 1, active && (!history || !reauth));
            }
        }
    }
}

#[tokio::test]
async fn legacy_history_and_upsert_keep_their_operation_prefix_and_disposition() {
    for (operation, call, prefix) in [
        (gmail_notification(), "history", "gmail_message"),
        (
            fanned_out_operations().remove(0),
            "upsert",
            "upsert_message",
        ),
    ] {
        let (service, fake) = make_service(false);
        fake.0.lock().unwrap().failures.push((call, 1));
        let (delete, error) = failure(service.process(Ok(input(operation)), &fake).await);
        assert!(!delete);
        assert_eq!(error.source.to_string(), format!("{prefix}: {call}"));
        assert_eq!(fake.calls(), vec![Call::Link, Call::Legacy(call)]);
    }
}
