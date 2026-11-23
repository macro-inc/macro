use super::PipedreamClient;
use crate::domain::discovery::AppTool;
use crate::outbound::app_directory::ConnectorCapabilities;
use crate::outbound::pipedream::models::{MacroUserIdStr, PipedreamConnection};
use std::time::Duration;

#[cfg(test)]
mod test;

impl ConnectorCapabilities for PipedreamClient {
    #[tracing::instrument(skip_all, err)]
    async fn tools(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Vec<AppTool>> {
        // Pipedream exposes tools/list before user auth. This session is used
        // only for discovery, never tools/call, and carries no account grant.
        let record = PipedreamConnection {
            user_id: user_id.clone(),
            app_slug: app_slug.to_owned(),
            server_name: app_slug.to_owned(),
            account_id: String::new(),
            enabled: false,
        };
        tokio::time::timeout(Duration::from_secs(30), async {
            let client = self.dial_mcp(&record).await?;
            let tools = client.list_all_tools().await;
            let _ = client.cancel().await;
            Ok(tools?
                .into_iter()
                .map(|tool| AppTool {
                    name: tool.name.into_owned(),
                    description: tool
                        .description
                        .map(|description| description.into_owned())
                        .unwrap_or_default(),
                })
                .collect())
        })
        .await
        .map_err(|_| anyhow::anyhow!("Connector tool discovery timed out; retry later"))?
    }
}
