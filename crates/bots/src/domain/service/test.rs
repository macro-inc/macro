use super::*;
use crate::domain::models::{AgentMcpServer, AgentMcpServers};
use crate::domain::ports::{BotError, McpAppCatalog};

struct KnownApps(&'static [&'static str]);

impl McpAppCatalog for KnownApps {
    async fn is_connectable_app(&self, slug: &str) -> Result<bool, BotError> {
        Ok(self.0.contains(&slug))
    }
}

struct DirectoryDown;

impl McpAppCatalog for DirectoryDown {
    async fn is_connectable_app(&self, slug: &str) -> Result<bool, BotError> {
        Err(BotError::Unavailable(format!(
            "could not verify MCP app {slug}"
        )))
    }
}

fn selected(slug: &str) -> AgentMcpServers {
    AgentMcpServers::Selected {
        servers: vec![AgentMcpServer {
            app_slug: slug.to_owned(),
            server_name: slug.to_owned(),
        }],
    }
}

#[tokio::test]
async fn an_invented_mcp_slug_is_rejected() {
    let error = reject_unknown_mcp_apps(&KnownApps(&["linear"]), &selected("not-a-real-app"), &[])
        .await
        .expect_err("invented slug");
    assert!(matches!(error, BotError::BadRequest(message) if message.contains("not-a-real-app")));
}

#[tokio::test]
async fn a_listed_mcp_slug_is_accepted() {
    reject_unknown_mcp_apps(&KnownApps(&["linear"]), &selected("linear"), &[])
        .await
        .expect("linear is listed");
}

#[tokio::test]
async fn a_slug_already_on_the_agent_is_not_looked_up_again() {
    let already = selected("made-up").servers().to_vec();
    reject_unknown_mcp_apps(&DirectoryDown, &selected("made-up"), &already)
        .await
        .expect("unchanged slug skips the directory");
}

#[tokio::test]
async fn a_directory_that_cannot_answer_refuses_the_write() {
    let error = reject_unknown_mcp_apps(&DirectoryDown, &selected("linear"), &[])
        .await
        .expect_err("directory down");
    assert!(matches!(error, BotError::Unavailable(_)));
}

#[test]
fn persona_cannot_bypass_a_harness_that_requires_prompts() {
    assert!(validate_permission_bypass(false, Some(true)).is_err());
    for choice in [None, Some(false)] {
        assert!(validate_permission_bypass(false, choice).is_ok());
    }
    for choice in [None, Some(false), Some(true)] {
        assert!(validate_permission_bypass(true, choice).is_ok());
    }
}

fn agent_on(harness: &str) -> Agent {
    Agent {
        bot: Bot {
            id: BotId::new_from_uuid(Uuid::from_u128(0xA6E)),
            kind: BotKind::Owned,
            owner: Some(BotOwner::User {
                user_id: "macro|owner@example.com".to_owned(),
            }),
            name: "Agent".to_owned(),
            handle: "agent".to_owned(),
            description: None,
            avatar_url: None,
            created_by: Some("macro|owner@example.com".to_owned()),
            created_at: DateTime::UNIX_EPOCH,
            updated_at: DateTime::UNIX_EPOCH,
            deleted_at: None,
            has_agent: true,
        },
        instructions: String::new(),
        harness: harness.to_owned(),
        harness_id: None,
        default_model: "model".to_owned(),
        channel_scope: AgentChannelScope::All,
        channel_ids: vec![],
        mcp: AgentMcpServers::OwnerConnections,
        auto_accept_permissions: None,
        is_coding: false,
    }
}

#[test]
fn an_agent_keeps_whether_it_runs_on_the_external_harness() {
    let to = |harness: &str| PatchAgentRequest {
        harness: Some(crate::domain::models::AgentHarnessSelection {
            harness: harness.to_owned(),
            harness_id: None,
        }),
        ..PatchAgentRequest::default()
    };
    let external = agent_on(harness_id::EXTERNAL_HARNESS_SLUG);
    let in_macro = agent_on("in-memory");

    assert!(validate_harness_kept(&external, &to("in-memory").apply_to(&external)).is_err());
    assert!(
        validate_harness_kept(
            &in_macro,
            &to(harness_id::EXTERNAL_HARNESS_SLUG).apply_to(&in_macro)
        )
        .is_err()
    );
    assert!(validate_harness_kept(&in_macro, &to("cursor").apply_to(&in_macro)).is_ok());
    assert!(
        validate_harness_kept(&external, &PatchAgentRequest::default().apply_to(&external)).is_ok()
    );
}
