use super::*;
use crate::domain::{MemberId, Money, StageId};
use connectors::Connectors;
use connectors::fake::{FakeConnection, FakeConnectors};
use rmcp::model::{CallToolResult, ContentBlock};
use uuid::Uuid;

const ATTIO_SERVER: &str = "https://mcp.attio.com/mcp";

const WHOAMI: &str = include_str!("fixtures/ASSUMED_whoami.json");
const OBJECTS: &str = include_str!("fixtures/ASSUMED_list_objects.json");
const OBJECTS_NO_DEALS: &str = include_str!("fixtures/ASSUMED_list_objects_no_deals.json");
const MEMBERS: &str = include_str!("fixtures/ASSUMED_list_workspace_members.json");
const ATTRIBUTES_COMPANIES: &str =
    include_str!("fixtures/ASSUMED_attribute_definitions_companies.json");
const ATTRIBUTES_PEOPLE: &str = include_str!("fixtures/ASSUMED_attribute_definitions_people.json");
const ATTRIBUTES_DEALS: &str = include_str!("fixtures/ASSUMED_attribute_definitions_deals.json");
const COMPANIES: &str = include_str!("fixtures/ASSUMED_list_records_companies.json");
const COMPANIES_PAGE2: &str = include_str!("fixtures/ASSUMED_list_records_companies_page2.json");
const PEOPLE: &str = include_str!("fixtures/ASSUMED_list_records_people.json");
const DEALS: &str = include_str!("fixtures/ASSUMED_list_records_deals.json");
const EMPTY_PAGE: &str = r#"{"data": []}"#;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn structured(json: &str) -> CallToolResult {
    CallToolResult::structured(serde_json::from_str(json).unwrap())
}

fn json_text(json: &str) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(json)])
}

fn uuid(value: &str) -> Uuid {
    value.parse().unwrap()
}

fn attio(connection: FakeConnection) -> (FakeConnectors, AttioMcp<Connectors>) {
    let fake = FakeConnectors::new()
        .with_overlay(ATTIO_APP, ATTIO_SERVER)
        .with_connection(&user(), connection);
    let service = Arc::new(fake.build());
    (fake, AttioMcp::new(service))
}

/// Every fixture, answered in the order a full read asks for them.
fn whole_workspace(answer: fn(&str) -> CallToolResult) -> FakeConnection {
    FakeConnection::app(ATTIO_APP)
        .answering_tool("whoami", [answer(WHOAMI)])
        .answering_tool("list-objects", [answer(OBJECTS)])
        .answering_tool("list-workspace-members", [answer(MEMBERS)])
        .answering_tool(
            "list-attribute-definitions",
            [
                answer(ATTRIBUTES_COMPANIES),
                answer(ATTRIBUTES_PEOPLE),
                answer(ATTRIBUTES_DEALS),
            ],
        )
        .answering_tool(
            "list-records",
            [
                answer(COMPANIES),
                answer(COMPANIES_PAGE2),
                answer(EMPTY_PAGE),
                answer(PEOPLE),
                answer(EMPTY_PAGE),
                answer(DEALS),
                answer(EMPTY_PAGE),
            ],
        )
}

fn ignore_progress(_: ReadProgress) {}

#[tokio::test(start_paused = true)]
async fn reads_a_whole_workspace() {
    let (fake, attio) = attio(whole_workspace(structured));
    let seen = Mutex::new(Vec::new());

    let inventory = attio
        .inventory(&user(), &|progress| seen.lock().unwrap().push(progress))
        .await
        .unwrap();

    assert_eq!(
        inventory,
        Inventory {
            workspace: Workspace {
                id: uuid("1a1a1a1a-0000-4000-8000-000000000001"),
                slug: Some("example-workspace".into()),
            },
            members: vec![
                Member {
                    id: MemberId(uuid("e0000000-0000-4000-8000-000000000001")),
                    email: Some("ada@example.com".into()),
                },
                Member {
                    id: MemberId(uuid("e0000000-0000-4000-8000-000000000002")),
                    email: Some("bo@sample.test".into()),
                },
            ],
            stages: vec![
                Stage {
                    id: StageId(uuid("5a000000-0000-4000-8000-000000000001")),
                    title: "Lead".into(),
                    celebration_enabled: false,
                    archived: false,
                },
                Stage {
                    id: StageId(uuid("5a000000-0000-4000-8000-000000000002")),
                    title: "In Progress".into(),
                    celebration_enabled: false,
                    archived: false,
                },
                Stage {
                    id: StageId(uuid("5a000000-0000-4000-8000-000000000003")),
                    title: "Won 🎉".into(),
                    celebration_enabled: true,
                    archived: false,
                },
                Stage {
                    id: StageId(uuid("5a000000-0000-4000-8000-000000000004")),
                    title: "Lost".into(),
                    celebration_enabled: false,
                    archived: false,
                },
                Stage {
                    id: StageId(uuid("5a000000-0000-4000-8000-000000000005")),
                    title: "Parked".into(),
                    celebration_enabled: false,
                    archived: true,
                },
            ],
            companies: vec![
                Company {
                    id: RecordId(uuid("c0000000-0000-4000-8000-000000000001")),
                    name: Some("Example Anvils".into()),
                    domains: vec!["anvils.example.com".into(), "anvils.test".into()],
                },
                Company {
                    id: RecordId(uuid("c0000000-0000-4000-8000-000000000002")),
                    name: Some("Sample Rockets".into()),
                    domains: vec![],
                },
                Company {
                    id: RecordId(uuid("c0000000-0000-4000-8000-000000000003")),
                    name: None,
                    domains: vec!["widgets.test".into()],
                },
            ],
            people: vec![
                Person {
                    id: RecordId(uuid("a0000000-0000-4000-8000-000000000001")),
                    full_name: Some("Grace Sample".into()),
                    first_name: Some("Grace".into()),
                    last_name: Some("Sample".into()),
                    emails: vec!["grace@anvils.example.com".into()],
                    company: Some(RecordId(uuid("c0000000-0000-4000-8000-000000000001"))),
                },
                Person {
                    id: RecordId(uuid("a0000000-0000-4000-8000-000000000002")),
                    full_name: None,
                    first_name: Some("Linus".into()),
                    last_name: Some("Example".into()),
                    emails: vec![
                        "linus@rockets.test".into(),
                        "linus.example@example.com".into()
                    ],
                    company: None,
                },
            ],
            deals: vec![
                Deal {
                    id: RecordId(uuid("d0000000-0000-4000-8000-000000000001")),
                    name: Some("Anvil renewal".into()),
                    stage: Some(StageId(uuid("5a000000-0000-4000-8000-000000000003"))),
                    value: Some(Money {
                        amount: 12500.5,
                        currency: Some("USD".into()),
                    }),
                    owner: Some(MemberId(uuid("e0000000-0000-4000-8000-000000000002"))),
                    company: Some(RecordId(uuid("c0000000-0000-4000-8000-000000000001"))),
                    people: vec![
                        RecordId(uuid("a0000000-0000-4000-8000-000000000001")),
                        RecordId(uuid("a0000000-0000-4000-8000-000000000002")),
                    ],
                },
                // Owned by an API token, not a member: no owner.
                Deal {
                    id: RecordId(uuid("d0000000-0000-4000-8000-000000000002")),
                    name: Some("Rocket pilot".into()),
                    stage: None,
                    value: None,
                    owner: None,
                    company: None,
                    people: vec![],
                },
            ],
            custom_attributes: vec![
                CustomAttributes {
                    object: Object::Companies,
                    slugs: vec!["account_tier".into(), "annual_spend".into()],
                },
                CustomAttributes {
                    object: Object::Deals,
                    slugs: vec!["renewal_quarter".into()],
                },
            ],
            warnings: vec![
                "Attio company c0000000-0000-4000-8000-000000000003: its domains value could not be read, so it is left empty."
                    .into()
            ],
        }
    );

    assert_eq!(
        seen.into_inner().unwrap(),
        vec![
            ReadProgress {
                companies: 2,
                people: 0,
                deals: 0
            },
            ReadProgress {
                companies: 3,
                people: 0,
                deals: 0
            },
            ReadProgress {
                companies: 3,
                people: 2,
                deals: 0
            },
            ReadProgress {
                companies: 3,
                people: 2,
                deals: 2
            },
        ]
    );

    // Paging advances by the records each page held, until an empty page.
    let pages: Vec<serde_json::Value> = fake
        .mcp_calls()
        .into_iter()
        .filter(|call| call.tool == "list-records")
        .map(|call| serde_json::Value::Object(call.arguments))
        .collect();
    assert_eq!(
        pages,
        vec![
            serde_json::json!({"object": "companies", "limit": 100, "offset": 0}),
            serde_json::json!({"object": "companies", "limit": 100, "offset": 2}),
            serde_json::json!({"object": "companies", "limit": 100, "offset": 3}),
            serde_json::json!({"object": "people", "limit": 100, "offset": 0}),
            serde_json::json!({"object": "people", "limit": 100, "offset": 2}),
            serde_json::json!({"object": "deals", "limit": 100, "offset": 0}),
            serde_json::json!({"object": "deals", "limit": 100, "offset": 2}),
        ]
    );
    let tools: Vec<String> = fake
        .mcp_calls()
        .into_iter()
        .map(|call| call.tool)
        .filter(|tool| tool != "list-records")
        .collect();
    assert_eq!(
        tools,
        vec![
            "whoami",
            "list-objects",
            "list-workspace-members",
            "list-attribute-definitions",
            "list-attribute-definitions",
            "list-attribute-definitions",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn json_text_answers_read_the_same_as_structured_ones() {
    let (_, structured_attio) = attio(whole_workspace(structured));
    let (_, text_attio) = attio(whole_workspace(json_text));

    let from_structured = structured_attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap();
    let from_text = text_attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap();

    assert_eq!(from_text, from_structured);
}

#[tokio::test(start_paused = true)]
async fn a_prose_answer_fails_without_quoting_it() {
    let (_, attio) = attio(FakeConnection::app(ATTIO_APP).answering_tool(
        "whoami",
        [json_text(
            "You are signed in to Example Workspace as grace@anvils.example.com.",
        )],
    ));

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    let AttioError::Decode(message) = error else {
        panic!("expected a decode error, got {error:?}");
    };
    assert_eq!(
        message,
        "Attio's whoami tool answered with text that is not JSON"
    );
}

#[tokio::test(start_paused = true)]
async fn an_unknown_shape_fails_without_quoting_it() {
    let (_, attio) = attio(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .answering_tool(
                "list-objects",
                [structured(r#"{"objects": ["Example Anvils"]}"#)],
            ),
    );

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    let AttioError::Decode(message) = error else {
        panic!("expected a decode error, got {error:?}");
    };
    assert_eq!(
        message,
        "Attio's list-objects answer has an unexpected shape"
    );
}

#[tokio::test(start_paused = true)]
async fn a_page_repeating_records_already_read_fails_the_read() {
    let (_, attio) = attio(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .answering_tool("list-objects", [structured(OBJECTS_NO_DEALS)])
            .answering_tool("list-workspace-members", [structured(MEMBERS)])
            .answering_tool(
                "list-attribute-definitions",
                [
                    structured(ATTRIBUTES_COMPANIES),
                    structured(ATTRIBUTES_PEOPLE),
                ],
            )
            // A server that ignores the offset answers the first page again.
            .answering_tool(
                "list-records",
                [structured(COMPANIES), structured(COMPANIES)],
            ),
    );

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(
        matches!(&error, AttioError::Decode(message) if message == "Attio's list-records answer repeated a company record already read"),
        "{error:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn without_deals_companies_and_people_still_import() {
    let (fake, attio) = attio(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .answering_tool("list-objects", [structured(OBJECTS_NO_DEALS)])
            .answering_tool("list-workspace-members", [structured(MEMBERS)])
            .answering_tool(
                "list-attribute-definitions",
                [
                    structured(ATTRIBUTES_COMPANIES),
                    structured(ATTRIBUTES_PEOPLE),
                ],
            )
            .answering_tool(
                "list-records",
                [
                    structured(COMPANIES),
                    structured(EMPTY_PAGE),
                    structured(PEOPLE),
                    structured(EMPTY_PAGE),
                ],
            ),
    );

    let inventory = attio.inventory(&user(), &ignore_progress).await.unwrap();

    assert_eq!(inventory.companies.len(), 2);
    assert_eq!(inventory.people.len(), 2);
    assert_eq!(inventory.deals, vec![]);
    assert_eq!(inventory.stages, vec![]);
    assert_eq!(
        inventory.warnings,
        vec![
            "Attio deals are not turned on in this workspace, so no deals or deal stages are read."
        ]
    );
    let deals_calls = fake
        .mcp_calls()
        .into_iter()
        .filter(|call| call.arguments.get("object") == Some(&serde_json::json!("deals")))
        .count();
    assert_eq!(deals_calls, 0);
}

#[tokio::test(start_paused = true)]
async fn warnings_name_records_by_id_only() {
    let (_, attio) = attio(whole_workspace(structured));

    let inventory = attio.inventory(&user(), &ignore_progress).await.unwrap();

    assert!(!inventory.warnings.is_empty());
    let content = [
        "Anvils",
        "Rockets",
        "Grace",
        "Linus",
        "Sample",
        "Example",
        "@",
        "example.com",
        ".test",
        "unreadable",
    ];
    for warning in &inventory.warnings {
        for text in content {
            assert!(!warning.contains(text), "{warning} names {text}");
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_rate_limited_call_is_retried() {
    let (fake, attio) = attio(FakeConnection::app(ATTIO_APP).answering_tool(
        "whoami",
        [
            CallToolResult::error(vec![ContentBlock::text("429: rate limit exceeded")]),
            structured(WHOAMI),
        ],
    ));
    let pacer = attio.pacer(&user());
    let read = Read {
        service: &*attio.service,
        handle: attio.handle(&user()).await.unwrap().unwrap(),
        pacer,
        warnings: Vec::new(),
    };

    let workspace: WireSelf = read.call(AttioRead::WhoAmI).await.unwrap();

    assert_eq!(
        Workspace::from(workspace).id,
        uuid("1a1a1a1a-0000-4000-8000-000000000001")
    );
    assert_eq!(fake.mcp_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_that_outlasts_every_retry_is_unavailable() {
    let limited =
        || CallToolResult::error(vec![ContentBlock::text("Too many requests, slow down")]);
    let (fake, attio) = attio(FakeConnection::app(ATTIO_APP).answering_tool(
        "whoami",
        [limited(), limited(), limited(), limited(), limited()],
    ));

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(matches!(error, AttioError::Unavailable), "{error:?}");
    assert_eq!(fake.mcp_calls().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn a_tool_error_keeps_a_bounded_explanation() {
    let explanation = format!("workspace suspended: {}", "x".repeat(500));
    let (_, attio) = attio(FakeConnection::app(ATTIO_APP).answering_tool(
        "whoami",
        [CallToolResult::error(vec![ContentBlock::text(explanation)])],
    ));

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    let AttioError::Tool { tool, message } = error else {
        panic!("expected a tool error, got {error:?}");
    };
    assert_eq!(tool, "whoami");
    assert_eq!(message.chars().count(), 200);
    assert!(message.starts_with("workspace suspended: xxx"));
}

#[tokio::test(start_paused = true)]
async fn a_tool_attio_does_not_list_is_missing() {
    let (_, attio) =
        attio(FakeConnection::app(ATTIO_APP).answering_tool("whoami", [structured(WHOAMI)]));

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(
        matches!(error, AttioError::MissingTool("list-objects")),
        "{error:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_grant_attio_revoked_needs_reauth() {
    let (_, attio) = attio(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .revoked_upstream(),
    );

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(matches!(error, AttioError::NeedsReauth), "{error:?}");
}

#[tokio::test(start_paused = true)]
async fn a_dead_grant_needs_reauth_and_is_not_connected() {
    let (_, attio) = attio(FakeConnection::app(ATTIO_APP).needs_reauth());

    let connected = attio.connected(&user()).await.unwrap();
    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(!connected);
    assert!(matches!(error, AttioError::NeedsReauth), "{error:?}");
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_server_is_a_transport_failure() {
    let (_, attio) = attio(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .unreachable(),
    );

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(matches!(error, AttioError::Transport(_)), "{error:?}");
}

#[tokio::test(start_paused = true)]
async fn without_an_attio_connection_nothing_is_read() {
    let fake = FakeConnectors::new().with_overlay(ATTIO_APP, ATTIO_SERVER);
    let attio = AttioMcp::new(Arc::new(fake.build()));

    let connected = attio.connected(&user()).await.unwrap();
    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(!connected);
    assert!(matches!(error, AttioError::NotConnected), "{error:?}");
    assert!(fake.mcp_calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_disabled_connection_is_not_connected() {
    let (_, attio) = attio(FakeConnection::app(ATTIO_APP).disabled());

    let connected = attio.connected(&user()).await.unwrap();
    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(!connected);
    assert!(matches!(error, AttioError::NotConnected), "{error:?}");
}

#[tokio::test(start_paused = true)]
async fn a_connection_is_connected_without_calling_a_tool() {
    let (fake, attio) = attio(FakeConnection::app(ATTIO_APP).answering_tool("whoami", []));

    assert!(attio.connected(&user()).await.unwrap());
    assert!(fake.mcp_calls().is_empty());
}

/// `json` with `edit` applied, for an answer one field away from a fixture.
fn edited(json: &str, edit: impl FnOnce(&mut serde_json::Value)) -> CallToolResult {
    let mut value: serde_json::Value = serde_json::from_str(json).unwrap();
    edit(&mut value);
    CallToolResult::structured(value)
}

/// A read whose first `list-records` page (companies) is `page`.
fn companies_page(page: CallToolResult) -> FakeConnection {
    FakeConnection::app(ATTIO_APP)
        .answering_tool("whoami", [structured(WHOAMI)])
        .answering_tool("list-objects", [structured(OBJECTS_NO_DEALS)])
        .answering_tool("list-workspace-members", [structured(MEMBERS)])
        .answering_tool(
            "list-attribute-definitions",
            [
                structured(ATTRIBUTES_COMPANIES),
                structured(ATTRIBUTES_PEOPLE),
            ],
        )
        .answering_tool("list-records", [page, structured(EMPTY_PAGE)])
}

async fn decode_error(connection: FakeConnection) -> String {
    let (_, attio) = attio(connection);
    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();
    let AttioError::Decode(message) = error else {
        panic!("expected a decode error, got {error:?}");
    };
    message
}

#[tokio::test(start_paused = true)]
async fn a_record_without_values_fails_the_read_instead_of_importing_its_id() {
    let message = decode_error(companies_page(edited(COMPANIES, |page| {
        for record in page["data"].as_array_mut().unwrap() {
            record.as_object_mut().unwrap().remove("values");
        }
    })))
    .await;

    assert_eq!(
        message,
        "Attio's list-records answer has an unexpected shape"
    );
}

/// The reviewer's probe: a page of bare ids with empty values (a projection,
/// or a shape this importer does not know) must not import as nameless
/// companies.
#[tokio::test(start_paused = true)]
async fn a_page_of_records_with_empty_values_fails_the_read() {
    let message = decode_error(companies_page(structured(
        r#"{"data": [{"id": {"record_id": "c0000000-0000-4000-8000-0000000000aa"}, "values": {}}]}"#,
    )))
    .await;

    assert_eq!(
        message,
        "Attio's list-records answer for companies holds no name values"
    );
}

#[tokio::test(start_paused = true)]
async fn a_page_where_no_record_carries_a_needed_attribute_fails_the_read() {
    let message = decode_error(companies_page(edited(COMPANIES, |page| {
        for record in page["data"].as_array_mut().unwrap() {
            record["values"].as_object_mut().unwrap().remove("domains");
        }
    })))
    .await;

    assert_eq!(
        message,
        "Attio's list-records answer for companies holds no domains values"
    );
}

/// Deals' attribute definitions with `edit` applied to the stage attribute.
fn deals_with_stage(edit: impl FnOnce(&mut serde_json::Value)) -> FakeConnection {
    FakeConnection::app(ATTIO_APP)
        .answering_tool("whoami", [structured(WHOAMI)])
        .answering_tool("list-objects", [structured(OBJECTS)])
        .answering_tool("list-workspace-members", [structured(MEMBERS)])
        .answering_tool(
            "list-attribute-definitions",
            [
                structured(ATTRIBUTES_COMPANIES),
                structured(ATTRIBUTES_PEOPLE),
                edited(ATTRIBUTES_DEALS, |attributes| {
                    let stage = attributes["data"]
                        .as_array_mut()
                        .unwrap()
                        .iter_mut()
                        .find(|attribute| attribute["api_slug"] == "stage")
                        .unwrap();
                    edit(stage);
                }),
            ],
        )
}

#[tokio::test(start_paused = true)]
async fn a_stage_attribute_without_inline_options_fails_loudly() {
    let message = decode_error(deals_with_stage(|stage| {
        stage.as_object_mut().unwrap().remove("options");
    }))
    .await;

    assert_eq!(
        message,
        "Attio's list-attribute-definitions answer lists the deals stage without its options"
    );
}

#[tokio::test(start_paused = true)]
async fn a_stage_option_without_its_celebration_flag_fails_loudly() {
    let message = decode_error(deals_with_stage(|stage| {
        stage["options"][2]
            .as_object_mut()
            .unwrap()
            .remove("celebration_enabled");
    }))
    .await;

    assert_eq!(
        message,
        "Attio's list-attribute-definitions answer has an unexpected shape"
    );
}

#[tokio::test(start_paused = true)]
async fn a_stage_option_without_its_archived_flag_fails_loudly() {
    let message = decode_error(deals_with_stage(|stage| {
        stage["options"][4]
            .as_object_mut()
            .unwrap()
            .remove("is_archived");
    }))
    .await;

    assert_eq!(
        message,
        "Attio's list-attribute-definitions answer has an unexpected shape"
    );
}

#[tokio::test(start_paused = true)]
async fn an_object_without_its_slug_fails_instead_of_turning_deals_off() {
    let message = decode_error(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .answering_tool(
                "list-objects",
                [edited(OBJECTS, |objects| {
                    for object in objects["data"].as_array_mut().unwrap() {
                        object.as_object_mut().unwrap().remove("api_slug");
                    }
                })],
            ),
    )
    .await;

    assert_eq!(
        message,
        "Attio's list-objects answer has an unexpected shape"
    );
}

#[test]
fn a_tool_error_says_which_tool_failed_but_not_what_attio_said() {
    let error = AttioError::Tool {
        tool: "whoami",
        message: "workspace of ada@example.com suspended".into(),
    };

    assert_eq!(error.to_string(), "Attio's whoami tool failed");
}

#[test]
fn a_tool_attio_stopped_listing_is_missing_and_a_gone_connection_is_not_connected() {
    let key = ConnectorKey::App(ConnectorId::parse(ATTIO_APP).unwrap());

    assert!(matches!(
        map_error(
            "whoami",
            ConnectorsError::ToolNotListed {
                connector: key.clone(),
                tool: "whoami".into()
            }
        ),
        AttioError::MissingTool("whoami")
    ));
    assert!(matches!(
        map_error("whoami", ConnectorsError::NotFound(key)),
        AttioError::NotConnected
    ));
}

/// The audit's probe (#12268 slice A): records with their values under
/// `attributes` and objects with `slug` instead of `api_slug`. Both used to
/// read as an empty company and a false "deals are not turned on".
#[tokio::test(start_paused = true)]
async fn the_audit_probe_shapes_fail_as_decode_errors() {
    let records = decode_error(companies_page(structured(
        r#"{"data": [{"id": {"record_id": "c0000000-0000-4000-8000-0000000000ac"}, "attributes": {"name": [{"value": "Acme"}]}}]}"#,
    )))
    .await;
    let objects = decode_error(
        FakeConnection::app(ATTIO_APP)
            .answering_tool("whoami", [structured(WHOAMI)])
            .answering_tool(
                "list-objects",
                [structured(
                    r#"{"data": [{"slug": "companies"}, {"slug": "people"}, {"slug": "deals"}]}"#,
                )],
            ),
    )
    .await;

    assert_eq!(
        records,
        "Attio's list-records answer has an unexpected shape"
    );
    assert_eq!(
        objects,
        "Attio's list-objects answer has an unexpected shape"
    );
}

#[tokio::test(start_paused = true)]
async fn a_stage_attribute_with_no_options_fails_loudly() {
    let message = decode_error(deals_with_stage(|stage| {
        stage["options"] = serde_json::json!([]);
    }))
    .await;

    assert_eq!(
        message,
        "Attio's list-attribute-definitions answer lists the deals stage without its options"
    );
}

#[tokio::test(start_paused = true)]
async fn a_server_that_never_answers_times_out_as_its_own_error() {
    let (_, attio) = attio(
        FakeConnection::app(ATTIO_APP)
            .with_tools(&["whoami"])
            .never_answering(),
    );

    let error = attio
        .inventory(&user(), &ignore_progress)
        .await
        .unwrap_err();

    assert!(matches!(error, AttioError::TimedOut("whoami")), "{error:?}");
}
