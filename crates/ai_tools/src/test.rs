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

#[test]
fn connector_discovery_is_eager_only_in_agent_sessions() {
    assert!(EAGER_TOOLS.contains(&"DiscoverConnectors"));
    assert!(
        tools_for(AiHost::AgentSession)
            .toolset
            .tools
            .contains_key("DiscoverConnectors")
    );
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        assert!(
            !tools_for(host)
                .toolset
                .tools
                .contains_key("DiscoverConnectors")
        );
    }
}

#[test]
fn no_host_offers_the_removed_subagent_tool() {
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
        let tools = tools_for(host);
        assert!(!tools.toolset.tools.contains_key("Subagent"), "{host:?}");
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
        tools_for(AiHost::AgentSession),
        tools_for(AiHost::ChannelBot),
        tools_for(AiHost::Mcp),
        tools_for_agent_code_mode(),
        tools_for_chat_code_mode(),
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for name in ["ListCodingAgents", "DispatchCodingAgent"] {
        assert!(!tools.toolset.tools.contains_key(name), "{name}");
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
        assert!(!prompt.contains(name), "{name}");
    }
    assert!(tools.toolset.tools.contains_key("ListAgentUpdates"));
    assert!(prompt.contains("macro.agents.coding()"));
    assert!(prompt.contains("macro.agentSessions.createManaged"));
    assert!(
        !tools_for(AiHost::AgentSession)
            .prompt
            .to_string()
            .contains("createManaged")
    );
}

/// Code mode hides direct tools whose work the SDK does, while other
/// hosts keep them.
#[test]
fn code_mode_hides_tools_the_sdk_covers() {
    let code_mode = tools_for_agent_code_mode();
    let direct = tools_for(AiHost::AgentSession);
    for name in [
        "ListTags",
        "CreateTag",
        "EditTag",
        "DeleteTag",
        "OpenDirectMessage",
        "MuteNotifications",
        "GetTeamAvailability",
        "CreateDocument",
        "UpdateSharing",
        "SaveDatabaseQuery",
        "GetCompany",
        "CreateCompany",
        "CreateContact",
        "ImportCompaniesCsv",
        "ListPipelines",
        "FindPipelineEntries",
        "AddToPipeline",
        "UpdatePipelineEntries",
        "RemoveFromPipeline",
        "EditPipeline",
        "ImportPipelineCsv",
        "ExportPipelineCsv",
        "ReadChannelMessageContext",
        "ListInitiatives",
        "ReadInitiative",
        "CreateInitiative",
        "UpdateInitiative",
        "UpdateInitiativeSharing",
        "DeleteInitiative",
        "ListAgents",
        "ConfigureAgent",
    ] {
        assert!(!code_mode.toolset.tools.contains_key(name), "{name}");
        assert!(
            !code_mode.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
        assert!(direct.toolset.tools.contains_key(name), "{name}");
    }
}

#[test]
fn code_mode_manages_bots_through_the_sdk_but_keeps_the_credential_card() {
    let tools = tools_for_agent_code_mode();
    for name in [
        "ListBots",
        "CreateBot",
        "ConfigureBot",
        "DeleteBot",
        "GetBotWebhooks",
        "ManageBotChannelAccess",
    ] {
        assert!(!tools.toolset.tools.contains_key(name), "{name}");
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
    }
    assert!(tools.toolset.tools.contains_key("IssueBotCredential"));
}

#[test]
fn code_mode_reads_and_edits_office_and_design_files_through_the_sdk() {
    let tools = tools_for_agent_code_mode();
    for name in [
        "ReadPresentation",
        "EditPresentation",
        "ReadWordDocument",
        "EditWordDocument",
        "ReadDesign",
        "ReadPhotoshopDocument",
        "ReadIllustratorDocument",
    ] {
        assert!(!tools.toolset.tools.contains_key(name), "{name}");
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
    }
    assert!(
        tools_for(AiHost::AgentSession)
            .toolset
            .tools
            .contains_key("EditPresentation")
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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

/// An agent session finishes user tools in the turn, so it keeps chat's
/// deferring registrations - and gets the prompt that says a review card,
/// not a pending composer, is what follows the call.
#[test]
fn the_agent_session_host_keeps_chats_user_tools_with_the_review_prompt() {
    let session = tools_for(AiHost::AgentSession);
    assert!(
        session
            .toolset
            .user_tools
            .contains_key("CreateCalendarEvent")
    );
    assert!(session.toolset.user_tools.contains_key("SendEmail"));
    // The confirmed twins execute in the loop, beside the deferring tools,
    // for the prompts a session reads out of a thread.
    assert!(session.toolset.tools.contains_key("SendConfirmedEmail"));
    assert!(
        session
            .toolset
            .tools
            .contains_key("CreateConfirmedCalendarEvent")
    );
    let prompt = session.prompt.to_string();
    assert!(prompt.contains("review card"));
    assert!(!prompt.contains("PendingUserExecution"));
    assert_eq!(
        session.toolset.request_schemas().map(|schemas| schemas
            .into_iter()
            .filter(|schema| schema.name != "DiscoverConnectors")
            .count()),
        tools_for(AiHost::Chat)
            .toolset
            .request_schemas()
            .map(|schemas| schemas
                .into_iter()
                .filter(|schema| schema.name != "DisplayResults")
                .count()),
        "the same tools as chat except agent-session connector discovery and \
         chat's DisplayResults, which sessions replace with the harness's execution.views.present"
    );
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for host in [AiHost::Chat, AiHost::AgentSession, AiHost::ChannelBot] {
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
    for host in [AiHost::Chat, AiHost::AgentSession, AiHost::ChannelBot] {
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
    let session = tools_for(AiHost::AgentSession);
    let chat = tools_for(AiHost::Chat);
    for name in EAGER_TOOLS {
        assert!(
            session.toolset.tools.contains_key(*name) || chat.toolset.tools.contains_key(*name),
            "{name} is not a tool"
        );
    }
}

#[test]
fn forms_are_discoverable_and_execute_directly_on_every_host() {
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
fn code_mode_manages_booking_links_through_the_sdk_instead_of_the_tools() {
    let standard = tools_for(AiHost::AgentSession);
    let direct = tools_for_agent_code_mode();
    for name in [
        "ReadBookingSettings",
        "UpdateBookingSettings",
        "ListBookings",
        "GetBookingInsights",
        "GetBookingRescheduleSlots",
        "ChangeBooking",
        "ListBookingLinks",
        "CreateBookingLink",
        "EditBookingLink",
    ] {
        assert!(standard.toolset.tools.contains_key(name), "{name}");
        assert!(!direct.toolset.tools.contains_key(name), "{name}");
        assert!(
            !direct.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
    }
}

#[test]
fn code_mode_retains_direct_lifecycles_and_hides_sdk_methods_from_lazy_discovery() {
    let standard = tools_for(AiHost::AgentSession);
    let direct = tools_for_agent_code_mode();
    let sdk = code_mode_tools();
    assert!(direct.toolset.tools.len() < standard.toolset.tools.len());
    // macro.search, macro.workspace and macro.chats replace the search tools.
    for name in [
        "ReadContent",
        "EditDocument",
        "NameSearch",
        "ListEntities",
        "ContentSearch",
        "DiscoverConnectors",
        "ConnectMcpServer",
        "ReadCanvas",
        "EditCanvas",
        "ApplyCanvasEdits",
        "ReadSpreadsheet",
        "CalculateSpreadsheet",
        "EditSpreadsheet",
        "ListSkills",
        "SearchSkills",
        "ReadSkill",
    ] {
        assert!(standard.toolset.tools.contains_key(name), "{name}");
        assert!(sdk.tools.contains_key(name), "{name}");
        assert!(!direct.toolset.tools.contains_key(name), "{name}");
        assert!(!direct.deferred.iter().any(|t| t.name == name), "{name}");
    }
    // The SDK cannot show the model a render, create a pipeline with its
    // stages and fields, render the answer cards for agent updates, or prompt
    // an agent that runs on its operator's machine.
    for name in [
        "RenderCanvas",
        "CreatePipeline",
        "ListAgentUpdates",
        "CreateAgentSession",
        "SearchTools",
        "LoadTools",
        "BashCodeExecution",
        "TextEditorCodeExecution",
    ] {
        assert!(direct.toolset.tools.contains_key(name), "{name}");
    }
    for name in standard.toolset.user_tools.keys() {
        assert!(direct.toolset.user_tools.contains_key(name), "{name}");
        if matches!(name.as_str(), "SendEmail" | "CreateCalendarEvent") {
            assert!(!direct.toolset.tools.contains_key(name), "{name}");
            assert!(
                !direct.deferred.iter().any(|tool| tool.name == *name),
                "{name}"
            );
        } else {
            assert!(direct.toolset.tools.contains_key(name), "{name}");
        }
    }
    let standard_deferred =
        DeferredToolSet::new(standard.toolset.clone(), standard.deferred.clone());
    assert!(
        standard_deferred
            .request_schemas()
            .unwrap()
            .iter()
            .any(|schema| schema.name == "ListEntities")
    );
    let deferred = DeferredToolSet::new(direct.toolset.clone(), direct.deferred.clone());
    let eager = deferred.request_schemas().unwrap();
    for name in ["SendEmail", "CreateCalendarEvent"] {
        assert!(standard.toolset.tools.contains_key(name));
        assert!(sdk.tools.contains_key(name));
        assert!(!eager.iter().any(|tool| tool.name == name));
        assert!(deferred.routing_description(name).is_none());
    }
    let prompt = direct.prompt.to_string();
    assert!(!prompt.contains("the turn waits while the user"));
    assert!(!prompt.contains("you MUST use the `SendEmail` tool"));
    assert!(prompt.contains("Do not wait for the user to act on a saved review"));
    assert!(!prompt.contains("- ReadMetadata:"));
    let code_mode = prompt::code_mode::PROMPT.to_string();
    assert!(prompt.contains(&code_mode));
    assert!(!standard.prompt.to_string().contains(&code_mode));
    for host in [AiHost::Chat, AiHost::ChannelBot, AiHost::Mcp] {
        assert!(!tools_for(host).prompt.to_string().contains(&code_mode));
    }
}

#[test]
fn session_reader_is_available_to_every_conversation_host_and_mcp() {
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
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
fn code_mode_hides_tools_the_sdk_replaces() {
    let standard = tools_for(AiHost::AgentSession);
    let code_mode = tools_for_agent_code_mode();
    let prompt = code_mode.prompt.to_string();
    for name in [
        "ReadAgentSession",
        "ManageAgentSession",
        "ReadAgentSessionSharing",
        "UpdateAgentSessionSharing",
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "SaveDatabaseView",
        "DeleteDatabaseView",
        "CreateRoutine",
        "ListRoutines",
        "ReadRoutine",
        "UpdateRoutine",
        "RunRoutine",
        "DeleteRoutine",
        "ReadCalendarEvent",
        "AddSharedCalendarEvent",
        "GenerateImage",
        "DuplicateItem",
        "RenameItem",
    ] {
        assert!(standard.toolset.tools.contains_key(name), "{name}");
        assert!(!code_mode.toolset.tools.contains_key(name), "{name}");
        assert!(
            !code_mode.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
    }
    assert!(prompt.contains("macro.agentSessions.byId()"));
    assert!(!code_mode.toolset.tools.contains_key("ReadChat"));
    assert!(!prompt.contains("ReadChat"));
}

#[test]
fn conversation_tools_only_advertise_new_sessions() {
    for tools in [
        tools_for(AiHost::Chat),
        tools_for(AiHost::AgentSession),
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
    for host in [AiHost::AgentSession, AiHost::Chat, AiHost::ChannelBot] {
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

#[test]
fn code_mode_reads_memory_and_activity_through_the_sdk() {
    let names = [
        "ReadMemory",
        "UpdateMemory",
        "GetUserActivity",
        "ReadActivity",
        "ReadInitiativeActivity",
    ];
    let code_mode = tools_for_agent_code_mode();
    let direct = tools_for(AiHost::AgentSession);
    for name in names {
        assert!(!code_mode.toolset.tools.contains_key(name), "{name}");
        assert!(direct.toolset.tools.contains_key(name), "{name}");
    }
}

#[test]
fn chat_runs_in_code_mode() {
    let tools = tools_for_chat_code_mode();
    let direct = tools_for(AiHost::Chat).toolset;
    let advertised: Vec<&str> = tools.toolset.tools.keys().map(String::as_str).collect();

    for name in CHAT_CODE_MODE_TOOLS {
        assert!(advertised.contains(&name), "{name}");
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name} is sent with every request"
        );
    }
    for name in CHAT_CODE_MODE_DROPPED_TOOLS {
        assert!(!advertised.contains(&name), "{name}");
    }
    for name in &advertised {
        assert!(
            !agent_code_mode::domain::covered_by_code_sdk(
                name,
                direct.user_tools.contains_key(*name)
            ),
            "{name} is covered by the SDK"
        );
    }
    // The composer still confirms chat's user tools, and chat still presents views.
    for name in ["SendEmail", "CreateCalendarEvent", "DisplayResults"] {
        assert!(advertised.contains(&name), "{name}");
    }
    for covered in ["ReadContent", "ListEntities", "WebFetch"] {
        assert!(!advertised.contains(&covered), "{covered}");
    }

    let prompt = tools.prompt.to_string();
    assert!(prompt.contains("ExecuteCode"));
    assert!(prompt.contains("AboutMacro"));
    assert!(prompt.contains("present them with `DisplayResults` without being asked"));
    assert!(!prompt.contains("SelfKnowledge"));
    // The SDK guides describe agent sessions and threads; chat sends through
    // its composer tools.
    assert!(prompt.contains("call the `SendEmail` or `CreateCalendarEvent` tool"));
}

/// Chat's user-scoped `ExecuteCode` takes different arguments and returns a
/// different receipt than an agent session's, and both render in the app.
#[test]
fn frontend_execute_code_types_accept_chat_and_session_calls() {
    let json = all_tool_frontend_schemas().to_json_pretty().unwrap();
    let schemas: serde_json::Value = serde_json::from_str(&json).unwrap();
    let execute_code = schemas["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "ExecuteCode")
        .expect("ExecuteCode has a frontend schema");
    for side in ["input", "output"] {
        let definition = &schemas["$defs"][execute_code[side].as_str().unwrap()];
        assert_eq!(
            definition["anyOf"].as_array().map(Vec::len),
            Some(2),
            "{side}: {definition}"
        );
    }
}
