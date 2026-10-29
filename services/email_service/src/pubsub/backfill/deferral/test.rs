use std::time::Duration;

use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use models_email::email::service::pubsub::ProcessingError;

use super::*;
use crate::pubsub::backfill::db_error::map_db_error;
use crate::pubsub::backfill::email_api_error::map_email_api_error;

fn retryable(error: ProcessingError) -> DetailedError {
    match error {
        ProcessingError::Retryable(detail) => detail,
        ProcessingError::NonRetryable(detail) => {
            panic!("expected a retryable error, got {:?}", detail.reason)
        }
    }
}

fn longest(range: RangeInclusive<Duration>) -> Duration {
    *range.end()
}

fn shortest(range: RangeInclusive<Duration>) -> Duration {
    *range.start()
}

#[test]
fn a_refused_thread_listing_page_is_deferred_instead_of_spending_a_delivery() {
    let refused = retryable(map_email_api_error(
        EmailApiError::RateLimited {
            retry_after: Some(Duration::from_millis(2_500)),
            origin: RateLimitOrigin::Local,
        },
        "Failed to list provider threads",
    ));

    assert_eq!(
        rate_limit(&refused),
        Some(Some(Duration::from_millis(2_500)))
    );
}

#[test]
fn a_gmail_rate_limit_without_retry_after_is_deferred_too() {
    let throttled = retryable(map_email_api_error(
        EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider { concurrency: false },
        },
        "Failed to fetch message",
    ));

    assert_eq!(rate_limit(&throttled), Some(None));
}

#[test]
fn a_write_refused_a_backfill_write_slot_is_deferred_with_backoff() {
    let refused = DetailedError {
        reason: FailureReason::BackfillWritesBusy,
        source: anyhow::anyhow!("no backfill write slot freed up in time"),
    };

    assert_eq!(rate_limit(&refused), Some(None));
}

#[test]
fn other_retryable_failures_keep_waiting_out_the_visibility_timeout() {
    let database = retryable(map_db_error(
        anyhow::anyhow!("connection reset"),
        "Failed to insert thread",
    ));
    let transient = retryable(map_email_api_error(
        EmailApiError::Transient {
            message: "Gmail API returned 503".to_string(),
        },
        "Failed to fetch message",
    ));

    assert_eq!(rate_limit(&database), None);
    assert_eq!(rate_limit(&transient), None);
}

#[test]
fn deferrals_grow_from_a_second_to_a_minute() {
    assert_eq!(delay(0, None, shortest), 1);
    assert_eq!(delay(0, None, longest), 1);
    assert_eq!(delay(1, None, longest), 2);
    assert_eq!(delay(3, None, shortest), 4);
    assert_eq!(delay(3, None, longest), 8);
    assert_eq!(delay(6, None, longest), 60);
    assert_eq!(delay(40, None, shortest), 30);
    assert_eq!(delay(40, None, longest), 60);
}

#[test]
fn a_deferral_waits_at_least_its_retry_after_rounded_up() {
    assert_eq!(delay(0, Some(Duration::from_millis(4_200)), longest), 5);
    assert_eq!(delay(3, Some(Duration::from_millis(500)), longest), 8);
    assert_eq!(delay(0, Some(Duration::from_secs(3_600)), longest), 900);
}

#[test]
fn the_deferral_count_is_read_from_the_message() {
    let deferred = aws_sdk_sqs::types::Message::builder()
        .message_attributes(
            BACKFILL_DEFERRALS_ATTRIBUTE,
            aws_sdk_sqs::types::MessageAttributeValue::builder()
                .data_type("Number")
                .string_value("4")
                .build()
                .unwrap(),
        )
        .build();
    let fresh = aws_sdk_sqs::types::Message::builder().build();

    assert_eq!(deferrals(&deferred), 4);
    assert_eq!(deferrals(&fresh), 0);
}
