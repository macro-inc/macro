use super::*;

fn path(parent_type: &str, parent_id: &str) -> ParentPath {
    ParentPath {
        parent_type: parent_type.to_owned(),
        parent_id: parent_id.to_owned(),
        id: None,
        legacy_id: None,
    }
}

fn post(policy: &str) -> PostMessage {
    serde_json::from_value(serde_json::json!({
        "content": "nightly sync finished",
        "notification_policy": policy,
    }))
    .expect("post body")
}

#[test]
fn a_channel_message_may_be_silent() {
    let channel = path("channel", &Uuid::now_v7().to_string());

    assert!(ensure_policy_fits_parent(&channel, &post("Silent")).is_ok());
    assert!(ensure_policy_fits_parent(&channel, &post("MentionsOnly")).is_ok());
}

#[test]
fn other_parents_take_only_the_default_policy() {
    let document = path("document", &Uuid::now_v7().to_string());

    assert!(ensure_policy_fits_parent(&document, &post("Default")).is_ok());
    let refused = ensure_policy_fits_parent(&document, &post("Silent"))
        .expect_err("a silent document comment is refused");
    assert!(matches!(refused.0, MessageError::Invalid(_)));
}
