use super::*;
use crate::domain::models::SlackConversationKind;
use ai_toolset::{RequestSchema, ToolCallError, ToolResult, ToolSetError};
use mcp_select::ConnectorRef;
use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::Mutex;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|import@example.com").unwrap()
}

#[derive(Default)]
struct Tools {
    schemas: HashMap<String, Value>,
    responses: Mutex<VecDeque<ToolResult<Value>>>,
    calls: Mutex<Vec<(String, Value)>>,
}

impl ToolSet<()> for Tools {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: (),
        caller: RequestContext,
        name: &'a str,
        arguments: &'a Value,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult<Value>, ToolSetError>> + Send + 'a>> {
        assert_eq!(caller.user_id, user());
        self.calls
            .lock()
            .unwrap()
            .push((name.into(), arguments.clone()));
        let result = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected call");
        Box::pin(async { Ok(result) })
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        Some(
            self.schemas
                .iter()
                .map(|(name, schema)| RequestSchema {
                    name: name.clone(),
                    schema: serde_json::from_value(schema.clone()).unwrap(),
                })
                .collect(),
        )
    }
}

fn fixture_tools() -> Tools {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/tools_list.json")).unwrap();
    Tools {
        schemas: fixture["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| {
                (
                    format!("mcp__Slack__{}", tool["name"].as_str().unwrap()),
                    tool["inputSchema"].clone(),
                )
            })
            .collect(),
        ..Tools::default()
    }
}

// Match the MCP toolset's conversion: structuredContent if supplied, otherwise
// text content. T01 fixtures are synthetic, not verified live recordings.
fn fixture_result(fixture: &str) -> Value {
    let fixture: Value = serde_json::from_str(fixture).unwrap();
    assert_eq!(fixture["isError"], false);
    fixture
        .get("structuredContent")
        .cloned()
        .unwrap_or_else(|| {
            json!(
                fixture["content"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|content| content["text"].as_str().unwrap())
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        })
}

#[tokio::test]
async fn fixture_tools_return_channels_members_and_users() {
    let tools = fixture_tools();
    tools.responses.lock().unwrap().extend([
        Ok(fixture_result(include_str!("fixtures/list_channels.json"))),
        Ok(fixture_result(include_str!("fixtures/list_members.json"))),
        Ok(fixture_result(include_str!("fixtures/list_users.json"))),
    ]);
    let schemas = tool_schemas(&tools);
    let channels_tool = resolve_tool(&schemas, Listing::Channels).unwrap();
    let arguments = listing_arguments(&schemas[&channels_tool], None, None, true);
    assert_eq!(
        arguments,
        json!({
            "limit": 200, "types": "public_channel", "exclude_archived": false
        })
    );
    let channels = parse::parse_slack_channel_page(
        call_channels(&tools, &user(), &channels_tool, &arguments, true)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(channels.conversations.len(), 2);
    assert_eq!(
        channels.conversations[0].kind,
        SlackConversationKind::PublicChannel
    );
    assert_eq!(channels.conversations[0].name, "example-public");
    assert_eq!(
        channels.conversations[0].purpose.as_deref(),
        Some("Synthetic public channel")
    );
    assert_eq!(channels.conversations[0].member_count, Some(3));
    assert_eq!(
        channels.conversations[1].kind,
        SlackConversationKind::PrivateChannel
    );
    assert_eq!(channels.next_cursor, None);

    let members_tool = resolve_tool(&schemas, Listing::Members).unwrap();
    let arguments = listing_arguments(
        &schemas[&members_tool],
        Some("page-2"),
        Some(&channels.conversations[0].id),
        false,
    );
    assert_eq!(
        arguments,
        json!({"channel": "C0000000001", "limit": 200, "cursor": "page-2"})
    );
    let members = parse::parse_member_page(
        call_tool(&tools, &user(), &members_tool, &arguments)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        members
            .members
            .iter()
            .map(|id| id.as_str())
            .collect::<Vec<_>>(),
        ["U0000000001", "U0000000002"]
    );
    assert_eq!(members.next_cursor.as_deref(), Some("synthetic-next-page"));

    let users_tool = resolve_tool(&schemas, Listing::Users).unwrap();
    let arguments = listing_arguments(&schemas[&users_tool], None, None, false);
    let users = parse::parse_user_page(
        call_tool(&tools, &user(), &users_tool, &arguments)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(users.users.len(), 3);
    assert_eq!(users.users[0].display_name, "Example");
    assert_eq!(users.users[0].email.as_deref(), Some("human@example.com"));
    assert!(users.users[1].is_bot);
    assert_eq!(users.users[1].email, None);
    assert!(users.users[2].deleted);
    assert_eq!(users.users[2].display_name, "Example Deleted");
    assert_eq!(users.next_cursor, None);
    assert_eq!(tools.calls.lock().unwrap().len(), 3);
}

#[test]
fn exact_tool_names_take_precedence_over_shapes_and_legacy_names() {
    let mut schemas = tool_schemas(&fixture_tools());
    for (listing, action, shape) in [
        (
            Listing::Channels,
            "list-channels",
            "search-all-conversations",
        ),
        (
            Listing::Members,
            "list-members-in-channel",
            "get-conversation-members",
        ),
        (Listing::Users, "list-users", "list-workspace-users"),
    ] {
        let legacy = format!("mcp__Slack__slack-{action}");
        let exact = format!("mcp__Slack__slack_v2-{action}");
        schemas.insert(legacy.clone(), json!({}));
        schemas.insert(shape.into(), json!({}));
        assert_eq!(resolve_tool(&schemas, listing).unwrap(), exact);
        schemas.remove(&exact);
        assert_eq!(resolve_tool(&schemas, listing).unwrap(), legacy);
        schemas.remove(&legacy);
        assert_eq!(resolve_tool(&schemas, listing).unwrap(), shape);
    }
}

#[test]
fn resolution_rejects_unrelated_tools_and_reports_missing_capabilities() {
    let schemas = [
        "list-channel-messages",
        "list-channel-history",
        "create-channel",
        "find-user-by-email",
        "list-user-groups",
        "list-channel-users",
    ]
    .into_iter()
    .map(|name| (format!("mcp__Slack__{name}"), json!({})))
    .collect();
    for (listing, expected) in [
        (Listing::Channels, "channel listing"),
        (Listing::Members, "members"),
        (Listing::Users, "users"),
    ] {
        assert!(
            matches!(resolve_tool(&schemas, listing), Err(SlackSourceError::ToolsUnavailable(capability)) if capability == expected)
        );
    }
    assert!(is_slack_channel_search_tool_name(
        "mcp__Slack__SEARCH-ALL-CONVERSATIONS"
    ));
    assert!(!is_slack_channel_search_tool_name(
        "mcp__list_channels__unrelated"
    ));
}

#[test]
fn arguments_use_only_declared_properties_and_channel_alias() {
    let conversation = SlackConversationId::new("C123").unwrap();
    assert_eq!(
        listing_arguments(&json!({}), Some("next"), Some(&conversation), true),
        json!({})
    );
    for key in ["channel", "conversation", "channel_id"] {
        let schema = json!({"properties": {key: {"type": "string"}, "limit": {}}});
        assert_eq!(
            listing_arguments(&schema, Some("next"), Some(&conversation), false),
            json!({key: "C123", "limit": 200})
        );
    }
    let schema = json!({"properties": {"cursor": {}, "types": {"type": "array"}, "query": {}, "exclude_archived": {}}});
    assert_eq!(
        listing_arguments(&schema, Some("next"), None, true),
        json!({
            "cursor": "next", "types": ["public_channel"], "query": "", "exclude_archived": false
        })
    );
    assert!(
        listing_arguments(&schema, None, None, true)
            .get("cursor")
            .is_none()
    );
}

#[test]
fn channels_preserve_kinds_archive_and_counts_and_drop_invalid_ids() {
    let page = parse::parse_slack_channel_page(json!({"ret": {"data": [
        {"id": "C123", "name": " #general ", "is_private": false, "is_archived": true, "member_count": 42, "topic": {"value": " topic "}},
        {"id": "C124", "name": "private", "is_private": true},
        {"channel_id": "G123", "channel_name": "group", "is_group": true, "description": "description"},
        {"id": "D123", "is_im": true},
        {"id": "G124", "is_mpim": true},
        {"id": "invalid", "name": "bad"}, {"name": "missing"}, {"id": " C125", "name": "bad"}
    ]}, "response_metadata": {"next_cursor": " next "}})).unwrap();
    assert_eq!(page.conversations.len(), 5);
    assert_eq!(page.next_cursor.as_deref(), Some("next"));
    let first = &page.conversations[0];
    assert_eq!(first.name, "general");
    assert!(first.archived);
    assert_eq!(first.member_count, Some(42));
    assert_eq!(first.purpose.as_deref(), Some("topic"));
    assert_eq!(
        page.conversations
            .iter()
            .map(|channel| &channel.kind)
            .collect::<Vec<_>>(),
        vec![
            &SlackConversationKind::PublicChannel,
            &SlackConversationKind::PrivateChannel,
            &SlackConversationKind::PrivateChannel,
            &SlackConversationKind::DirectMessage,
            &SlackConversationKind::GroupDirectMessage
        ]
    );
    assert_eq!(page.conversations[3].name, "D123");
}

#[test]
fn channels_require_explicit_visibility_without_relying_on_is_channel() {
    for is_channel in [None, Some(json!(true)), Some(json!(false))] {
        for visibility in [
            None,
            Some(Value::Null),
            Some(json!("false")),
            Some(json!("true")),
            Some(json!(0)),
            Some(json!(1)),
            Some(json!([])),
            Some(json!({})),
            Some(json!(false)),
            Some(json!(true)),
        ] {
            let mut channel = json!({"id": "C123", "name": "channel"});
            if let Some(is_channel) = &is_channel {
                channel["is_channel"] = is_channel.clone();
            }
            if let Some(visibility) = &visibility {
                channel["is_private"] = visibility.clone();
            }
            let page = parse::parse_slack_channel_page(json!([channel])).unwrap();
            let expected = match visibility.and_then(|value| value.as_bool()) {
                Some(false) => vec![SlackConversationKind::PublicChannel],
                Some(true) => vec![SlackConversationKind::PrivateChannel],
                None => vec![],
            };
            assert_eq!(
                page.conversations
                    .into_iter()
                    .map(|channel| channel.kind)
                    .collect::<Vec<_>>(),
                expected,
                "channel: {channel}"
            );
        }
    }
}

#[test]
fn explicit_private_and_dm_kinds_take_precedence_over_public_visibility() {
    for (flag, expected) in [
        ("is_group", SlackConversationKind::PrivateChannel),
        ("is_im", SlackConversationKind::DirectMessage),
        ("is_mpim", SlackConversationKind::GroupDirectMessage),
    ] {
        let page = parse::parse_slack_channel_page(json!([
            {"id": "C123", "is_private": false, "is_channel": true, flag: true}
        ]))
        .unwrap();
        assert_eq!(page.conversations.len(), 1);
        assert_eq!(page.conversations[0].kind, expected);
    }
}

#[test]
fn channel_wrappers_and_cursor_aliases_include_empty_pages() {
    for wrapper in ["channels", "results", "items", "matches", "data", "ret"] {
        for cursor_key in ["next_cursor", "nextCursor", "cursor"] {
            let page = parse::parse_slack_channel_page(json!({wrapper: [], cursor_key: " more "}))
                .unwrap();
            assert!(page.conversations.is_empty());
            assert_eq!(page.next_cursor.as_deref(), Some("more"));
        }
    }
    let page = parse::parse_slack_channel_page(
        json!({"channels": {"items": [], "next_cursor": "inner"}, "next_cursor": "outer"}),
    )
    .unwrap();
    assert_eq!(page.next_cursor.as_deref(), Some("inner"));
    let page = parse::parse_slack_channel_page(
        json!({"id": "C123", "name": "single", "is_private": false, "next_cursor": " "}),
    )
    .unwrap();
    assert_eq!(page.conversations.len(), 1);
    assert_eq!(page.next_cursor, None);
}

#[test]
fn members_accept_ids_objects_text_arrays_and_wrappers() {
    let rows = json!(["U123", {"id": "W123"}, {"user": "U124"}, "bad", {"id": "C123"}, null]);
    for wrapper in ["members", "users", "data", "ret"] {
        let page =
            parse::parse_member_page(json!({wrapper: rows.to_string(), "next_cursor": "more"}))
                .unwrap();
        assert_eq!(
            page.members
                .iter()
                .map(|id| id.as_str())
                .collect::<Vec<_>>(),
            ["U123", "W123", "U124"]
        );
        assert_eq!(page.next_cursor.as_deref(), Some("more"));
    }
    assert_eq!(parse::parse_member_page(rows).unwrap().members.len(), 3);
}

#[test]
fn users_apply_display_name_fallbacks_without_filtering_bots_or_deleted() {
    let rows = json!([
        {"id": "U123", "name": "handle", "real_name": "Real", "profile": {"display_name": " Display ", "email": " person@example.com "}},
        {"id": "U124", "name": "handle", "real_name": "Real", "profile": {"display_name": " "}, "deleted": true},
        {"id": "U125", "name": "handle", "profile": null, "is_bot": true},
        {"id": "W123"}, {"id": "bad"}, {"name": "missing"}
    ]);
    for wrapper in ["members", "users", "data", "ret"] {
        let page = parse::parse_user_page(json!({wrapper: rows.to_string()})).unwrap();
        assert_eq!(
            page.users
                .iter()
                .map(|user| user.display_name.as_str())
                .collect::<Vec<_>>(),
            ["Display", "Real", "handle", "W123"]
        );
        assert_eq!(page.users[0].email.as_deref(), Some("person@example.com"));
        assert!(page.users[1].deleted);
        assert!(page.users[2].is_bot);
        assert_eq!(page.users[3].email, None);
    }
    assert_eq!(parse::parse_user_page(rows).unwrap().users.len(), 4);
}

#[test]
fn malformed_unknown_truncated_and_action_errors_are_not_empty_pages() {
    for value in [
        json!("not JSON"),
        json!("{\"members\":["),
        json!({"unexpected": []}),
        json!(null),
        json!({"members": [], "truncated": true}),
    ] {
        assert!(parse::parse_member_page(value.clone()).is_err());
        assert!(parse::parse_user_page(value.clone()).is_err());
        assert!(parse::parse_slack_channel_page(value).is_err());
    }
    assert!(matches!(
        parse::parse_user_page(json!({"ret": {"ok": false, "error": "missing_scope"}})),
        Err(SlackSourceError::MissingScope(_))
    ));
    assert!(matches!(
        parse::parse_member_page(json!({"ok": false, "error": "ratelimited"})),
        Err(SlackSourceError::RateLimited { retry_after: None })
    ));
}

fn tool_error(description: &str) -> ToolResult<Value> {
    Err(ToolCallError {
        internal_error: anyhow::anyhow!("synthetic tool failure"),
        description: description.into(),
    })
}

#[tokio::test]
async fn retries_first_channel_page_without_arguments_only_once() {
    let tools = Tools::default();
    tools
        .responses
        .lock()
        .unwrap()
        .extend([tool_error("empty query rejected"), Ok(json!([]))]);
    assert_eq!(
        call_channels(&tools, &user(), "channels", &json!({"query": ""}), true)
            .await
            .unwrap(),
        json!([])
    );
    assert_eq!(
        *tools.calls.lock().unwrap(),
        vec![
            ("channels".into(), json!({"query": ""})),
            ("channels".into(), json!({}))
        ]
    );
    for (arguments, first_page) in [(json!({}), true), (json!({"cursor": "next"}), false)] {
        let tools = Tools::default();
        tools
            .responses
            .lock()
            .unwrap()
            .push_back(tool_error("failure"));
        assert!(
            call_channels(&tools, &user(), "channels", &arguments, first_page)
                .await
                .is_err()
        );
        assert_eq!(tools.calls.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn tool_errors_map_rate_limits_and_scopes_without_retrying() {
    for message in [
        "ratelimited: retry after 12 seconds",
        "RATE_LIMITED: Retry-After: 12",
        "HTTP 429 retry after 12",
    ] {
        let tools = Tools::default();
        tools
            .responses
            .lock()
            .unwrap()
            .push_back(tool_error(message));
        assert!(
            matches!(call_channels(&tools, &user(), "channels", &json!({"limit": 200}), true).await,
            Err(SlackSourceError::RateLimited { retry_after: Some(delay) }) if delay == Duration::from_secs(12))
        );
        assert_eq!(tools.calls.lock().unwrap().len(), 1);
    }
    for message in [
        "429",
        "ratelimited retry after unknown",
        "rate_limited retry after 999999999999999999999999999",
    ] {
        assert!(matches!(
            source_error(message.into()),
            SlackSourceError::RateLimited { retry_after: None }
        ));
    }
    let tools = Tools::default();
    tools
        .responses
        .lock()
        .unwrap()
        .push_back(tool_error("missing_scope users:read.email"));
    assert!(
        matches!(call_channels(&tools, &user(), "channels", &json!({"limit": 200}), true).await, Err(SlackSourceError::MissingScope(text)) if text.contains("users:read.email"))
    );
    assert_eq!(tools.calls.lock().unwrap().len(), 1);
    assert!(matches!(
        source_error("other failure".into()),
        SlackSourceError::Other(_)
    ));
}

#[test]
fn rate_limit_status_requires_a_standalone_token() {
    for message in [
        "429",
        "HTTP 429 Too Many Requests",
        "status=429; retry later",
        "HTTP error (429)",
        r#"{"status":429}"#,
        "429: rate limit",
    ] {
        assert!(
            matches!(
                source_error(message.into()),
                SlackSourceError::RateLimited { retry_after: None }
            ),
            "message: {message}"
        );
    }
    for token in [
        "C429ABC", "C429", "429ABC", "1429", "4290", "14290", "id_429",
    ] {
        let message = format!("request failed for {token}");
        assert!(
            matches!(source_error(message), SlackSourceError::Other(_)),
            "token: {token}"
        );
        let message = format!("missing_scope for {token}");
        assert!(
            matches!(source_error(message), SlackSourceError::MissingScope(_)),
            "token: {token}"
        );
    }
}

struct NoConnector;
impl ConnectorSelect for NoConnector {
    async fn user_toolset(&self, _: &MacroUserIdStr<'static>) -> UserMcpTools {
        panic!("must request only the Slack connector")
    }

    async fn connector_toolset(
        &self,
        caller: &MacroUserIdStr<'static>,
        connector: ConnectorRef<'_>,
    ) -> anyhow::Result<Option<UserMcpTools>> {
        assert_eq!(caller, &user());
        let slack = ImportSource::Slack.connector_ref();
        assert_eq!(connector.pipedream_app_slugs, slack.pipedream_app_slugs);
        assert_eq!(connector.native_server_url, slack.native_server_url);
        Ok(None)
    }

    async fn connector_connected(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ConnectorRef<'_>,
    ) -> anyhow::Result<bool> {
        panic!("opening a session must load its toolset directly")
    }
}

#[tokio::test]
async fn no_connector_is_not_connected() {
    assert!(matches!(
        McpSlackSource::new(Arc::new(NoConnector))
            .open(&user())
            .await,
        Err(SlackSourceError::NotConnected)
    ));
}
