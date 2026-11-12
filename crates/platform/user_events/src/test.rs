use super::*;
use macro_user_id::cowlike::CowLike;

#[test]
fn picture_changed_is_keyed_by_user_and_tagged() {
    let user_id = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let event = UserMacroEvent::picture_changed(UserPictureChangedMetadata {
        user_id: user_id.clone(),
        file_id: Some("f".to_string()),
        url: Some("https://static/file/f".to_string()),
    });

    assert_eq!(event.key(), "macro|owner@example.com");
    let json = serde_json::to_value(&event.event().event).unwrap();
    assert_eq!(json["event_type"], "user.picture_changed");
    assert_eq!(json["metadata"]["user_id"], "macro|owner@example.com");
    assert_eq!(json["metadata"]["file_id"], "f");
}
