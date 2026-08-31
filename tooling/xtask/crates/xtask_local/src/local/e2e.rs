//! Local E2E orchestration: isolated stack, deterministic seed, and test runner.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, ensure};
use clap::{Args, ValueEnum};

use super::cli::{BuildArgs, EnvArgs, InstanceArgs, RunArgs};
use super::instance::{Instance, Port};
use super::{Mode, frontend, proxy, repo_root, stack};

const DEFAULT_INSTANCE: &str = "local-e2e";

/// Which local E2E suite xtask should run after seeding.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum LocalE2eSuite {
    /// Run the Playwright suite.
    #[default]
    Web,
    /// Run the ignored Rust integration tests.
    Rust,
    /// Run Rust first, then Playwright.
    All,
}

/// Arguments for `cargo x local-e2e`.
#[derive(Args, Clone, Debug, Default)]
pub struct LocalE2eArgs {
    /// Isolated stack name. Defaults to `LOCAL_E2E_INSTANCE` or `local-e2e`.
    #[arg(long)]
    pub instance: Option<String>,
    /// Override the instance's derived port base.
    #[arg(long)]
    pub port_base: Option<u16>,
    /// Test suite to run after the stack is ready and seeded.
    #[arg(long, value_enum, default_value_t)]
    pub suite: LocalE2eSuite,
    /// Open Playwright's interactive UI instead of running headlessly.
    #[arg(long)]
    pub ui: bool,
    /// Arguments forwarded to the selected suite. In `all`, they go to Playwright.
    #[arg(last = true, allow_hyphen_values = true)]
    pub test_args: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Endpoints {
    proxy_url: String,
    frontend_url: String,
    postgres_url: String,
    fusionauth_url: String,
    localstack_url: String,
    connection_gateway_ws_url: String,
    generated_env: PathBuf,
}

impl Endpoints {
    fn for_instance(instance: &Instance) -> Self {
        Self {
            proxy_url: proxy::url(instance),
            frontend_url: frontend::url(instance),
            postgres_url: format!(
                "postgres://user:password@localhost:{}/macrodb",
                instance.port(Port::Postgres)
            ),
            fusionauth_url: format!("http://localhost:{}", instance.port(Port::FusionAuth)),
            localstack_url: format!("http://localhost:{}", instance.port(Port::LocalStack)),
            connection_gateway_ws_url: format!(
                "ws://localhost:{}/connection-gateway",
                instance.port(Port::Proxy)
            ),
            generated_env: instance.artifact_dir().join("local.generated.env"),
        }
    }

    fn test_env(&self) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        env.insert("LOCAL_E2E".into(), "true".into());
        env.insert(
            "LOCAL_E2E_ENV_FILE".into(),
            self.generated_env.display().to_string(),
        );
        env.insert("LOCAL_E2E_BASE_URL".into(), self.frontend_url.clone());
        env.insert("LOCAL_E2E_BACKEND_ORIGIN".into(), self.proxy_url.clone());
        env.insert("LOCAL_E2E_DATABASE_URL".into(), self.postgres_url.clone());
        env.insert("DATABASE_URL".into(), self.postgres_url.clone());
        env.insert(
            "LOCAL_E2E_DOCUMENT_STORAGE_URL".into(),
            format!("{}/dss", self.proxy_url),
        );
        env.insert(
            "LOCAL_E2E_CONNECTION_GATEWAY_WS_URL".into(),
            self.connection_gateway_ws_url.clone(),
        );
        env.insert(
            "LOCAL_E2E_NOTIFICATION_URL".into(),
            format!("{}/notification", self.proxy_url),
        );
        env
    }
}

/// Start an isolated stack, seed it, and run the requested local E2E suite.
pub fn run(args: &LocalE2eArgs) -> Result<()> {
    validate_args(args)?;
    super::kafka::ensure_available("local-e2e")?;

    let instance_name = args
        .instance
        .clone()
        .or_else(|| macro_env_var::maybe_read_env("LOCAL_E2E_INSTANCE"))
        .unwrap_or_else(|| DEFAULT_INSTANCE.to_string());
    let up_args = stack::UpArgs {
        run: RunArgs {
            instance: InstanceArgs {
                instance: Some(instance_name),
                port_base: args.port_base,
            },
            env: EnvArgs::default(),
            build: BuildArgs::default(),
            no_frontend: true,
            enable_onboarding: false,
            traces: None,
            verbose: false,
            with_cf_tunnel: false,
        },
        ..stack::UpArgs::default()
    };
    let instance = stack::up(Mode::Local, &up_args)?;
    let endpoints = Endpoints::for_instance(&instance);
    ensure!(
        endpoints.generated_env.is_file(),
        "generated stack environment not found at {}",
        endpoints.generated_env.display()
    );

    run_seed(&endpoints)?;
    let test_env = endpoints.test_env();
    match args.suite {
        LocalE2eSuite::Web => run_web(&test_env, args.ui, &args.test_args),
        LocalE2eSuite::Rust => run_rust(&test_env, &args.test_args),
        LocalE2eSuite::All => {
            run_rust(&test_env, &[])?;
            run_web(&test_env, false, &args.test_args)
        }
    }
}

fn validate_args(args: &LocalE2eArgs) -> Result<()> {
    ensure!(
        !args.ui || args.suite == LocalE2eSuite::Web,
        "--ui is only supported with --suite web"
    );
    Ok(())
}

fn run_seed(endpoints: &Endpoints) -> Result<()> {
    println!("\nSeeding local E2E fixtures...");
    let mut env = load_generated_env(&endpoints.generated_env)?;
    env.insert("LOCAL_E2E_SEED".into(), "true".into());
    env.insert("DATABASE_URL".into(), endpoints.postgres_url.clone());
    env.insert("LOCAL_AWS_URL".into(), endpoints.localstack_url.clone());
    env.insert(
        "FUSIONAUTH_BASE_URL".into(),
        endpoints.fusionauth_url.clone(),
    );
    env.insert(
        "FUSIONAUTH_OAUTH_REDIRECT_URI".into(),
        endpoints.frontend_url.clone(),
    );

    let mut command = cargo_command();
    command
        .current_dir(repo_root())
        .args(["run", "--quiet", "--manifest-path"])
        .arg(repo_root().join("Cargo.toml"))
        .args(["-p", "seed_cli", "--", "scenario", "local-e2e-smoke"])
        .envs(env)
        .env_remove("SQLX_OFFLINE");
    require_success(&mut command, "local E2E seed")
}

fn run_rust(env: &BTreeMap<String, String>, test_args: &[String]) -> Result<()> {
    println!("\nRunning Rust local E2E tests...");
    let mut command = cargo_command();
    command
        .current_dir(repo_root())
        .args(["test", "--manifest-path"])
        .arg(repo_root().join("Cargo.toml"))
        .args([
            "-p",
            "local_e2e_integration_tests",
            "--",
            "--ignored",
            "--nocapture",
        ])
        .args(test_args)
        .envs(env)
        .env_remove("SQLX_OFFLINE");
    require_success(&mut command, "Rust local E2E tests")
}

fn run_web(env: &BTreeMap<String, String>, ui: bool, test_args: &[String]) -> Result<()> {
    println!("\nRunning Playwright local E2E tests...");
    let mut command = Command::new("bunx");
    command
        .current_dir(repo_root().join("apps/web"))
        .args(["playwright", "test"]);
    if ui {
        command.arg("--ui");
    }
    command.args(test_args).envs(env);
    require_success(&mut command, "Playwright local E2E tests")
}

fn load_generated_env(path: &Path) -> Result<BTreeMap<String, String>> {
    dotenvy::from_path_iter(path)
        .with_context(|| format!("reading generated stack environment {}", path.display()))?
        .map(|entry| entry.map_err(anyhow::Error::from))
        .collect()
}

fn cargo_command() -> Command {
    Command::new(std::env::var_os("CARGO").unwrap_or_else(|| OsString::from("cargo")))
}

fn require_success(command: &mut Command, description: &str) -> Result<()> {
    let status = command
        .status()
        .with_context(|| format!("starting {description}"))?;
    ensure!(status.success(), "{description} exited with {status}");
    Ok(())
}

#[cfg(test)]
mod test;
