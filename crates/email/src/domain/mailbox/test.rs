use super::*;
use email_api_client::domain::models::RateLimitOrigin;
use std::time::Duration;

#[test]
fn provider_backoff_is_preserved_and_auth_failure_does_not_hot_loop() {
    let error = EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(73)),
        origin: RateLimitOrigin::Provider { concurrency: false },
    };
    assert_eq!(retry_seconds(&error), 73);
    assert!(retry_seconds(&EmailApiError::AuthRequired) >= 300);
}

#[test]
fn a_provider_failure_backs_off_without_moving_the_message_toward_abandonment() {
    let transient = MailboxError::Provider(EmailApiError::Transient {
        message: "Microsoft Graph returned HTTP 503".into(),
    });
    let retry = |seconds, counted| MessageRetry::After { seconds, counted };
    let first_claims: Vec<_> = (1..=8)
        .map(|attempts| message_retry(&transient, attempts))
        .collect();
    assert_eq!(
        first_claims,
        [
            retry(30, true),
            retry(60, true),
            retry(120, true),
            retry(240, true),
            retry(480, true),
            retry(960, true),
            retry(1800, false),
            retry(1800, false),
        ]
    );
    for attempts in [MESSAGE_FAILURE_ATTEMPTS, 10 * MESSAGE_FAILURE_ATTEMPTS] {
        assert_eq!(message_retry(&transient, attempts), retry(1800, false));
    }
}

#[test]
fn a_message_failing_for_its_own_reasons_is_still_abandoned() {
    let permanent = MailboxError::Provider(EmailApiError::Permanent {
        message: "invalid Microsoft Graph response: missing field `address`".into(),
    });
    let forbidden = MailboxError::Provider(EmailApiError::Forbidden);
    assert_eq!(
        message_retry(&permanent, PERMANENT_FAILURE_ATTEMPTS),
        MessageRetry::Abandon
    );
    assert_eq!(
        message_retry(&forbidden, PERMANENT_FAILURE_ATTEMPTS),
        MessageRetry::Abandon
    );
    assert_eq!(
        message_retry(&MailboxError::Persistence, MESSAGE_FAILURE_ATTEMPTS - 1),
        MessageRetry::After {
            seconds: 1800,
            counted: true
        }
    );
    assert_eq!(
        message_retry(&MailboxError::Persistence, MESSAGE_FAILURE_ATTEMPTS),
        MessageRetry::Abandon
    );
}

fn lease_mid_round(swept_at: Option<DateTime<Utc>>) -> StreamLease {
    StreamLease {
        id: Uuid::now_v7(),
        mailbox: MailboxKey {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        },
        folder: ProviderId::new("inbox").unwrap(),
        position: Some(StreamToken::new("page-2".into())),
        initial_complete: false,
        lease_id: Uuid::now_v7(),
        fence: 1,
        notification: None,
        swept_at,
    }
}

#[test]
fn a_first_round_sweeps_on_news_or_after_two_minutes_with_five_minutes_of_overlap() {
    let swept = Utc::now();
    let overlap = chrono::Duration::minutes(5);
    let mut lease = lease_mid_round(Some(swept));
    assert_eq!(
        sweep_since(&lease, swept + chrono::Duration::seconds(119)),
        None
    );
    assert_eq!(
        sweep_since(&lease, swept + chrono::Duration::minutes(2)),
        Some(swept - overlap)
    );

    lease.notification = Some(Notification {
        received_at: swept,
        traceparent: None,
    });
    assert_eq!(sweep_since(&lease, swept), None, "already swept for it");
    lease.notification = Some(Notification {
        received_at: swept + chrono::Duration::seconds(1),
        traceparent: None,
    });
    assert_eq!(
        sweep_since(&lease, swept + chrono::Duration::seconds(1)),
        Some(swept - overlap)
    );

    let later = swept + chrono::Duration::hours(1);
    assert_eq!(sweep_since(&lease_mid_round(None), later), None);
    let mut first_page = lease_mid_round(Some(swept));
    first_page.position = None;
    assert_eq!(sweep_since(&first_page, later), None);
    let mut caught_up = lease_mid_round(Some(swept));
    caught_up.initial_complete = true;
    assert_eq!(sweep_since(&caught_up, later), None);
}
