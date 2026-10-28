use super::*;

fn agent(owner: BotOwner) -> Agent {
    let now = Utc::now();
    Agent {
        bot: Bot {
            id: BotId::new_from_uuid(Uuid::new_v4()),
            kind: BotKind::Owned,
            owner: Some(owner),
            name: "Bug fixer".to_string(),
            handle: "bug-fixer".to_string(),
            description: Some("Finds and fixes bugs".to_string()),
            avatar_url: Some("https://static.example/bug-fixer.png".to_string()),
            created_by: Some("macro|owner@example.com".to_string()),
            created_at: now,
            updated_at: now,
            deleted_at: None,
            has_agent: true,
        },
        instructions: "Fix the root cause and add tests.".to_string(),
        harness: "macrod".to_string(),
        harness_id: Some(HarnessId::new_from_uuid(Uuid::new_v4())),
        default_model: "claude-sonnet-4-5".to_string(),
        channel_scope: AgentChannelScope::Selected,
        channel_ids: vec![Uuid::new_v4()],
        mcp: AgentMcpServers::Selected {
            servers: vec![AgentMcpServer {
                app_slug: "linear".to_string(),
                server_name: "Linear".to_string(),
            }],
        },
        auto_accept_permissions: Some(true),
        is_coding: true,
    }
}

#[test]
fn empty_patch_reproduces_the_agent_under_its_current_owner() {
    let team_id = Uuid::new_v4();
    let current = agent(BotOwner::Team { team_id });

    let update = PatchAgentRequest::default().apply_to(&current);

    assert_eq!(update.team_id, Some(team_id));
    assert_eq!(update.harness_id, current.harness_id);
    assert_eq!(update.name, current.bot.name);
    assert_eq!(update.handle, current.bot.handle);
    assert_eq!(update.description, current.bot.description);
    assert_eq!(update.avatar_url, current.bot.avatar_url);
    assert_eq!(update.instructions, current.instructions);
    assert_eq!(update.harness, current.harness);
    assert_eq!(update.default_model, current.default_model);
    assert_eq!(update.channel_scope, current.channel_scope);
    assert_eq!(update.channel_ids, current.channel_ids);
    assert_eq!(update.mcp, current.mcp);
    assert_eq!(
        update.auto_accept_permissions,
        current.auto_accept_permissions
    );
    assert_eq!(update.is_coding, current.is_coding);
}

#[test]
fn user_owned_agent_stays_private() {
    let current = agent(BotOwner::User {
        user_id: "macro|owner@example.com".to_string(),
    });

    let update = PatchAgentRequest {
        instructions: Some("Diagnose first.".to_string()),
        ..PatchAgentRequest::default()
    }
    .apply_to(&current);

    assert_eq!(update.team_id, None);
    assert_eq!(update.instructions, "Diagnose first.");
    assert_eq!(update.harness, "macrod");
}

#[test]
fn named_fields_replace_and_travel_with_their_partners() {
    let current = agent(BotOwner::Team {
        team_id: Uuid::new_v4(),
    });

    let update = PatchAgentRequest {
        harness: Some(AgentHarnessSelection {
            harness: "in-memory".to_string(),
            harness_id: None,
        }),
        default_model: Some("claude-opus-4-5".to_string()),
        channels: Some(AgentChannelSelection {
            channel_scope: AgentChannelScope::All,
            channel_ids: Vec::new(),
        }),
        mcp: Some(AgentMcpServers::OwnerConnections),
        auto_accept_permissions: Some(false),
        is_coding: Some(false),
        ..PatchAgentRequest::default()
    }
    .apply_to(&current);

    // Moving off macrod drops the registered harness with it, so the
    // request can never name a harness id for a runtime that takes none.
    assert_eq!(update.harness, "in-memory");
    assert_eq!(update.harness_id, None);
    assert_eq!(update.default_model, "claude-opus-4-5");
    assert_eq!(update.channel_scope, AgentChannelScope::All);
    assert!(update.channel_ids.is_empty());
    assert_eq!(update.mcp, AgentMcpServers::OwnerConnections);
    assert_eq!(update.auto_accept_permissions, Some(false));
    assert!(!update.is_coding);
    assert_eq!(update.instructions, current.instructions);
}
