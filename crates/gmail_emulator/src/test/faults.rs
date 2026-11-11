use std::time::Duration;

use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use email_api_client::domain::ports::{MailboxLabelClient, MailboxSyncClient};
use uuid::Uuid;

use super::*;
use crate::{Fault, FaultError, Route};

#[tokio::test]
async fn a_fault_applies_to_its_mailbox_and_route_for_its_count() {
    let emulator = two_mailboxes().await;
    let repository = repository(&emulator);
    let (ada, bob) = (token(&emulator, ADA), token(&emulator, BOB));
    emulator.inject_fault(Fault {
        mailbox: Some(ADA.to_string()),
        route: Some(Route::GetProfile),
        error: Some(FaultError::RateLimit),
        retry_after_seconds: Some(7),
        times: Some(2),
        ..Fault::default()
    });

    let limited = EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(7)),
        origin: RateLimitOrigin::Provider { concurrency: false },
    };
    assert_eq!(repository.get_thread_count(&ada).await.unwrap_err(), limited);
    assert!(repository.get_thread_count(&bob).await.is_ok());
    assert!(repository.list_labels(&ada, Uuid::now_v7()).await.is_ok());
    assert_eq!(repository.get_thread_count(&ada).await.unwrap_err(), limited);
    assert!(repository.get_thread_count(&ada).await.is_ok());
    assert!(emulator.faults().is_empty());
}

#[tokio::test]
async fn each_provider_failure_maps_to_the_error_our_code_handles() {
    let emulator = two_mailboxes().await;
    let repository = repository(&emulator);
    let ada = token(&emulator, ADA);
    let once = |error| Fault {
        error: Some(error),
        times: Some(1),
        ..Fault::default()
    };

    emulator.inject_fault(once(FaultError::ConcurrentRequests));
    assert_eq!(
        repository.get_thread_count(&ada).await.unwrap_err(),
        EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider { concurrency: true },
        }
    );

    emulator.inject_fault(once(FaultError::QuotaExceeded));
    assert!(matches!(
        repository.get_thread_count(&ada).await.unwrap_err(),
        EmailApiError::RateLimited { origin: RateLimitOrigin::Provider { concurrency: false }, .. }
    ));

    emulator.inject_fault(once(FaultError::Unavailable));
    assert!(matches!(
        repository.get_thread_count(&ada).await.unwrap_err(),
        EmailApiError::Transient { .. }
    ));

    emulator.inject_fault(once(FaultError::Unauthorized));
    assert_eq!(repository.get_thread_count(&ada).await.unwrap_err(), EmailApiError::AuthRequired);

    emulator.inject_fault(once(FaultError::Forbidden));
    assert_eq!(repository.get_thread_count(&ada).await.unwrap_err(), EmailApiError::Forbidden);

    assert!(repository.get_thread_count(&ada).await.is_ok());
}

#[tokio::test]
async fn a_mailbox_over_its_quota_is_rate_limited_until_the_minute_passes() {
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![SeedMailbox {
            // labels.list costs 1 unit, profile 1, messages.list 5.
            quota_units_per_minute: Some(6),
            ..SeedMailbox::new(ADA)
        }],
        ..Seed::default()
    })
    .await
    .unwrap();
    let client = client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();

    client.get_profile(&ada).await.unwrap();
    client.list_messages(&ada, 10, &[]).await.unwrap();
    let limited = client.get_profile(&ada).await.unwrap_err();
    assert_eq!(limited.status().unwrap().as_u16(), 429);
    assert_eq!(limited.retry_after(), Some(Duration::from_secs(60)));

    emulator.advance_clock(Duration::from_secs(61));
    let ada = emulator.access_token(ADA).unwrap();
    assert!(client.get_profile(&ada).await.is_ok());
}
