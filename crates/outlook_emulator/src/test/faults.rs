use std::time::Duration;

use email_api_client::domain::models::{EmailApiError, RateLimitOrigin, SubmissionOutcome};
use email_api_client::domain::ports::{
    FolderChangeReader, MailboxActionWriter, MailboxContentReader,
};

use super::{ADA, BOB, id, message_id, start, token};
use crate::{Fault, FaultError, Route};

const SEED: &str = "mailboxes:\n  - email: ada@example.com\n    messages:\n      - subject: Hello\n  - email: bob@example.com\n";

#[tokio::test]
async fn a_throttled_request_carries_graphs_retry_after() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    emulator.inject_fault(Fault {
        mailbox: Some(ADA.into()),
        route: Some(Route::MessagesDelta),
        error: Some(FaultError::RateLimit),
        retry_after_seconds: Some(17),
        times: Some(1),
        ..Fault::default()
    });

    let throttled = api
        .folder_changes(&token, &id("inbox"), None)
        .await
        .unwrap_err();

    let EmailApiError::RateLimited {
        retry_after,
        origin,
    } = throttled
    else {
        panic!("a 429 is a rate limit");
    };
    assert_eq!(retry_after, Some(Duration::from_secs(17)));
    assert!(matches!(origin, RateLimitOrigin::Provider { .. }));
    // The fault applied once, and only to that mailbox.
    api.folder_changes(&token, &id("inbox"), None)
        .await
        .unwrap();
    let recorded = emulator.requests();
    assert_eq!(recorded[0].status, 429);
    assert_eq!(recorded[1].status, 200);
}

#[tokio::test]
async fn faults_are_scoped_to_their_mailbox() {
    let (emulator, api) = start(SEED).await;
    emulator.inject_fault(Fault {
        mailbox: Some(BOB.into()),
        error: Some(FaultError::Unavailable),
        ..Fault::default()
    });

    api.folders(&token(&emulator, ADA)).await.unwrap();
    let failed = api.folders(&token(&emulator, BOB)).await.unwrap_err();

    assert!(matches!(failed, EmailApiError::Transient { .. }));
}

#[tokio::test]
async fn the_mailbox_request_limit_answers_429_until_the_window_moves_on() {
    let seed = "mailboxes:\n  - email: ada@example.com\n    requests_per_ten_minutes: 3\n";
    let (emulator, api) = start(seed).await;
    let access = token(&emulator, ADA);
    let inbox = id("inbox");
    for _ in 0..3 {
        api.folder_changes(&access, &inbox, None).await.unwrap();
    }

    let throttled = api.folder_changes(&access, &inbox, None).await.unwrap_err();
    let EmailApiError::RateLimited { retry_after, .. } = throttled else {
        panic!("the fourth request in the window is throttled");
    };
    let wait = retry_after.unwrap();
    assert!(wait > Duration::from_secs(590) && wait <= Duration::from_secs(600));

    emulator.advance_clock(wait);
    api.folder_changes(&access, &inbox, None).await.unwrap();
}

#[tokio::test]
async fn expired_and_revoked_tokens_ask_for_authorization() {
    let (emulator, api) = start(SEED).await;
    let access = token(&emulator, ADA);
    api.folders(&access).await.unwrap();

    emulator.advance_clock(Duration::from_secs(3601));
    let expired = api.folders(&access).await.unwrap_err();
    assert!(matches!(expired, EmailApiError::AuthRequired));

    let fresh = token(&emulator, ADA);
    api.folders(&fresh).await.unwrap();
    emulator.revoke_grant(ADA).unwrap();
    let revoked = api.folders(&fresh).await.unwrap_err();
    assert!(matches!(revoked, EmailApiError::AuthRequired));
    assert!(emulator.access_token(ADA).is_err());
}

#[tokio::test]
async fn a_send_that_fails_with_a_server_error_has_an_unknown_outcome() {
    let (emulator, api) = start(SEED).await;
    let access = token(&emulator, ADA);
    emulator.inject_fault(Fault {
        route: Some(Route::MessagesSend),
        error: Some(FaultError::GatewayTimeout),
        times: Some(1),
        ..Fault::default()
    });
    let hello = message_id(&emulator, ADA, "Hello");

    let outcome = api.submit_draft(&access, &hello).await.unwrap();

    assert!(matches!(outcome, SubmissionOutcome::Unknown));
}

#[tokio::test]
async fn graph_error_statuses_map_to_the_clients_errors() {
    let (emulator, api) = start(SEED).await;
    let access = token(&emulator, ADA);
    let inbox = id("inbox");
    let fail = async |error: FaultError| {
        emulator.inject_fault(Fault {
            error: Some(error),
            times: Some(1),
            ..Fault::default()
        });
        api.folder_changes(&access, &inbox, None).await.unwrap_err()
    };

    assert!(matches!(
        fail(FaultError::Internal).await,
        EmailApiError::Transient { .. }
    ));
    assert!(matches!(
        fail(FaultError::Forbidden).await,
        EmailApiError::Forbidden
    ));
    assert!(matches!(
        fail(FaultError::Unauthorized).await,
        EmailApiError::AuthRequired
    ));
    assert!(matches!(
        fail(FaultError::MailboxNotEnabled).await,
        EmailApiError::NotFound
    ));
    assert!(matches!(
        fail(FaultError::SyncStateNotFound).await,
        EmailApiError::OutdatedCursor
    ));
    assert!(matches!(
        fail(FaultError::ConcurrentRequests).await,
        EmailApiError::RateLimited { .. }
    ));
}
