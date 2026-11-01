use super::*;
use chrono::TimeZone;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn request() -> MeetingLinkRequest {
    MeetingLinkRequest {
        title: "Intro — Ada".into(),
        scheduled_start: Some(
            chrono::Utc
                .with_ymd_and_hms(2026, 10, 20, 15, 0, 0)
                .unwrap(),
        ),
        scheduled_end: Some(
            chrono::Utc
                .with_ymd_and_hms(2026, 10, 20, 15, 30, 0)
                .unwrap(),
        ),
    }
}

#[tokio::test]
async fn create_mints_a_meeting_and_returns_its_join_link() {
    let server = MockServer::start().await;
    let meeting_id = Uuid::from_u128(7);
    Mock::given(method("POST"))
        .and(path("/call/meetings"))
        .and(header(INTERNAL_API_KEY_HEADER, "secret"))
        .and(header(INTERNAL_MACRO_USER_ID_HEADER, "macro|ada@macro.com"))
        .and(body_json(serde_json::json!({
            "preparationId": null,
            "title": "Intro — Ada",
            "scheduledStart": "2026-10-20T15:00:00Z",
            "scheduledEnd": "2026-10-20T15:30:00Z",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": meeting_id,
            "shareToken": TOKEN,
            "title": "Intro — Ada",
        })))
        .expect(1)
        .mount(&server)
        .await;
    let links = HttpMeetingLinks::new(server.uri(), "https://macro.com", "secret");
    let created = links
        .create_meeting_link("macro|ada@macro.com", request())
        .await
        .unwrap();
    assert_eq!(created.id, meeting_id);
    assert_eq!(
        created.url,
        format!("https://macro.com/app/meet/join/{TOKEN}")
    );
}

#[tokio::test]
async fn cancel_deletes_the_meeting_for_the_organizer() {
    let server = MockServer::start().await;
    let meeting_id = Uuid::from_u128(9);
    Mock::given(method("DELETE"))
        .and(path(format!("/call/meetings/{meeting_id}")))
        .and(header(INTERNAL_MACRO_USER_ID_HEADER, "macro|ada@macro.com"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let links = HttpMeetingLinks::new(server.uri(), "https://macro.com/", "secret");
    links
        .cancel_meeting_link("macro|ada@macro.com", meeting_id)
        .await
        .unwrap();
}

#[test]
fn a_blank_title_lets_the_meeting_service_choose_one() {
    assert_eq!(meeting_title("  \n"), None);
    assert_eq!(meeting_title("Hello"), Some("Hello".into()));
}
