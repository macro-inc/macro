//! Sanitized Graph events the normalizer cannot read. Sync skips what names a
//! field, so a failure that is not about one event must never name one.
use super::*;

const SERIES: &str = "series";

fn series(range: Value) -> Value {
    json!({
        "id": SERIES,
        "@odata.etag": "W/\"1\"",
        "iCalUId": "series@outlook",
        "subject": "Meeting",
        "type": "seriesMaster",
        "createdDateTime": "2026-01-01T10:00:00Z",
        "lastModifiedDateTime": "2026-10-01T10:00:00Z",
        "originalStartTimeZone": "Pacific Standard Time",
        "start": {"dateTime": "2026-11-02T17:00:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": "2026-11-02T18:00:00.0000000", "timeZone": "UTC"},
        "isAllDay": false,
        "attendees": [],
        "recurrence": {
            "pattern": {"type": "weekly", "interval": 1, "daysOfWeek": ["monday"], "firstDayOfWeek": "sunday"},
            "range": range,
        },
    })
}

fn no_end() -> Value {
    json!({"type": "noEnd", "startDate": "2026-11-02", "recurrenceTimeZone": "Pacific Standard Time"})
}

fn exception() -> Value {
    json!({
        "id": "exception",
        "type": "exception",
        "seriesMasterId": SERIES,
        "subject": "Moved",
        "originalStart": "2026-11-09T17:00:00Z",
        "start": {"dateTime": "2026-11-09T19:00:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": "2026-11-09T20:00:00.0000000", "timeZone": "UTC"},
        "isAllDay": false,
    })
}

/// Serve `master` and its `instances` as Graph does, and return what sync would see.
async fn refresh(master: Value, instances: Value) -> Result<(), CalendarProviderError> {
    let (server, api) = setup().await;
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/calendars/calendar/events/{SERIES}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(master))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/events/{SERIES}/instances")))
        .respond_with(ResponseTemplate::new(200).set_body_json(instances))
        .mount(&server)
        .await;

    api.refresh_calendar_event("token", &target(), SERIES)
        .await
        .map(|_| ())
}

async fn rejected_field(master: Value, instances: Value) -> String {
    let error = refresh(master, instances).await.unwrap_err();
    assert_eq!(error.kind(), CalendarProviderErrorKind::Permanent);
    assert_eq!(error.message(), INVALID_RESPONSE);
    error.unreadable_field().unwrap().to_owned()
}

#[tokio::test]
async fn a_readable_series_with_an_exception_is_not_rejected() {
    refresh(series(no_end()), json!({"value": [exception()]}))
        .await
        .unwrap();
}

#[tokio::test]
async fn the_series_names_the_field_it_was_rejected_for() {
    let empty = json!({"value": []});
    let bounded = json!({"type": "endDate", "startDate": "2026-11-02", "endDate": "2026-12-01"});

    let mut custom_zone = bounded.clone();
    custom_zone["recurrenceTimeZone"] = json!("Customized Time Zone");
    assert_eq!(
        rejected_field(series(custom_zone), empty.clone()).await,
        "recurrence.range.recurrenceTimeZone"
    );

    let mut missing_uid = series(no_end());
    missing_uid.as_object_mut().unwrap().remove("iCalUId");
    assert_eq!(rejected_field(missing_uid, empty.clone()).await, "iCalUId");

    let mut unmodified = series(no_end());
    unmodified["lastModifiedDateTime"] = json!("not a date");
    assert_eq!(
        rejected_field(unmodified, empty.clone()).await,
        "lastModifiedDateTime"
    );

    let mut unknown_zone = series(no_end());
    unknown_zone["start"] =
        json!({"dateTime": "2026-11-02T17:00:00.0000000", "timeZone": "Customized Time Zone"});
    assert_eq!(
        rejected_field(unknown_zone, empty.clone()).await,
        "start.timeZone"
    );

    // 02:30 does not exist on the morning New York moves its clocks forward.
    let mut skipped_hour = series(no_end());
    skipped_hour["start"] =
        json!({"dateTime": "2026-03-08T02:30:00.0000000", "timeZone": "Eastern Standard Time"});
    assert_eq!(
        rejected_field(skipped_hour, empty.clone()).await,
        "start.localTime"
    );

    let mut reversed = series(no_end());
    reversed["end"] = json!({"dateTime": "2026-11-02T16:00:00.0000000", "timeZone": "UTC"});
    assert_eq!(rejected_field(reversed, empty.clone()).await, "timeRange");

    let mut unsupported_pattern = series(no_end());
    unsupported_pattern["recurrence"]["pattern"]["type"] = json!("hourly");
    assert_eq!(
        rejected_field(unsupported_pattern, empty.clone()).await,
        "recurrence.pattern.type"
    );

    let mut no_days = series(no_end());
    no_days["recurrence"]["pattern"]["daysOfWeek"] = json!([]);
    assert_eq!(
        rejected_field(no_days, empty).await,
        "recurrence.pattern.daysOfWeek"
    );
}

#[tokio::test]
async fn an_instance_names_the_field_it_was_rejected_for() {
    let mut reversed = exception();
    reversed["end"] = json!({"dateTime": "2026-11-09T18:00:00.0000000", "timeZone": "UTC"});
    assert_eq!(
        rejected_field(series(no_end()), json!({"value": [reversed]})).await,
        "instance.timeRange"
    );

    let mut no_original = exception();
    no_original.as_object_mut().unwrap().remove("originalStart");
    assert_eq!(
        rejected_field(series(no_end()), json!({"value": [no_original]})).await,
        "instance.originalStart"
    );

    let mut bad_original = exception();
    bad_original["originalStart"] = json!("not a date");
    assert_eq!(
        rejected_field(series(no_end()), json!({"value": [bad_original]})).await,
        "instance.originalStart"
    );

    let mut unreadable_policy = exception();
    unreadable_policy["singleValueExtendedProperties"] = json!([{
        "id": PREFERENCES_ID,
        "value": "{\"automaticDecline\":{\"id\":\"not a policy\"}}",
    }]);
    assert_eq!(
        rejected_field(series(no_end()), json!({"value": [unreadable_policy]})).await,
        "instance.automaticDecline"
    );
}

#[tokio::test]
async fn an_instance_page_names_the_field_it_was_rejected_for() {
    assert_eq!(
        rejected_field(series(no_end()), json!({"value": "not a list"})).await,
        "instances.value"
    );
}

#[tokio::test]
async fn a_failure_that_is_not_about_one_event_names_no_field() {
    let cases = [
        (400, CalendarProviderErrorKind::Permanent),
        (401, CalendarProviderErrorKind::ReauthRequired),
        (429, CalendarProviderErrorKind::Transient),
        (503, CalendarProviderErrorKind::Transient),
    ];
    for (status, kind) in cases {
        let (server, api) = setup().await;
        Mock::given(method("GET"))
            .and(path(format!("/v1.0/me/calendars/calendar/events/{SERIES}")))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        let error = api
            .refresh_calendar_event("token", &target(), SERIES)
            .await
            .unwrap_err();

        assert_eq!(error.kind(), kind, "{status}");
        assert_eq!(error.unreadable_field(), None, "{status}");
    }

    let (_server, api) = setup().await;
    let mut unbound = target();
    unbound.binding = None;
    let error = api
        .refresh_calendar_event("token", &unbound, SERIES)
        .await
        .unwrap_err();
    assert_eq!(error.kind(), CalendarProviderErrorKind::Permanent);
    assert_eq!(error.unreadable_field(), None);
}
