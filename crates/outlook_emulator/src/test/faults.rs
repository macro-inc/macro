use std::time::Duration;

use email_api_client::domain::models::{
    EmailApiError, FolderRole, MailFolderCatalog, RateLimitOrigin, RoundStart, StreamPosition,
    SubmissionOutcome,
};
use email_api_client::domain::ports::{
    FolderChangeReader, MailboxActionWriter, MailboxContentReader,
};

use super::{ADA, BOB, folders, id, message_id, start, token};
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
        .folder_changes(&token, &id("inbox"), None, RoundStart::Unordered)
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
    api.folder_changes(&token, &id("inbox"), None, RoundStart::Unordered)
        .await
        .unwrap();
    let recorded = emulator.requests();
    assert_eq!(recorded[0].status, 429);
    assert_eq!(recorded[1].status, 200);
}

#[tokio::test]
async fn a_fault_for_a_folder_applies_to_that_folders_requests_only() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    let inbox = folders(&api, &token)
        .await
        .into_iter()
        .find(|folder| folder.role == FolderRole::Inbox)
        .unwrap()
        .id;
    // Named by its well-known name, the fault finds the folder the client
    // names by id; one that lets a request through goes first.
    emulator.inject_fault(Fault {
        route: Some(Route::MessagesDelta),
        folder: Some("inbox".into()),
        times: Some(1),
        ..Fault::default()
    });
    emulator.inject_fault(Fault {
        route: Some(Route::MessagesDelta),
        folder: Some("inbox".into()),
        error: Some(FaultError::Unavailable),
        ..Fault::default()
    });

    api.folder_changes(&token, &inbox, None, RoundStart::Unordered)
        .await
        .unwrap();
    api.folder_changes(&token, &inbox, None, RoundStart::Unordered)
        .await
        .unwrap_err();
    api.folder_changes(&token, &id("sentitems"), None, RoundStart::Unordered)
        .await
        .unwrap();
    api.folders(&token).await.unwrap();
}

#[tokio::test]
async fn a_continuation_fault_holds_a_rounds_later_pages_but_not_a_new_round() {
    let mut seed = format!("mailboxes:\n  - email: {ADA}\n    messages:\n");
    for index in 0..150 {
        seed.push_str(&format!("      - subject: Message {index:03}\n"));
    }
    let (emulator, api) = start(&seed).await;
    let token = token(&emulator, ADA);
    emulator.inject_fault(Fault {
        route: Some(Route::MessagesDelta),
        folder: Some("inbox".into()),
        continuation: true,
        error: Some(FaultError::Unavailable),
        ..Fault::default()
    });

    let first = api
        .folder_changes(&token, &id("inbox"), None, RoundStart::NewestFirst)
        .await
        .unwrap();
    let StreamPosition::Continue(next) = first.position else {
        panic!("150 messages are a round of two pages");
    };
    api.folder_changes(&token, &id("inbox"), Some(&next), RoundStart::NewestFirst)
        .await
        .unwrap_err();
    // A new round of the same folder, as a live pass reads, goes through.
    api.folder_changes(
        &token,
        &id("inbox"),
        None,
        RoundStart::ReceivedSince(emulator.now()),
    )
    .await
    .unwrap();
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
        api.folder_changes(&access, &inbox, None, RoundStart::Unordered)
            .await
            .unwrap();
    }

    let throttled = api
        .folder_changes(&access, &inbox, None, RoundStart::Unordered)
        .await
        .unwrap_err();
    let EmailApiError::RateLimited { retry_after, .. } = throttled else {
        panic!("the fourth request in the window is throttled");
    };
    let wait = retry_after.unwrap();
    assert!(wait > Duration::from_secs(590) && wait <= Duration::from_secs(600));

    emulator.advance_clock(wait);
    api.folder_changes(&access, &inbox, None, RoundStart::Unordered)
        .await
        .unwrap();
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
        api.folder_changes(&access, &inbox, None, RoundStart::Unordered)
            .await
            .unwrap_err()
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
        fail(FaultError::ExtensionForbidden).await,
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

#[tokio::test]
async fn an_inbox_graph_answers_404_to_is_an_account_without_a_mailbox() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    emulator.inject_fault(Fault {
        route: Some(Route::FoldersGet),
        error: Some(FaultError::MailboxNotEnabled),
        times: Some(1),
        ..Fault::default()
    });

    assert_eq!(
        api.folders(&token).await.unwrap(),
        MailFolderCatalog::NoMailbox {
            error_code: Some("MailboxNotEnabledForRESTAPI".into())
        }
    );

    // Any other failure of the Inbox read is still the call's error.
    emulator.inject_fault(Fault {
        route: Some(Route::FoldersGet),
        error: Some(FaultError::Internal),
        times: Some(1),
        ..Fault::default()
    });
    assert!(matches!(
        api.folders(&token).await,
        Err(EmailApiError::Transient { .. })
    ));
    assert!(!folders(&api, &token).await.is_empty());
}
