//! Toolset construction tests.
//!
//! Adding a tool to a toolset runs its input schema through
//! `generate_validated_input_schema` (via `AsyncToolObject::try_from_tool`),
//! which enforces the strict-mode requirements shared by OpenAI and
//! Anthropic. On a validation failure that path `.expect()`-panics, so a tool
//! with an unsupported schema (e.g. a `HashMap` that emits
//! `additionalProperties`) used to surface only at runtime when the service
//! built its toolset.
//!
//! These tests build every toolset the crate exposes. If any tool fails
//! schema validation, construction panics and the corresponding test fails —
//! turning that runtime failure into a test-time failure.

use super::*;
use ai_toolset::ToolSet as _;

/// `macro.connectedApps.discover` replaced the tool; only saved sessions'
/// calls to it still render.
#[test]
fn no_host_registers_connector_discovery() {
    assert!(!EAGER_TOOLS.contains(&"DiscoverConnectors"));
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        assert!(
            !tools_for(host)
                .toolset
                .tools
                .contains_key("DiscoverConnectors"),
            "{host:?}"
        );
    }
    assert!(
        !tools_for_agent_code_mode()
            .toolset
            .tools
            .contains_key("DiscoverConnectors")
    );
}

#[test]
fn no_host_offers_the_removed_subagent_tool() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        assert!(!tools.toolset.tools.contains_key("Subagent"), "{host:?}");
        // Deleted the same way: macro.activity.mine() reads the same range.
        assert!(
            !tools.toolset.tools.contains_key("ReadActivity"),
            "{host:?}"
        );
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == "Subagent"),
            "{host:?}"
        );
    }
    assert!(
        !tools_for_agent_code_mode()
            .toolset
            .tools
            .contains_key("Subagent")
    );
    assert!(!EAGER_TOOLS.contains(&"Subagent"));
}

#[test]
fn base_toolset_passes_schema_validation() {
    let tools = base_toolset();
    for name in [
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "SaveDatabaseView",
    ] {
        assert!(
            tools.tools.contains_key(name),
            "delegated agents need {name}"
        );
    }
}

#[test]
fn database_only_toolset_exposes_exactly_its_database_capabilities() {
    let tools = database_tools();
    let names = tools
        .tools
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected = [
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "SaveDatabaseView",
        "DeleteDatabaseView",
        "SaveDatabaseQuery",
    ]
    .into_iter()
    .collect();
    assert_eq!(names, expected);
    assert!(
        tools.user_tools.is_empty(),
        "database actions must not expose email/calendar composers"
    );
}

#[test]
fn every_host_toolset_passes_schema_validation() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        assert!(
            tools.toolset.tools.contains_key("GenerateImage"),
            "{host:?} must expose image generation"
        );
    }
}

/// Gemini rejects a whole request when one tool schema has a `$ref` loop of
/// required fields or nests too deeply, so every turn advertising that tool
/// fails.
#[test]
fn every_tool_schema_is_one_gemini_accepts() {
    let mut schemas = Vec::new();
    for tools in [
        tools_for(AiHost::Chat),
        tools_for(AiHost::ChannelBot),
        tools_for(AiHost::Mcp),
        tools_for_agent_code_mode(),
    ] {
        let advertised = tools.toolset.request_schemas().unwrap_or_default();
        schemas.extend(advertised.into_iter().map(|tool| (tool.name, tool.schema)));
        schemas.extend(
            tools
                .deferred
                .iter()
                .map(|tool| (tool.name.clone(), tool.schema.clone())),
        );
    }
    let base = base_toolset().request_schemas().unwrap_or_default();
    schemas.extend(base.into_iter().map(|tool| (tool.name, tool.schema)));
    assert!(schemas.iter().any(|(name, _)| name == "DisplayResults"));
    for (name, schema) in schemas {
        assert_eq!(
            ai_toolset::schema::required_ref_loop(schema.as_value()),
            None,
            "{name}"
        );
        let depth = ai_toolset::schema::nesting_depth(schema.as_value());
        assert!(
            depth <= ai_toolset::schema::GEMINI_MAX_SCHEMA_DEPTH,
            "{name} nests {depth} levels"
        );
    }
}

#[test]
fn coding_dispatch_is_available_to_every_host_but_not_the_base_toolset() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in [
            "ListCodingAgents",
            "ListAgentUpdates",
            "DispatchCodingAgent",
        ] {
            assert!(tools.toolset.tools.contains_key(name), "{host:?}: {name}");
        }
        for name in ["ListCodingAgents", "DispatchCodingAgent"] {
            assert!(tools.prompt.to_string().contains(name), "{host:?}: {name}");
        }
    }
    let base = base_toolset();
    for name in [
        "ListCodingAgents",
        "ListAgentUpdates",
        "DispatchCodingAgent",
    ] {
        assert!(!base.tools.contains_key(name));
    }
}

#[test]
fn code_mode_runs_confirmed_actions_through_the_sdk_instead_of_the_tools() {
    let tools = tools_for_agent_code_mode();
    let prompt = tools.prompt.to_string();
    for name in ["SendConfirmedEmail", "CreateConfirmedCalendarEvent"] {
        assert!(!tools.toolset.tools.contains_key(name), "{name}");
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
        assert!(!prompt.contains(name), "{name}");
    }
    assert!(prompt.contains("macro.email.sendConfirmed"));
    assert!(prompt.contains("macro.calendar.createConfirmed"));
}

#[test]
fn code_mode_starts_agents_through_the_sdk_instead_of_dispatch_tools() {
    let tools = tools_for_agent_code_mode();
    let prompt = tools.prompt.to_string();
    for name in [
        "ListCodingAgents",
        "DispatchCodingAgent",
        "CreateAgentSession",
    ] {
        assert!(!tools.toolset.tools.contains_key(name), "{name}");
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
        assert!(!prompt.contains(name), "{name}");
    }
    assert!(!tools.toolset.tools.contains_key("ListAgentUpdates"));
    assert!(prompt.contains("macro.agents.coding()"));
    assert!(prompt.contains("macro.agentSessions.createManaged"));
    assert!(
        !tools_for(AiHost::Chat)
            .prompt
            .to_string()
            .contains("createManaged")
    );
}

#[test]
fn project_workflows_are_available_in_every_host_alongside_folder_and_property_tools() {
    let names = [
        "ListInitiatives",
        "ReadInitiative",
        "CreateInitiative",
        "UpdateInitiative",
        "DeleteInitiative",
        "UpdateInitiativeSharing",
        "ReadInitiativeActivity",
        "SetEntityProperty",
        "ReadDiscussion",
        "Comment",
        "CommentOnText",
        "ResolveComment",
        "CreateProject",
        "ReadProject",
    ];
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let json = frontend_schemas_builder()
            .merge(&tools_for(host))
            .build()
            .to_json_pretty()
            .expect("schemas serialize");
        let schema: serde_json::Value = serde_json::from_str(&json).unwrap();
        let tools = schema["tools"].as_array().unwrap();
        for name in names {
            assert!(
                tools.iter().any(|tool| tool["name"] == name),
                "{host:?} must expose {name}"
            );
        }
    }
}

/// Every host, including MCP, can take the item actions the app's menus
/// offer: editing channel messages and comments, trashing, duplicating,
/// renaming, sharing, favoriting, and muting items, DMs, CRM records, calls,
/// skills, and routines.
#[test]
fn app_item_actions_are_available_in_every_host() {
    let names = [
        "EditChannelMessage",
        "DeleteChannelMessage",
        "ReactToChannelMessage",
        "OpenDirectMessage",
        "EditComment",
        "DeleteComment",
        "CreateSkill",
        "MoveToTrash",
        "DuplicateItem",
        "RenameItem",
        "UpdateSharing",
        "SetFavorite",
        "MuteNotifications",
        "RunRoutine",
        "DeleteRoutine",
        "CreateCompany",
        "CreateContact",
        "UpdateCallRecord",
        "DeleteCallRecord",
    ];
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in names {
            assert!(
                tools.toolset.tools.contains_key(name),
                "{host:?} must expose {name}"
            );
        }
    }
}

/// Every host reads the design files the native engines open, and each
/// reader's description says the file is read-only to tools.
#[test]
fn design_file_readers_are_available_in_every_host_with_their_guidance() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in [
            "ReadDesign",
            "ReadPhotoshopDocument",
            "ReadIllustratorDocument",
        ] {
            let tool = &tools.toolset.tools[name];
            assert!(
                tool.description
                    .contains("describe changes for the user to make"),
                "{host:?}: {name}"
            );
        }
    }
    assert!(base_toolset().tools.contains_key("ReadPhotoshopDocument"));
    assert!(base_toolset().tools.contains_key("ReadIllustratorDocument"));
}

/// Document answers get the one SQL tool, not a read-only twin: the access
/// they run over refuses the writes (see `databases_sql`'s view-only tests).
#[test]
fn document_answers_expose_discovery_and_the_one_query_tool() {
    let tools = database_read_only_tools();
    let names = tools
        .tools
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        names,
        ["ListDatabases", "DescribeDatabase", "QueryDatabase"]
            .into_iter()
            .collect()
    );
    assert_eq!(
        tools.tools["QueryDatabase"].annotations,
        database_tools().tools["QueryDatabase"].annotations,
        "the same QueryDatabase every host gets"
    );
    assert!(tools.user_tools.is_empty());
}

/// Hosts without a composer cannot finish a deferred user tool, so their
/// toolsets must execute calendar creation directly and omit SendEmail
/// entirely — a `UserToolResponse` output there would mean a call that
/// nothing can ever execute.
#[test]
fn composerless_hosts_execute_calendar_create_directly_and_omit_send_email() {
    for host in [AiHost::ChannelBot, AiHost::Mcp] {
        let json = frontend_schemas_builder()
            .merge(&tools_for(host))
            .build()
            .to_json_pretty()
            .expect("host schemas serialize");
        let schemas: serde_json::Value = serde_json::from_str(&json).expect("valid schema json");
        let tools = schemas["tools"].as_array().expect("tools array");

        let create = tools
            .iter()
            .find(|tool| tool["name"] == "CreateCalendarEvent")
            .expect("composer-less toolset keeps CreateCalendarEvent");
        assert_eq!(create["output"], "ToolCalendarEvent", "{host:?}");

        assert!(
            !tools.iter().any(|tool| tool["name"] == "SendEmail"),
            "{host:?} toolset must not expose SendEmail"
        );
        // The confirmed twins are for the in-process agent's thread turns;
        // these hosts already create directly and keep their own policy.
        for name in ["SendConfirmedEmail", "CreateConfirmedCalendarEvent"] {
            assert!(
                !tools.iter().any(|tool| tool["name"] == name),
                "{host:?} toolset must not expose {name}"
            );
        }
    }
}

#[test]
fn no_tools_passes_schema_validation() {
    let _ = no_tools();
}

#[test]
fn search_toolset_passes_schema_validation() {
    let _ = search_toolset();
}

#[test]
fn frontend_schemas_build() {
    let json = all_tool_frontend_schemas().to_json_pretty().unwrap();
    let schemas: serde_json::Value = serde_json::from_str(&json).unwrap();
    let mut names = std::collections::HashSet::new();
    for tool in schemas["tools"].as_array().unwrap() {
        let name = tool["name"].as_str().unwrap();
        assert!(names.insert(name), "duplicate frontend tool: {name}");
    }
    assert!(names.contains("QueryDatabase"));
    assert!(names.contains("DiscoverConnectors"));
    // DisplayResults renders from the fold's decoded view, not a tool schema.
    for name in tools_for(AiHost::Chat).toolset.tools.keys() {
        if name == "DisplayResults" {
            assert!(
                !names.contains(name.as_str()),
                "DisplayResults has a frontend schema"
            );
            continue;
        }
        assert!(names.contains(name.as_str()), "missing chat tool: {name}");
    }
    for name in [
        "CreateDatabase",
        "CreateTable",
        "RenameDatabase",
        "RenameTable",
        "ReorderTables",
        "DeleteTable",
        "AddColumn",
        "AddColumnOptions",
        "RenameColumn",
        "ChangeColumnType",
        "DeleteColumn",
        "ReorderColumns",
    ] {
        assert!(
            !names.contains(name),
            "removed tool {name} must not be generated"
        );
    }
}

#[test]
fn frontend_schemas_distinguish_user_tool_response_types() {
    let json = all_tool_frontend_schemas()
        .to_json_pretty()
        .expect("frontend schemas serialize");
    let schemas: serde_json::Value = serde_json::from_str(&json).expect("valid schema json");
    let tools = schemas["tools"].as_array().expect("tools array");
    let output_for = |name: &str| {
        tools
            .iter()
            .find(|tool| tool["name"] == name)
            .and_then(|tool| tool["output"].as_str())
            .expect("tool output schema")
    };

    assert_eq!(
        output_for("CreateCalendarEvent"),
        "UserToolResponseForToolCalendarEvent"
    );
    assert_eq!(
        output_for("SendEmail"),
        "UserToolResponseForSendEmailResponse"
    );
}

/// The configure-agent system skill walks an agent through `ListAgents` and
/// `ConfigureAgent`; a host that reads the skill must be able to follow it.
#[test]
fn every_host_exposes_agent_configuration() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in ["ListAgents", "ConfigureAgent", "ConfigureBot"] {
            assert!(
                tools.toolset.tools.contains_key(name),
                "{host:?} missing {name}"
            );
        }
    }
}

#[test]
fn every_host_exposes_skill_discovery_and_reading() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in ["ListSkills", "SearchSkills", "ReadSkill"] {
            assert!(
                tools.toolset.tools.contains_key(name),
                "{host:?} missing {name}"
            );
        }
        assert!(
            tools.toolset.tools["SearchSkills"]
                .description
                .contains("ReadSkill"),
            "{host:?} missing skill reading instructions"
        );
    }
}

#[test]
fn hosts_with_tool_search_defer_all_but_the_core_tools() {
    for host in [AiHost::Chat, AiHost::ChannelBot] {
        let tools = tools_for(host);
        let lazy = DeferredToolSet::new(tools.toolset.clone(), tools.deferred.clone());
        let sent: Vec<String> = lazy
            .request_schemas()
            .unwrap_or_default()
            .into_iter()
            .map(|schema| schema.name)
            .collect();
        let catalog: Vec<String> = lazy
            .searchable_catalog()
            .into_iter()
            .map(|tool| tool.name)
            .collect();
        let prompt = tools.prompt.to_string();

        for name in ["ReadContent", "ContentSearch", "LoadTools", "SearchTools"] {
            assert!(sent.contains(&name.to_string()), "{host:?} sends {name}");
        }
        for name in ["EditPresentation", "EditSpreadsheet", "QueryDatabase"] {
            assert!(!sent.contains(&name.to_string()), "{host:?} defers {name}");
            assert!(
                catalog.contains(&name.to_string()),
                "{host:?} catalogs {name}"
            );
            assert!(
                prompt.contains(&format!("\n- {name}: ")),
                "{host:?} lists {name} in the prompt"
            );
        }
        assert_eq!(
            sent.len() + catalog.len(),
            tools.toolset.tools.len(),
            "{host:?}: every tool is either sent or catalogued"
        );
    }
}

#[test]
fn the_mcp_host_defers_nothing() {
    let tools = tools_for(AiHost::Mcp);

    assert!(tools.deferred.is_empty());
    assert!(!tools.prompt.to_string().contains("LoadTools"));
}

/// Only an MCP client can PUT bytes to the upload URL, so the tool is not
/// offered to in-app hosts, which would call it and then have no way to use it.
#[test]
fn channel_media_uploads_are_mcp_only() {
    assert!(
        tools_for(AiHost::Mcp)
            .toolset
            .tools
            .contains_key("CreateChannelMediaUpload")
    );
    for host in [AiHost::Chat, AiHost::ChannelBot] {
        assert!(
            !tools_for(host)
                .toolset
                .tools
                .contains_key("CreateChannelMediaUpload"),
            "{host:?}"
        );
    }
}

#[test]
fn every_eager_tool_exists() {
    let chat = tools_for(AiHost::Chat);
    for name in EAGER_TOOLS {
        assert!(chat.toolset.tools.contains_key(*name), "{name} is not a tool");
    }
}

#[test]
fn forms_are_discoverable_and_execute_directly_on_every_host() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in [
            "CreateForm",
            "ReadForm",
            "EditForm",
            "ListForms",
            "SetFormAccess",
        ] {
            assert!(tools.toolset.tools.contains_key(name), "{host:?}: {name}");
            if !matches!(host, AiHost::Mcp) {
                assert!(tools.prompt.to_string().contains(name), "{host:?}: {name}");
            }
        }
        assert!(!tools.toolset.user_tools.contains_key("SetFormAccess"));
    }
    let delegated = base_toolset();
    for name in ["CreateForm", "ReadForm", "EditForm", "ListForms"] {
        assert!(delegated.tools.contains_key(name));
    }
    assert!(!delegated.tools.contains_key("SetFormAccess"));
}

#[test]
fn booking_link_mutations_execute_without_a_review_on_every_host() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host).toolset;
        assert!(tools.tools.contains_key("ListBookingLinks"));
        for name in ["CreateBookingLink", "EditBookingLink"] {
            assert!(tools.tools.contains_key(name));
            assert!(!tools.user_tools.contains_key(name));
        }
    }
}

mod booking_links;

#[test]
fn booking_management_has_mcp_and_chat_parity() {
    let names = [
        "ReadBookingSettings",
        "UpdateBookingSettings",
        "ListBookings",
        "GetBookingInsights",
        "GetBookingRescheduleSlots",
        "ChangeBooking",
    ];
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        for name in names {
            assert!(
                tools.toolset.tools.contains_key(name),
                "{host:?} must expose {name}"
            );
        }
    }
}

#[test]
fn session_reader_is_available_to_every_conversation_host_and_mcp() {
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        let tools = tools_for(host);
        assert!(tools.toolset.tools.contains_key("ReadAgentSession"));
        assert!(
            !tools
                .deferred
                .iter()
                .any(|tool| tool.name == "ReadAgentSession")
        );
    }
    assert!(base_toolset().tools.contains_key("ReadAgentSession"));
}

#[test]
fn conversation_tools_only_advertise_new_sessions() {
    for tools in [
        tools_for(AiHost::Chat),
        tools_for(AiHost::ChannelBot),
        tools_for(AiHost::Mcp),
    ] {
        assert!(!tools.toolset.tools.contains_key("ReadChat"));
        assert!(!tools.prompt.to_string().contains("ReadChat"));
        for name in [
            "ReadAgentSession",
            "ReadAgentSessionSharing",
            "UpdateAgentSessionSharing",
            "CreateAgentSession",
            "ManageAgentSession",
        ] {
            assert!(tools.toolset.tools.contains_key(name), "missing {name}");
        }
        for schema in tools.toolset.request_schemas().unwrap() {
            let json = serde_json::to_string(&schema.schema).unwrap();
            if [
                "NameSearch",
                "ContentSearch",
                "ListEntities",
                "RenameItem",
                "MoveToTrash",
                "MoveToProject",
                "DuplicateItem",
                "UpdateSharing",
                "ShareWithChannel",
                "SetFavorite",
                "GetEntityProperties",
                "SetEntityProperty",
                "BulkSetEntityPropertyOptions",
                "ListNotifications",
            ]
            .contains(&schema.name.as_str())
            {
                assert!(
                    !json.contains("\"chat\""),
                    "{} advertises legacy chats",
                    schema.name
                );
                assert!(
                    !json.contains("\"chats\""),
                    "{} advertises legacy chat search",
                    schema.name
                );
                assert!(
                    !json.contains("\"ai_chat\""),
                    "{} advertises legacy chat listing",
                    schema.name
                );
            }
        }
    }
    assert!(!base_toolset().tools.contains_key("ReadChat"));
}

#[test]
fn unrouted_prompts_inline_the_sdk_area_guidance_and_routed_ones_leave_it_to_the_turn() {
    use agent_code_mode::domain::{GuideHost, inline_guides};
    let code = tools_for_agent_code_mode();
    let unrouted = code.prompt.to_string();
    let routed = code.routed_prompt.to_string();
    assert!(unrouted.contains(inline_guides(GuideHost::Code)));
    assert!(!routed.contains("How Macro databases work"));
    assert_eq!(
        unrouted.replacen(inline_guides(GuideHost::Code), "", 1),
        routed
    );
    for host in [AiHost::Chat, AiHost::ChannelBot] {
        let tools = tools_for(host);
        let prompt = tools.prompt.to_string();
        assert!(
            prompt.contains(inline_guides(GuideHost::Direct)),
            "{host:?}"
        );
        assert!(prompt.contains("DispatchCodingAgent"), "{host:?}");
        assert_eq!(prompt, tools.routed_prompt.to_string(), "{host:?}");
    }
}

/// Agent sessions run code mode, so their native tools are only what a
/// program cannot do through the Macro SDK; every other direct tool belongs
/// to the direct hosts.
#[test]
fn code_mode_sessions_get_only_the_tools_the_sdk_cannot_replace() {
    let code_mode = tools_for_agent_code_mode();
    let names = code_mode
        .toolset
        .tools
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected = [
        "BashCodeExecution",
        "ImportFromJira",
        "ImportFromLinear",
        "ImportFromNotion",
        "IssueBotCredential",
        "ListAgentUpdates",
        "ListCompanies",
        "LoadTools",
        "RenderCanvas",
        "SearchTools",
        "SelfKnowledge",
        "TextEditorCodeExecution",
    ]
    .into_iter()
    .collect();
    assert_eq!(names, expected);
    // Saved reviews replace the user tools' review cards.
    assert!(code_mode.toolset.user_tools.is_empty());
    let prompt = code_mode.prompt.to_string();
    assert!(!prompt.contains("the turn waits while the user"));
    assert!(!prompt.contains("you MUST use the `SendEmail` tool"));
    assert!(prompt.contains("Do not wait for the user to act on a saved review"));
    let code_mode_section = prompt::code_mode::PROMPT.to_string();
    assert!(prompt.contains(&code_mode_section));
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        assert!(
            !tools_for(host)
                .prompt
                .to_string()
                .contains(&code_mode_section)
        );
    }
    assert!(prompt.contains("macro.agentSessions.byId()"));
}

/// Review approval runs the reviewed draft through the user tool by name.
#[test]
fn code_mode_reviews_run_the_email_and_calendar_user_tools() {
    let tools = code_mode_tools();
    let names = tools
        .user_tools
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        names,
        ["CreateCalendarEvent", "SendEmail"].into_iter().collect()
    );
}
