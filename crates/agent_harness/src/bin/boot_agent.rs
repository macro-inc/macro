use std::sync::Arc;
use std::time::Duration;

use agent_harness::domain::ports::{AgentSandbox, SandboxProvider};
use agent_harness::domain::runtime;
use agent_harness::outbound::daytona::{
    DaytonaApiKey as DaytonaApiKeySecret, DaytonaProvider, DaytonaSettings,
    GithubToken as GithubTokenSecret,
};
use agent_harness::outbound::namespace::{
    NamespaceProvider, NamespaceSettings, NamespaceToken as NamespaceTokenSecret,
};
use agent_harness::testing::mock_proxy::LoggingAttachments;
use anyhow::Context;

macro_env_var::env_vars!(
    /// Token with read access to the repo cloned into the sandbox.
    pub struct GithubToken;
);

macro_env_var::maybe_env_vars!(
    /// Daytona API key. Required for the `daytona` provider.
    pub struct DaytonaApiKey;
    /// Name of the snapshot to boot (`just boot-daytona` builds it).
    pub struct DaytonaSnapshot;
    /// Base URL of the Daytona REST API; defaults to Daytona Cloud.
    pub struct DaytonaApiUrl;
    /// Namespace bearer token. Required for the `namespace` provider.
    pub struct NscToken;
    /// OCI reference of the harness image (`just boot-namespace` pushes it).
    pub struct NamespaceImageRef;
    /// Base URL of the region's compute API; defaults to the `us` region.
    pub struct NamespaceApiUrl;
);

const DEFAULT_DAYTONA_API_URL: &str = "https://app.daytona.io/api";
const DEFAULT_NAMESPACE_API_URL: &str = "https://us.compute.namespaceapis.com";

/// Instances are deadline-bound at creation, so this is the ceiling even if the
/// release at the end never runs. Long enough for an agent to finish a task.
const NAMESPACE_LIFETIME: Duration = Duration::from_secs(3600);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    agent_harness::install_tls_provider();

    let mut args = std::env::args().skip(1);
    let provider = args.next().unwrap_or_default();
    let prompt = args.collect::<Vec<_>>().join(" ");
    anyhow::ensure!(
        !prompt.is_empty(),
        "usage: boot_agent <daytona|namespace> <prompt>"
    );

    match provider.as_str() {
        "daytona" => run(daytona()?, prompt).await,
        "namespace" => run(namespace()?, prompt).await,
        other => anyhow::bail!("unknown provider {other:?}; expected daytona or namespace"),
    }
}

/// Spawn, prompt, watch, destroy.
///
/// Generic over the provider rather than dispatching on a boxed one: the caller
/// already knows which it wants, so each arm monomorphizes and
/// [`SandboxProvider`]'s `impl Future` return types never need boxing.
async fn run<Provider: SandboxProvider>(provider: Provider, prompt: String) -> anyhow::Result<()> {
    let attachments = Arc::new(LoggingAttachments::new(prompt));
    // Stands in for the row this would have in `agent_sessions`; it only labels
    // the logged frames.
    let session_id = macro_uuid::generate_uuid_v7();

    println!("spawning a sandbox (this pulls the image on a cold runner)");
    let sandbox = provider.spawn().await.context("spawning the sandbox")?;
    println!("sandbox {} is ready", sandbox.id());

    // Everything past spawn runs against a sandbox we are paying for, so the
    // result is held and the release happens either way.
    let result = drive(&sandbox, session_id, attachments.as_ref()).await;

    println!("releasing sandbox {}", sandbox.id());
    sandbox.release().await;

    result
}

/// The part that needs a live sandbox.
async fn drive<Sandbox: AgentSandbox>(
    sandbox: &Sandbox,
    session_id: macro_uuid::Uuid,
    attachments: &LoggingAttachments,
) -> anyhow::Result<()> {
    let frames = sandbox
        .connect()
        .await
        .context("connecting to the sidecar")?;

    // `bridge` runs until the agent closes the stream. There is no "turn
    // finished" signal to stop on yet - recognising the `session/prompt`
    // response is what the real session manager does - so ctrl-c is the escape.
    println!("--- bridging; ctrl-c to stop ---");
    tokio::select! {
        result = runtime::bridge(session_id, frames, attachments) => {
            result?;
            println!("agent closed the stream");
        }
        result = tokio::signal::ctrl_c() => {
            result.context("waiting for ctrl-c")?;
            println!("interrupted");
        }
    }

    Ok(())
}

/// Build the Daytona provider from the environment.
fn daytona() -> anyhow::Result<DaytonaProvider> {
    let api_url = DaytonaApiUrl::new()
        .map_or_else(|| DEFAULT_DAYTONA_API_URL.to_owned(), |url| url.to_string());
    let api_key = DaytonaApiKey::new().context("DAYTONA_API_KEY is required for daytona")?;
    let snapshot = DaytonaSnapshot::new().context("DAYTONA_SNAPSHOT is required for daytona")?;

    Ok(DaytonaProvider::new(DaytonaSettings {
        api_url,
        api_key: DaytonaApiKeySecret::new(api_key.to_string()),
        snapshot: snapshot.to_string(),
        github_token: GithubTokenSecret::new(GithubToken::new()?.to_string()),
    }))
}

/// Build the Namespace provider from the environment.
fn namespace() -> anyhow::Result<NamespaceProvider> {
    let api_url = NamespaceApiUrl::new().map_or_else(
        || DEFAULT_NAMESPACE_API_URL.to_owned(),
        |url| url.to_string(),
    );
    let token = NscToken::new().context("NSC_TOKEN is required for namespace")?;
    let image_ref =
        NamespaceImageRef::new().context("NAMESPACE_IMAGE_REF is required for namespace")?;

    Ok(NamespaceProvider::new(NamespaceSettings {
        api_url,
        token: NamespaceTokenSecret::new(token.to_string()),
        image_ref: image_ref.to_string(),
        lifetime: NAMESPACE_LIFETIME,
        github_token: GithubTokenSecret::new(GithubToken::new()?.to_string()),
    }))
}
