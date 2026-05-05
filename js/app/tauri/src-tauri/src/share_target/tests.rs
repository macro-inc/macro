use super::*;

#[test]
fn share_filenames_from_url_preserves_order() {
    let url = Url::parse("macro://share?files=share_one.jpg,share_two.mp4").unwrap();

    assert_eq!(
        share_filenames_from_url(&url),
        vec!["share_one.jpg".to_string(), "share_two.mp4".to_string()]
    );
}

#[test]
fn share_filenames_from_url_rejects_invalid_names() {
    let url = Url::parse(
        "macro://share?files=share_ok.png,../bad.mov,not_shared.jpg,share_nested%2Fbad.mp4",
    )
    .unwrap();

    assert_eq!(
        share_filenames_from_url(&url),
        vec!["share_ok.png".to_string()]
    );
}

#[test]
fn remaining_pending_share_filenames_only_removes_consumed_entries() {
    let pending = vec![
        "share_old.jpg".to_string(),
        "share_current.mp4".to_string(),
        "share_next.png".to_string(),
    ];
    let consumed = vec![
        "share_current.mp4".to_string(),
        "share_missing.mov".to_string(),
    ];

    assert_eq!(
        remaining_pending_share_filenames(&pending, &consumed),
        vec!["share_old.jpg".to_string(), "share_next.png".to_string()]
    );
}

#[test]
fn staged_shared_file_not_found_error_matches_helper() {
    assert!(is_staged_shared_file_not_found_error(
        STAGED_SHARED_FILE_NOT_FOUND_ERROR
    ));
    assert!(!is_staged_shared_file_not_found_error(
        "failed to read shared file staging directory"
    ));
}
