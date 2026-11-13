use super::*;
use call::domain::attendance::{MeetingAttendance, MeetingAttendanceFuture};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

struct Reader {
    observations: Mutex<Vec<Option<MeetingAttendance>>>,
    requests: Mutex<
        Vec<(
            String,
            chrono::DateTime<chrono::Utc>,
            chrono::DateTime<chrono::Utc>,
        )>,
    >,
}

impl MeetingAttendanceReader for Reader {
    fn read<'a>(&'a self, requests: &'a [MeetingAttendanceRequest]) -> MeetingAttendanceFuture<'a> {
        Box::pin(async move {
            self.requests
                .lock()
                .unwrap()
                .extend(requests.iter().map(|request| {
                    (
                        request.token.as_str().to_owned(),
                        request.starts_at,
                        request.ends_at,
                    )
                }));
            Ok(std::mem::take(&mut *self.observations.lock().unwrap()))
        })
    }
}

fn booking(location: String) -> Booking {
    serde_json::from_value(serde_json::json!({
        "id": Uuid::now_v7(),
        "eventTypeId": Uuid::nil(),
        "title": "Meeting",
        "name": "Guest",
        "email": "guest@example.com",
        "startsAt": "2026-11-01T09:00:00Z",
        "endsAt": "2026-11-01T09:30:00Z",
        "timeZone": "UTC",
        "hosts": ["macro|host@example.com"],
        "status": "confirmed",
        "attendance": "unknown",
        "rescheduleCount": 0,
        "location": location,
        "answers": {}
    }))
    .unwrap()
}

#[tokio::test]
async fn reads_exact_saved_meetings_and_preserves_missing_observations() {
    let first_token = format!("{:064x}", 1);
    let second_token = format!("{:064x}", 2);
    let bookings = vec![
        booking(format!("https://localhost/app/meet/join/{first_token}")),
        booking("https://meet.google.com/test".into()),
        booking(format!("https://localhost/app/meet/join/{second_token}")),
    ];
    let source = MacroCallAttendance::new(
        Reader {
            observations: Mutex::new(vec![
                Some(MeetingAttendance {
                    user_ids: vec![
                        MacroUserIdStr::parse_from_str("macro|host@example.com")
                            .unwrap()
                            .into_owned(),
                    ],
                    guest_present: true,
                }),
                None,
            ]),
            requests: Mutex::new(vec![]),
        },
        reqwest::Url::parse("https://localhost").unwrap(),
    );
    let observed = source.observed_participants(&bookings).await.unwrap();
    assert_eq!(observed.len(), 1);
    assert_eq!(
        observed[&bookings[0].id].user_ids,
        ["macro|host@example.com"]
    );
    assert!(observed[&bookings[0].id].guest_present);
    let requests = source.reader.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(
        requests[0],
        (first_token, bookings[0].starts_at, bookings[0].ends_at)
    );
    assert_eq!(
        requests[1],
        (second_token, bookings[2].starts_at, bookings[2].ends_at)
    );
}

#[tokio::test]
async fn rejects_truncated_response_instead_of_silently_dropping_bookings() {
    let source = MacroCallAttendance::new(
        Reader {
            observations: Mutex::new(vec![]),
            requests: Mutex::new(vec![]),
        },
        reqwest::Url::parse("https://localhost").unwrap(),
    );
    let bookings = vec![booking(format!(
        "https://localhost/app/meet/join/{:064x}",
        1
    ))];
    assert!(matches!(
        source.observed_participants(&bookings).await,
        Err(Error::Unavailable)
    ));
}

#[test]
fn unrelated_and_malformed_locations_cannot_become_meeting_tokens() {
    let token = format!("{:064x}", 1);
    let origin = reqwest::Url::parse("https://localhost").unwrap();
    for location in [
        "Office".to_owned(),
        format!("https://localhost/not-a-meeting/{token}"),
        format!("https://localhost/app/meet/join/{token}/extra"),
        format!("file:///app/meet/join/{token}"),
        format!("https://untrusted.example/app/meet/join/{token}"),
        format!("https://localhost:444/app/meet/join/{token}"),
        format!("https://user@localhost/app/meet/join/{token}"),
        "https://localhost/app/meet/join/invalid".to_owned(),
    ] {
        assert!(meeting_token(&location, &origin).is_none());
    }
}
