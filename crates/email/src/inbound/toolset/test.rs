use super::list_labels::build_summary;
use super::*;
use crate::domain::models::UserProvider;
use ai_toolset::schema::generate_validated_input_schema;
use chrono::Utc;
use macro_user_id::email::EmailStr;

fn make_link(macro_id: &'static str, email: &'static str, is_primary: bool) -> Link {
    Link {
        id: uuid::Uuid::new_v4(),
        macro_id: MacroUserIdStr::parse_from_str(macro_id).unwrap(),
        fusionauth_user_id: "fa-user".to_string(),
        email_address: EmailStr::parse_from_str(email).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[test]
fn test_build_summary_empty() {
    let summary = build_summary(&[]);
    assert_eq!(summary, "No email labels found.");
}

#[test]
fn test_build_summary_with_labels() {
    let labels = vec![
        ToolLabel {
            id: uuid::Uuid::new_v4(),
            name: "INBOX".to_string(),
            type_: "system".to_string(),
        },
        ToolLabel {
            id: uuid::Uuid::new_v4(),
            name: "SENT".to_string(),
            type_: "system".to_string(),
        },
        ToolLabel {
            id: uuid::Uuid::new_v4(),
            name: "Work".to_string(),
            type_: "user".to_string(),
        },
    ];

    let summary = build_summary(&labels);
    assert!(summary.contains("2 system labels"));
    assert!(summary.contains("1 custom label"));
    assert!(summary.starts_with("Found"));
}

#[test]
fn test_update_thread_labels_schema_validation() {
    let result = generate_validated_input_schema::<UpdateThreadLabels>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "UpdateThreadLabels",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("label"),
        "Description should contain expected text"
    );
}

#[test]
fn test_send_email_schema_validation() {
    let result = generate_validated_input_schema::<SendEmail>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "SendEmail",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("send"),
        "Description should contain expected text"
    );
}

#[test]
fn test_get_thread_schema_validation() {
    let result = generate_validated_input_schema::<GetThread>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "GetThread",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("thread"),
        "Description should contain expected text"
    );
}

#[test]
fn test_list_inboxes_schema_validation() {
    let result = generate_validated_input_schema::<ListInboxes>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ListInboxes",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("inbox"),
        "Description should contain expected text"
    );
}

#[test]
fn resolve_inbox_selector_defaults_to_caller_primary() {
    // The delegated inbox is primary for its own account but must not be chosen
    // as the caller's default — only is_primary AND owned by the caller counts.
    let inboxes = vec![
        make_link("macro|gabtest2@macro.com", "gabtest2@macro.com", true),
        make_link("macro|gab@macro.com", "gabtest1@macro.com", false),
        make_link("macro|gab@macro.com", "gab@macro.com", true),
    ];
    let link = resolve_inbox_selector(&inboxes, "macro|gab@macro.com", None).unwrap();
    assert_eq!(link.email_address.0.as_ref(), "gab@macro.com");
}

#[test]
fn resolve_inbox_selector_matches_address_case_insensitively() {
    let inboxes = vec![
        make_link("macro|gab@macro.com", "gab@macro.com", true),
        make_link("macro|gabtest2@macro.com", "gabtest2@macro.com", true),
    ];
    let link = resolve_inbox_selector(&inboxes, "macro|gab@macro.com", Some("GabTest2@macro.com"))
        .unwrap();
    assert_eq!(link.email_address.0.as_ref(), "gabtest2@macro.com");
}

#[test]
fn test_set_sender_policy_schema_validation() {
    let result = generate_validated_input_schema::<SetSenderPolicy>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "SetSenderPolicy",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("block"),
        "Description should contain expected text"
    );
}

#[test]
fn tool_sender_policy_deserializes_snake_case_values() {
    assert_eq!(
        serde_json::from_str::<ToolSenderPolicy>("\"signal\"").unwrap(),
        ToolSenderPolicy::Signal
    );
    assert_eq!(
        serde_json::from_str::<ToolSenderPolicy>("\"noise\"").unwrap(),
        ToolSenderPolicy::Noise
    );
    assert_eq!(
        serde_json::from_str::<ToolSenderPolicy>("\"block\"").unwrap(),
        ToolSenderPolicy::Block
    );
    assert!(serde_json::from_str::<ToolSenderPolicy>("\"unknown\"").is_err());
}

#[test]
fn resolve_inbox_selector_rejects_unknown_address() {
    let inboxes = vec![make_link("macro|gab@macro.com", "gab@macro.com", true)];
    // Avoid `unwrap_err` so the test does not require `Link: Debug`.
    let err = resolve_inbox_selector(&inboxes, "macro|gab@macro.com", Some("nope@macro.com"))
        .err()
        .expect("unknown inbox address should error");
    assert!(
        err.description.contains("No connected inbox matches"),
        "{}",
        err.description
    );
}

/// The composer's export, as `prepareEmailBody` encodes it: base64url of the
/// body element's outer HTML, unpadded.
fn composer_body(html: &str) -> String {
    URL_SAFE_NO_PAD.encode(html)
}

#[test]
fn composer_html_is_recognized_and_left_alone() {
    let encoded = composer_body("<body><p>hello</p></body>");

    let decoded = decode_composer_html(&encoded).expect("composer body");

    assert_eq!(decoded, "<body><p>hello</p></body>");
}

#[test]
fn model_markdown_is_not_mistaken_for_composer_html() {
    // Whitespace and punctuation put real prose outside the base64url
    // alphabet, so the decode fails before the tag check matters.
    for body in [
        "Hello world",
        "Hi Dana,\n\nFollowing up on the **Q3 migration**.",
        "- one\n- two",
        "# Heading",
    ] {
        assert!(
            decode_composer_html(body).is_none(),
            "markdown treated as composer html: {body}"
        );
    }
}

#[test]
fn base64_that_decodes_to_prose_is_not_treated_as_html() {
    // A single word can be valid base64url by accident; only markup counts.
    let encoded = composer_body("just prose, no markup");

    assert!(decode_composer_html(&encoded).is_none());
}

#[test]
fn leading_whitespace_before_the_tag_still_counts_as_html() {
    let encoded = composer_body("\n  <div>hi</div>");

    assert!(decode_composer_html(&encoded).is_some());
}
