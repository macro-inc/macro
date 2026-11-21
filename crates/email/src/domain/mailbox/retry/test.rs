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
