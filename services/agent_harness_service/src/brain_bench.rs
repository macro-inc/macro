//! A dev server for benchmarking an agent teammate's brain routes without
//! the harness's database: `/brain/captcha/solve` and
//! `/brain/fireworks/v1/chat/completions` over the real router constructors
//! and the real CapSolver and Fireworks adapters, behind a fixed bench key.
//!
//! - `BRAIN_BENCH_KEY` (required): the one bearer key it accepts, mapped to
//!   a fixed fake agent and team.
//! - `FIREWORK_API_KEY` (required): forwarded to Fireworks.
//! - `CAPSOLVER_API_KEY` (optional): unset or empty answers `notConfigured`;
//!   `OVERRIDE_CAPSOLVER_API_URL` points it at `capsolver_emulator`.
//!
//! Every usage row is printed to stdout as one JSON line and served as a JSON
//! array at `GET /_bench/usage`. Never deployed: the binary needs the
//! `brain-bench` feature.

use std::{
    io::Write,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use ai_billing::DisabledAiAdmissionService;
use ai_usage::{UsageAmount, UsageEvent, UsageRecorder};
use axum::{Json, Router, extract::State, routing::get};
use clap::Parser;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::anthropic_gateway::brain::{
    BrainAccess, BrainAuthenticator, BrainCaller, BrainLookup, BrainRollout,
};
use crate::config::{CapsolverApiKey, FireworkApiKey};
use crate::{captcha_gateway, fireworks_gateway};

/// The agent every bench call is billed to.
const BENCH_AGENT: &str = "macro|brain-bench@agents.macro.invalid";
const BENCH_TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0b0b);

macro_env_var::env_vars!(
    /// The bearer key the bench accepts.
    struct BrainBenchKey;
);

#[derive(Parser)]
#[command(about = "Serve the brain CAPTCHA and Fireworks routes for benchmarking")]
struct Args {
    /// Address to serve on.
    #[arg(long, default_value = "127.0.0.1:8490")]
    listen: SocketAddr,
}

/// Accepts exactly the bench key.
struct BenchAuthenticator {
    key: BrainBenchKey,
}

impl BrainAuthenticator for BenchAuthenticator {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        let known = key == self.key.as_ref();
        Box::pin(async move {
            Ok(known.then(|| BrainCaller {
                user_id: MacroUserIdStr::parse_from_str(BENCH_AGENT)
                    .expect("the bench agent id parses")
                    .into_owned(),
                team_id: BENCH_TEAM,
            }))
        })
    }
}

/// Keeps every usage row in memory and prints it as a JSON line.
#[derive(Default)]
struct BenchUsage {
    rows: Mutex<Vec<Value>>,
}

impl UsageRecorder for BenchUsage {
    fn record(&self, event: UsageEvent) {
        let row = usage_row(&event);
        if let Ok(line) = serde_json::to_string(&row) {
            let mut stdout = std::io::stdout().lock();
            let _ = writeln!(stdout, "{line}");
        }
        self.rows
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(row);
    }
}

fn usage_row(event: &UsageEvent) -> Value {
    let amount = match event.amount {
        UsageAmount::Tokens {
            input,
            output,
            cache_read,
            cache_write,
        } => json!({
            "kind": "tokens",
            "input": input,
            "output": output,
            "cacheRead": cache_read,
            "cacheWrite": cache_write,
        }),
        UsageAmount::Audio { duration } => {
            json!({ "kind": "audio", "seconds": duration.as_secs_f64() })
        }
        UsageAmount::ProviderCredits { credits } => {
            json!({ "kind": "providerCredits", "credits": credits })
        }
    };
    json!({
        "feature": event.feature,
        "user": event.user.as_ref(),
        "model": event.model,
        "amount": amount,
    })
}

async fn usage(State(usage): State<Arc<BenchUsage>>) -> Json<Vec<Value>> {
    Json(
        usage
            .rows
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone(),
    )
}

/// Parses `--listen`, reads the keys and serves until the process stops.
/// Tracing is the caller's (`macro_entrypoint`).
pub fn run() -> impl std::future::Future<Output = anyhow::Result<()>> {
    serve()
}

async fn serve() -> anyhow::Result<()> {
    let args = Args::parse();
    let access = BrainAccess {
        brains: Arc::new(BenchAuthenticator {
            key: BrainBenchKey::new()?,
        }),
        rollout: BrainRollout::always_on(),
        admission: Arc::new(DisabledAiAdmissionService),
    };
    let recorder = Arc::new(BenchUsage::default());

    let capsolver_key = CapsolverApiKey::new();
    let capsolver = match capsolver_key
        .as_ref()
        .and_then(CapsolverApiKey::value)
        .map(str::trim)
    {
        Some(key) if !key.is_empty() => Some(captcha_gateway::Capsolver::new(
            key,
            macro_service_urls::CapsolverApiUrl::new()?.as_str(),
        )?),
        _ => None,
    };
    tracing::info!(
        capsolver = capsolver.is_some(),
        "brain bench CAPTCHA solving"
    );
    let captcha = captcha_gateway::CaptchaGateway::new(
        access.clone(),
        capsolver,
        recorder.clone(),
        captcha_gateway::SolveLimits::default(),
    );
    let fireworks = fireworks_gateway::FireworksGateway::new(
        access,
        recorder.clone(),
        fireworks_gateway::FIREWORKS_API_URL,
        FireworkApiKey::new()?.as_ref(),
    )?;

    let app = captcha_gateway::router(captcha)
        .merge(fireworks_gateway::router(fireworks))
        .merge(
            Router::new()
                .route("/_bench/usage", get(usage))
                .with_state(recorder),
        );
    let listener = tokio::net::TcpListener::bind(args.listen).await?;
    tracing::info!(address = %listener.local_addr()?, "brain bench listening");
    axum::serve(listener, app).await?;
    Ok(())
}
