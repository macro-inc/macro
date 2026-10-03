//! A harness setup plan, independent of terminal and subprocess adapters.

use std::collections::BTreeMap;

/// A native harness command used to configure or authenticate Macro MCP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SetupCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    /// Some CLIs exit successfully even when authentication fails. Require
    /// their explicit success message before continuing in those cases.
    pub success_text: Option<&'static str>,
}

/// The native operations needed before a harness can serve Macro sessions.
pub(crate) struct SetupPlan {
    pub commands: Vec<SetupCommand>,
    /// Claude refuses to add an existing entry. Reuse only an entry pointing
    /// at this deployment, never an unrelated server with the same name.
    pub existing_server: Option<SetupCommand>,
    pub url: String,
}

/// The subprocess capability required to execute a setup plan.
pub(crate) trait SetupRunner {
    async fn run(&self, command: &SetupCommand) -> rootcause::Result<()>;
    async fn configured_url(&self, command: &SetupCommand) -> rootcause::Result<Option<String>>;
}

impl SetupPlan {
    pub async fn run(&self, runner: &impl SetupRunner) -> rootcause::Result<()> {
        let skip_add = if let Some(command) = &self.existing_server {
            match runner.configured_url(command).await? {
                Some(url) if url == self.url => true,
                Some(_) => rootcause::bail!(
                    "The selected harness already has a different server named macro. Rename or remove that entry before retrying."
                ),
                None => false,
            }
        } else {
            false
        };
        for command in self.commands.iter().skip(usize::from(skip_add)) {
            runner.run(command).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
