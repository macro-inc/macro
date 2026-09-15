//! Zed stdio ACP composition root using the dedicated direct-OAuth state.
use codex_cloud_agents::domain::{Probe, acp_session::SessionService, cloud::CloudId};
use codex_cloud_agents::outbound::{
    json_store::JsonStore, openai::OpenAi, session_store::JsonSessionStore,
};
use codex_cloud_agents::{DEFAULT_BRANCH, DEFAULT_ENVIRONMENT, DEFAULT_STATE_DIR};
use std::{path::Path, process::ExitCode, sync::Arc};
#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("codex_acp: {error}");
            ExitCode::FAILURE
        }
    }
}
async fn run() -> Result<(), rootcause::Report> {
    let root = Path::new(DEFAULT_STATE_DIR);
    let store = JsonStore::open(root)?;
    let probe = Arc::new(Probe::new(OpenAi::new()?, store));
    if probe.status()?.is_none() {
        return Err(rootcause::report!(
            "run codex-cloud-probe login before starting codex_acp"
        ));
    }
    eprintln!(
        "codex_acp: cloud execution targets 404Wolf/temp-test-repo on main; tools run remotely without local permission prompts"
    );
    let service = Arc::new(SessionService::new(
        probe,
        JsonSessionStore::open(root)?,
        CloudId::new(DEFAULT_ENVIRONMENT.into())?,
        DEFAULT_BRANCH.into(),
    ));
    codex_cloud_agents::inbound::acp::serve(service, tokio::io::stdin(), tokio::io::stdout())
        .await
        .map_err(|e| rootcause::report!("ACP transport: {e}"))
}
