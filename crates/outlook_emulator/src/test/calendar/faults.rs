use calendar_events::domain::outlook::OutlookCalendarReader;
use calendar_events::domain::outlook::automatic_decline::{
    AutomaticDeclineProvider, AwaySubmissionOutcome,
};
use calendar_events::domain::ports::{CalendarMutationProvider, CalendarProviderErrorKind};

use super::super::{ADA, start};
use super::{SEED, access_token, binding, retitle, stored_id, target};
use crate::{Fault, FaultError, Route};

fn fault(route: Route, error: FaultError) -> Fault {
    Fault {
        mailbox: Some(ADA.into()),
        route: Some(route),
        error: Some(error),
        times: Some(1),
        ..Fault::default()
    }
}

#[tokio::test]
async fn throttling_and_outages_are_transient_and_the_next_request_succeeds() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    emulator.inject_fault(Fault {
        retry_after_seconds: Some(30),
        ..fault(Route::CalendarViewDelta, FaultError::RateLimit)
    });
    emulator.inject_fault(fault(Route::CalendarViewDelta, FaultError::Unavailable));

    let throttled = api
        .calendar_page(&token, &target, true, None)
        .await
        .err()
        .unwrap();
    let unavailable = api
        .calendar_page(&token, &target, true, None)
        .await
        .err()
        .unwrap();
    let page = api
        .calendar_page(&token, &target, true, None)
        .await
        .unwrap();

    assert_eq!(throttled.kind(), CalendarProviderErrorKind::Transient);
    assert_eq!(unavailable.kind(), CalendarProviderErrorKind::Transient);
    assert_eq!(page.members.len(), 7);
    let statuses: Vec<u16> = emulator
        .requests()
        .iter()
        .map(|request| request.status)
        .collect();
    assert_eq!(statuses, vec![429, 503, 200]);
}

#[tokio::test]
async fn a_refused_token_asks_for_reauthorization_and_a_refused_write_is_permanent() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let review = stored_id(&emulator, ADA, "Design review");
    emulator.inject_fault(fault(Route::MailboxSettingsGet, FaultError::Unauthorized));
    emulator.inject_fault(fault(Route::EventsUpdate, FaultError::Forbidden));

    let unauthorized = api.calendars(&token, binding()).await.err().unwrap();
    let forbidden = api
        .update_event(&token, &target, &review, &retitle("Renamed"))
        .await
        .unwrap_err();

    assert_eq!(
        unauthorized.kind(),
        CalendarProviderErrorKind::ReauthRequired
    );
    assert_eq!(forbidden.kind(), CalendarProviderErrorKind::Permanent);
    // The refused write changed nothing.
    assert_eq!(stored_id(&emulator, ADA, "Design review"), review);

    // A revoked grant refuses every request the same way.
    emulator.revoke_grant(ADA).unwrap();
    let revoked = api
        .calendar_page(&token, &target, true, None)
        .await
        .err()
        .unwrap();
    assert_eq!(revoked.kind(), CalendarProviderErrorKind::ReauthRequired);
}

#[tokio::test]
async fn a_mailbox_over_its_request_limit_is_throttled_until_the_window_passes() {
    let seed = SEED.replacen(
        "    name: Ada Example\n",
        "    name: Ada Example\n    requests_per_ten_minutes: 2\n",
        1,
    );
    let (emulator, api) = start(&seed).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");

    let first = api.calendar_page(&token, &target, true, None).await;
    let second = api.calendar_page(&token, &target, true, None).await;
    let third = api.calendar_page(&token, &target, true, None).await;

    assert!(first.is_ok() && second.is_ok());
    assert_eq!(
        third.err().unwrap().kind(),
        CalendarProviderErrorKind::Transient
    );
    emulator.advance_clock(std::time::Duration::from_secs(601));
    api.calendar_page(&token, &target, true, None)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_throttled_automatic_decline_is_deferred_past_graphs_retry_after() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let review = stored_id(&emulator, ADA, "Design review");
    emulator.inject_fault(Fault {
        retry_after_seconds: Some(45),
        ..fault(Route::EventsRespond, FaultError::TooManyRequests)
    });

    let deferred = api
        .decline_away_invitation(&token, &target, &review, None)
        .await
        .unwrap();

    assert!(matches!(deferred, AwaySubmissionOutcome::Deferred(46)));
}

#[tokio::test]
async fn a_write_against_a_version_that_moved_on_is_a_conflict() {
    let (emulator, _api) = start(SEED).await;
    let token = access_token(&emulator);
    let review = stored_id(&emulator, ADA, "Design review");
    let http = reqwest::Client::new();
    let url = format!("{}/me/events/{review}", emulator.graph_url());
    let read: serde_json::Value = http
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let etag = read["@odata.etag"].as_str().unwrap();
    // Someone renames it in Outlook after it was read.
    emulator
        .update_event(
            ADA,
            &review,
            &super::new_event(serde_json::json!({"subject": "Renamed"})),
        )
        .unwrap();

    let stale = http
        .patch(&url)
        .bearer_auth(&token)
        .header("If-Match", etag)
        .json(&serde_json::json!({"subject": "Mine"}))
        .send()
        .await
        .unwrap();

    assert_eq!(stale.status(), 412);
    assert_eq!(stored_id(&emulator, ADA, "Renamed"), review);
}

#[tokio::test]
async fn a_request_the_emulator_does_not_understand_answers_400() {
    let (emulator, _api) = start(SEED).await;
    let token = access_token(&emulator);
    let http = reqwest::Client::new();
    let get = |path: &str| {
        http.get(format!("{}/{path}", emulator.graph_url()))
            .bearer_auth(&token)
            .send()
    };

    let unknown_path = get("me/calendar/events").await.unwrap();
    let no_window = get("me/calendarView/delta").await.unwrap();
    let unknown_option = get("me/calendars?$search=x").await.unwrap();
    let unknown_filter = get("me/calendars/x/events?$filter=subject eq 'x'")
        .await
        .unwrap();

    assert_eq!(unknown_path.status(), 400);
    assert_eq!(no_window.status(), 400);
    assert_eq!(unknown_option.status(), 400);
    assert_eq!(unknown_filter.status(), 404);
    let recorded = emulator.requests();
    assert_eq!(recorded[0].route, None);
    assert_eq!(recorded[1].route, Some(Route::CalendarViewDelta));
}
