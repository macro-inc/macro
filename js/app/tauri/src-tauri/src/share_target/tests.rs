use super::*;

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
