use std::time::Duration;

use calendar_events::domain::ports::{
    CalendarMutationProvider, CalendarProviderErrorKind, GoogleCalendarProvider,
};
use uuid::Uuid;

use super::*;
use crate::{Fault, FaultError, Route};

fn once(route: Route, error: FaultError) -> Fault {
    Fault {
        route: Some(route),
        error: Some(error),
        times: Some(1),
        ..Fault::default()
    }
}

#[tokio::test]
async fn each_provider_failure_is_the_error_kind_our_sync_handles() {
    let emulator = emulator_with(vec![mailbox_with_events(
        ADA,
        vec![event_on("design1", "Design review", 5, 15)],
    )])
    .await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let expected = [
        (FaultError::RateLimit, CalendarProviderErrorKind::Transient),
        (
            FaultError::QuotaExceeded,
            CalendarProviderErrorKind::Transient,
        ),
        (
            FaultError::UsageLimits,
            CalendarProviderErrorKind::Transient,
        ),
        (FaultError::DailyLimit, CalendarProviderErrorKind::Transient),
        (FaultError::Internal, CalendarProviderErrorKind::Transient),
        (
            FaultError::Unavailable,
            CalendarProviderErrorKind::Transient,
        ),
        (
            FaultError::PreconditionFailed,
            CalendarProviderErrorKind::Transient,
        ),
        (
            FaultError::Unauthorized,
            CalendarProviderErrorKind::Transient,
        ),
        (
            FaultError::InsufficientPermissions,
            CalendarProviderErrorKind::ReauthRequired,
        ),
    ];

    for (fault, kind) in expected {
        emulator.inject_fault(once(Route::EventsList, fault));
        let failed = client
            .sync_events(&token, first_sync(&target))
            .await
            .unwrap_err();
        assert_eq!(failed.kind(), kind, "{fault:?}");
    }

    // The same answers to a write: only a refusal is permanent, and a
    // calendar list that fails is not retried as a read of one calendar is.
    let lunch = draft(
        "Lunch",
        timed("2026-11-12T12:00:00Z", "2026-11-12T13:00:00Z"),
    );
    emulator.inject_fault(once(Route::EventsInsert, FaultError::RateLimit));
    let limited = client
        .create_event(&token, &target, &lunch)
        .await
        .unwrap_err();
    assert_eq!(limited.kind(), CalendarProviderErrorKind::Transient);
    emulator.inject_fault(once(Route::EventsInsert, FaultError::Forbidden));
    let refused = client
        .create_event(&token, &target, &lunch)
        .await
        .unwrap_err();
    assert_eq!(refused.kind(), CalendarProviderErrorKind::Permanent);
    emulator.inject_fault(once(Route::CalendarListList, FaultError::NotFound));
    let unlisted = client
        .list_calendars(&token, Uuid::now_v7())
        .await
        .unwrap_err();
    assert_eq!(unlisted.kind(), CalendarProviderErrorKind::Permanent);

    // Nothing was written by the refused requests, and the next sync works.
    assert_eq!(emulator.events(ADA, "primary").unwrap().len(), 1);
    assert!(
        client
            .sync_events(&token, first_sync(&target))
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn a_token_google_calls_expired_is_answered_by_a_full_sync() {
    let emulator = emulator_with(vec![mailbox_with_events(
        ADA,
        vec![event_on("design1", "Design review", 5, 15)],
    )])
    .await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let first = client
        .sync_events(&token, first_sync(&target))
        .await
        .unwrap();

    // The token is still good; Google says 410 all the same.
    emulator.inject_fault(once(Route::EventsList, FaultError::Gone));
    let resynced = client
        .sync_events(&token, next_sync(&target, &first.next_sync_token))
        .await
        .unwrap();

    assert_eq!(
        resynced.observed_provider_event_ids,
        Some(vec!["design1".to_string()])
    );
}

#[tokio::test]
async fn a_grant_without_calendar_access_a_spent_quota_and_a_revoked_grant_are_refused() {
    let emulator = emulator_with(vec![
        // The calendar list alone: what a grant that predates events holds.
        SeedMailbox {
            scopes: Some(vec![
                "https://www.googleapis.com/auth/calendar.calendarlist.readonly".to_string(),
            ]),
            ..SeedMailbox::new(ADA)
        },
        SeedMailbox {
            quota_units_per_minute: Some(2),
            ..SeedMailbox::new(BOB)
        },
    ])
    .await;
    let client = calendar_client(&emulator);
    let link = Uuid::now_v7();

    let ada = emulator.access_token(ADA).unwrap();
    client.list_calendars(&ada, link).await.unwrap();
    let unscoped = client
        .sync_events(&ada, first_sync(&target(ADA)))
        .await
        .unwrap_err();
    assert_eq!(unscoped.kind(), CalendarProviderErrorKind::ReauthRequired);

    // Every Calendar request costs one unit of the user's minute.
    let bob = emulator.access_token(BOB).unwrap();
    client.list_calendars(&bob, link).await.unwrap();
    client.list_calendars(&bob, link).await.unwrap();
    let limited = client.list_calendars(&bob, link).await.unwrap_err();
    assert_eq!(limited.kind(), CalendarProviderErrorKind::Transient);
    assert!(limited.message().contains("rateLimitExceeded"));
    emulator.advance_clock(Duration::from_secs(61));
    let bob = emulator.access_token(BOB).unwrap();
    client.list_calendars(&bob, link).await.unwrap();

    emulator.revoke_grant(BOB).unwrap();
    let revoked = client.list_calendars(&bob, link).await.unwrap_err();
    assert_eq!(revoked.kind(), CalendarProviderErrorKind::Transient);
    assert!(revoked.message().contains("authError"));
}
