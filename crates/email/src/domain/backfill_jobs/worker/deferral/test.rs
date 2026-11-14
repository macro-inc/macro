use std::time::Duration;

use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use models_email::email::service::pubsub::ProcessingError;

use super::*;

use crate::domain::backfill_jobs::worker::map_email_api_error;

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
fn a_population_refused_its_teams_crm_slot_is_deferred_with_backoff() {
    let refused = DetailedError {
        reason: FailureReason::CrmPopulationBusy,
        source: anyhow::anyhow!("every CRM population slot of the team is taken"),
    };

    assert_eq!(rate_limit(&refused), Some(None));
}

#[test]
fn other_retryable_failures_keep_waiting_out_the_visibility_timeout() {
    let database = retryable(ProcessingError::Retryable(DetailedError {
        reason: FailureReason::DatabaseQueryFailed,
        source: anyhow::anyhow!("connection reset").context("Failed to insert thread"),
    }));
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
    assert_eq!(delay(&REFUSAL, 0, None, shortest), 1);
    assert_eq!(delay(&REFUSAL, 0, None, longest), 1);
    assert_eq!(delay(&REFUSAL, 1, None, longest), 2);
    assert_eq!(delay(&REFUSAL, 3, None, shortest), 4);
    assert_eq!(delay(&REFUSAL, 3, None, longest), 8);
    assert_eq!(delay(&REFUSAL, 6, None, longest), 60);
    assert_eq!(delay(&REFUSAL, 40, None, shortest), 30);
    assert_eq!(delay(&REFUSAL, 40, None, longest), 60);
}

#[test]
fn a_deferral_waits_at_least_its_retry_after_rounded_up() {
    assert_eq!(
        delay(&REFUSAL, 0, Some(Duration::from_millis(4_200)), longest),
        5
    );
    assert_eq!(
        delay(&REFUSAL, 3, Some(Duration::from_millis(500)), longest),
        8
    );
    assert_eq!(
        delay(&REFUSAL, 0, Some(Duration::from_secs(3_600)), longest),
        900
    );
}

#[test]
fn only_crm_population_refusals_use_the_crm_backoff() {
    assert!(std::ptr::eq(
        refusal_backoff(FailureReason::CrmPopulationBusy),
        &CRM_POPULATION_REFUSAL
    ));
    for reason in [
        FailureReason::GmailApiRateLimited,
        FailureReason::BackfillWritesBusy,
    ] {
        assert!(std::ptr::eq(refusal_backoff(reason), &REFUSAL));
    }
}

#[test]
fn crm_population_deferrals_grow_from_five_seconds_to_sqs_longest_delay() {
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 0, None, shortest), 3);
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 0, None, longest), 5);
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 4, None, shortest), 40);
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 4, None, longest), 80);
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 8, None, longest), 900);
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 40, None, shortest), 450);
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, 40, None, longest), 900);
}

fn deferrals_in_first_hour(backoff: &Backoff) -> u32 {
    let mut waited = 0;
    let mut deferrals = 0;
    while waited < 3_600 {
        waited += delay(backoff, deferrals, None, shortest);
        deferrals += 1;
    }
    deferrals
}

/// A population whose team's slots stay taken comes back through the shared
/// queue a fraction as often as a Gmail refusal would, and after its first
/// hour at most once every seven and a half minutes.
#[test]
fn a_long_crm_backlog_retries_rarely_once_its_backoff_has_grown() {
    let crm = deferrals_in_first_hour(&CRM_POPULATION_REFUSAL);
    let gmail = deferrals_in_first_hour(&REFUSAL);
    assert!(crm <= 15, "{crm} CRM deferrals in the first hour");
    assert!(
        gmail >= 5 * crm,
        "{gmail} Gmail deferrals in the first hour"
    );
    assert_eq!(delay(&CRM_POPULATION_REFUSAL, crm, None, shortest), 450);
}

#[test]
fn redeliveries_back_off_from_half_a_minute_to_fifteen_minutes() {
    assert_eq!(delay(&REDELIVERY, 0, None, shortest), 15);
    assert_eq!(delay(&REDELIVERY, 0, None, longest), 30);
    assert_eq!(delay(&REDELIVERY, 1, None, longest), 60);
    assert_eq!(delay(&REDELIVERY, 4, None, longest), 480);
    assert_eq!(delay(&REDELIVERY, 5, None, longest), 900);
    assert_eq!(delay(&REDELIVERY, 19, None, shortest), 450);
}

#[test]
fn the_first_delivery_waits_the_shortest_redelivery_delay() {
    for receives in [0, 1] {
        let seconds = redelivery_delay_seconds(receives);
        assert!((15..=30).contains(&seconds), "{receives}: {seconds}");
    }
    let seconds = redelivery_delay_seconds(3);
    assert!((60..=120).contains(&seconds), "{seconds}");
    let seconds = redelivery_delay_seconds(u32::MAX);
    assert!((450..=900).contains(&seconds), "{seconds}");
}

/// The queue dead-letters after 20 receives. An operation that fails every
/// time reaches the dead-letter queue after about two to four hours instead
/// of the twenty minutes twenty visibility timeouts took, so it retries
/// rarely while it waits.
#[test]
fn an_operation_that_always_fails_spends_its_deliveries_over_hours() {
    let (shortest_total, longest_total) = (1..20).fold((0, 0), |(short, long), receives| {
        (
            short + delay(&REDELIVERY, receives - 1, None, shortest),
            long + delay(&REDELIVERY, receives - 1, None, longest),
        )
    });
    assert_eq!(shortest_total, 6_765);
    assert_eq!(longest_total, 13_530);
}
