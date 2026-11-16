use axum::http::StatusCode;
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::domain::models::RateLimitExceeded;
use std::time::Duration;

use super::{picture_changed_metadata, throttle_result};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap()
}

#[test]
fn a_file_picture_carries_file_id_and_url() {
    let metadata = picture_changed_metadata(
        user(),
        Some("file-1".to_string()),
        "https://static.example.com/file/file-1",
    );
    assert_eq!(metadata.user_id, user());
    assert_eq!(metadata.file_id.as_deref(), Some("file-1"));
    assert_eq!(
        metadata.url.as_deref(),
        Some("https://static.example.com/file/file-1")
    );
}

#[test]
fn a_url_picture_has_no_file_id() {
    let metadata = picture_changed_metadata(user(), None, "https://img.example.com/a.png");
    assert_eq!(metadata.file_id, None);
    assert_eq!(
        metadata.url.as_deref(),
        Some("https://img.example.com/a.png")
    );
}

#[test]
fn an_empty_url_means_removed() {
    let metadata = picture_changed_metadata(user(), None, "");
    assert_eq!(metadata.file_id, None);
    assert_eq!(metadata.url, None);
}

#[test]
fn an_exceeded_limit_is_a_429() {
    let exceeded = RateLimitExceeded {
        current_count: 2,
        max_count: 1,
        retry_after: Duration::from_millis(400),
    };
    let (status, _) = throttle_result(Err(exceeded)).unwrap_err();
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}
