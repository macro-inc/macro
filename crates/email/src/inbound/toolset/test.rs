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

/// The confirmed variant takes exactly `SendEmail`'s fields plus the
/// confirmation, and the confirmation is required: the schema is the gate.
#[test]
fn send_confirmed_email_is_send_email_plus_a_required_confirmation() {
    let confirmed = generate_validated_input_schema::<SendConfirmedEmail>().unwrap();
    let plain = generate_validated_input_schema::<SendEmail>().unwrap();
    assert_eq!(confirmed.name, "SendConfirmedEmail");
    assert!(
        confirmed.description.contains("userConfirmation"),
        "{}",
        confirmed.description
    );

    let confirmed = confirmed.schema.to_value();
    let plain = plain.schema.to_value();
    let properties = |schema: &serde_json::Value| {
        let mut names: Vec<String> = schema["properties"]
            .as_object()
            .expect("an object schema")
            .keys()
            .cloned()
            .collect();
        names.sort();
        names
    };
    let mut expected = properties(&plain);
    expected.push("userConfirmation".to_owned());
    expected.sort();
    assert_eq!(properties(&confirmed), expected);
    assert!(
        confirmed["required"]
            .as_array()
            .expect("required is an array")
            .contains(&serde_json::json!("userConfirmation")),
        "{confirmed:#}"
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

#[test]
fn outlook_system_labels_become_mailbox_states() {
    use crate::domain::models::mailbox_action::MailboxAction;
    use crate::inbound::toolset::update_thread_labels::outlook_mailbox_state;

    let state = |label: &str, add: bool| outlook_mailbox_state(label, add).map(|r| r.ok());
    assert!(matches!(
        state("INBOX", false),
        Some(Some(MailboxAction::Archived(true)))
    ));
    assert!(matches!(
        state("unread", false),
        Some(Some(MailboxAction::Read(true)))
    ));
    assert!(matches!(
        state("STARRED", true),
        Some(Some(MailboxAction::Flagged(true)))
    ));
    assert!(matches!(
        state("SPAM", true),
        Some(Some(MailboxAction::Junk(true)))
    ));
    // No Outlook equivalent: a clear failure, not "no label named".
    assert!(matches!(
        outlook_mailbox_state("IMPORTANT", true),
        Some(Err(_))
    ));
    // Anything else is an Outlook category, labelled as before.
    assert!(outlook_mailbox_state("Finance", true).is_none());
}

/// An access service that is never reached, for calls rejected before any
/// access check.
mod unreachable_access {
    use entity_access::domain::models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
    };
    use entity_access::domain::ports::EntityAccessService;
    use macro_user_id::lowercased::Lowercase;
    use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
    use uuid::Uuid;

    #[derive(Clone)]
    pub(super) struct UnreachableAccessService;

    impl EntityAccessService for UnreachableAccessService {
        async fn generate_entity_access_receipt<T: RequiredPermission>(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
            _user_org_id: Option<i64>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<EntityAccessReceipt<T>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
            &self,
            _bot_id: BotId,
            _scope: BotAccessScope,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<EntityAccessReceipt<T>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_access_level(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<Option<AccessLevel>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn check_access(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> std::result::Result<AccessLevel, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn check_public_access(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> std::result::Result<AccessLevel, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_entity_permission(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _user_org_id: Option<i64>,
        ) -> std::result::Result<EntityPermission, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_crm_entity_permission_with_team(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<(EntityPermission, Uuid, TeamRole), AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_users_by_entity(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<Vec<MacroUserIdStr<'static>>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_call_channel(
            &self,
            _call_id: &sqlx::types::Uuid,
        ) -> std::result::Result<Option<CallChannelInfo>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_call_channel_by_channel_id(
            &self,
            _channel_id: &sqlx::types::Uuid,
        ) -> std::result::Result<Option<CallChannelInfo>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }

        async fn get_user_team(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
        ) -> std::result::Result<Option<UserTeamInfo>, AccessError> {
            unreachable!("the selector check returns before any access check")
        }
    }
}

#[tokio::test]
async fn a_label_named_both_ways_or_not_at_all_fails_before_any_provider_acts() {
    use super::update_thread_labels::UpdateThreadLabels;
    use crate::domain::ports::{NoOpEmailService, NoOpGmailTokenProvider};
    use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
    use std::sync::Arc;

    // Any service call would fail differently: this service resolves no
    // thread, so reaching it would report a missing inbox instead.
    let context = EmailToolContext::new(
        Arc::new(NoOpEmailService),
        Arc::new(NoOpGmailTokenProvider),
        Arc::new(unreachable_access::UnreachableAccessService),
        Arc::new(lexical_client::LexicalClient::new(
            String::new(),
            String::new(),
        )),
    );
    let call = |label_id: Option<uuid::Uuid>, label: Option<&str>| {
        let tool = UpdateThreadLabels {
            thread_id: uuid::Uuid::nil(),
            label_id,
            label: label.map(str::to_owned),
            add: false,
        };
        let context = context.clone();
        async move {
            tool.call(
                ServiceContext(context),
                RequestContext::new(
                    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                ),
            )
            .await
        }
    };
    for (label_id, label) in [(Some(uuid::Uuid::nil()), Some("INBOX")), (None, None)] {
        let error = call(label_id, label).await.unwrap_err();
        assert_eq!(
            error.description,
            "Pass exactly one of `label` or `label_id`."
        );
    }
}
