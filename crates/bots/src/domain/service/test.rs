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
