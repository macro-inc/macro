//! Pulls snapshots of real tasks into [`EvalCorpus`] fixtures for the semantic
//! evaluation suite.
//!
//! This is read-only against the source database. It selects tasks created by
//! Macro employees (owner `macro|…@macro.com`) — internal dogfooding data,
//! deliberately excluding customer tasks — and emits **two** corpora:
//!
//! - a *title-only* set (tasks whose lexical body is empty), and
//! - a *with-body* set (tasks with a non-empty body, fetched from the lexical
//!   service).
//!
//! Two safeguards keep the committed fixtures clean:
//!
//! 1. **Sensitivity filter.** Each task's title + body is shown to a fast model
//!    (Haiku) which flags sensitive content (HR/personnel decisions, comp,
//!    payments/financial detail, SSNs/government ids, secrets, personal/medical
//!    info). Flagged tasks — and any the model fails to judge — are dropped.
//! 2. **Email anonymization.** Every real `…@macro.com` email in the owner,
//!    title, body, and property values is replaced with a fictitious
//!    `macro|<name>@macro.com` drawn from a fixed set of 20 names, mapped
//!    deterministically so the same person maps to the same fake email.
//!
//! Neither the sensitivity model call nor anything else writes back to the
//! source database (a no-op usage recorder is used).
//!
//! Usage:
//! ```text
//! cargo run -p task_dedup --features backfill --bin pull_task_corpus -- prod \
//!   --limit-per-set 100 \
//!   --out-title-only crates/task_dedup/fixtures/eval/prod_title_only.json \
//!   --out-with-body  crates/task_dedup/fixtures/eval/prod_with_body.json
//! ```
//! Requires `aws` auth (source DB URL + secrets) and `ANTHROPIC_API_KEY` /
//! `OPENAI_API_KEY` / `CEREBRAS_API_KEY` in the environment (the agent router
//! the Haiku filter routes through).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use anyhow::{Context as _, Result, bail};
use clap::Parser;
use futures::StreamExt;
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::MarkdownTarget;
use macro_env_var::env_var;
use macro_service_urls::LexicalServiceUrl;
use secretsmanager_client::{SecretManager, SecretsManager};
use serde_json::json;
use sqlx::PgPool;
use task_dedup::eval::{CorpusTask, EvalCorpus, TaskSource};

/// Fictitious names used to anonymize employee emails. Real owner/assignee
/// emails are mapped deterministically onto `macro|<name>@macro.com`.
const FAKE_NAMES: [&str; 20] = [
    "alex.rivera",
    "sam.chen",
    "jordan.blake",
    "taylor.morgan",
    "casey.nguyen",
    "riley.patel",
    "quinn.foster",
    "avery.diaz",
    "morgan.reed",
    "drew.kim",
    "jamie.ortiz",
    "reese.walsh",
    "parker.hayes",
    "skyler.brooks",
    "rowan.cole",
    "emerson.gray",
    "hayden.ross",
    "logan.pierce",
    "sasha.bennett",
    "micah.stone",
];

env_var! {
    /// Env config read for local pulls (dev/prod resolve from AWS instead).
    struct LocalVars {
        InternalApiSecretKey,
    }
}

/// Target environment for the pull.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum Env {
    /// Local development macrodb on localhost.
    Local,
    /// Dev environment: resolve the DB URL and secrets from AWS.
    Dev,
    /// Production environment: resolve the DB URL and secrets from AWS.
    Prod,
}

impl Env {
    fn suffix(self) -> &'static str {
        match self {
            Env::Local => "local",
            Env::Dev => "dev",
            Env::Prod => "prod",
        }
    }

    fn lexical_service_url(self) -> Result<String> {
        let environment = match self {
            Env::Local => macro_service_urls::macro_env::Environment::Local,
            Env::Dev => macro_service_urls::macro_env::Environment::Develop,
            Env::Prod => macro_service_urls::macro_env::Environment::Production,
        };
        Ok(LexicalServiceUrl::new_for_environment(environment)?.to_string())
    }
}

/// Pulls title-only and with-body task snapshots into eval corpus fixtures.
#[derive(Debug, clap::Parser)]
#[command(name = "pull_task_corpus", about, long_about = None)]
struct Args {
    /// Environment to pull from: local | dev | prod.
    #[arg(value_enum)]
    env: Env,
    /// Target size for each of the two sets.
    #[arg(long, default_value_t = 100)]
    limit_per_set: usize,
    /// Maximum recent tasks to scan from the database before filtering. Bodies
    /// and the sensitivity check are only run against this many candidates.
    #[arg(long, default_value_t = 350)]
    max_candidates: i64,
    /// Skip tasks whose trimmed title is shorter than this.
    #[arg(long, default_value_t = 4)]
    min_title_chars: i32,
    /// Number of tasks to fetch + judge concurrently.
    #[arg(long, default_value_t = 6)]
    concurrency: usize,
    /// Explicit task document ids to pull (repeatable). When given, only these
    /// tasks are fetched — the recency scan and the sensitivity filter are
    /// skipped (the caller has vetted the ids) — and the result is written to
    /// `--out` as a single corpus. Emails are still anonymized.
    #[arg(long = "id")]
    ids: Vec<String>,
    /// Output path for `--id` mode (a single corpus of the requested tasks).
    #[arg(long)]
    out: Option<PathBuf>,
    /// Output path for the title-only set (recency mode).
    #[arg(long)]
    out_title_only: Option<PathBuf>,
    /// Output path for the with-body set (recency mode).
    #[arg(long)]
    out_with_body: Option<PathBuf>,
}

// ---------------------------------------------------------------------------
// Email anonymization
// ---------------------------------------------------------------------------

/// Deterministic FNV-1a hash, used to map a real email's local part onto one of
/// the fixed fake names stably across runs.
fn fnv1a(text: &str) -> u64 {
    let mut hash = 1469598103934665603_u64;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

/// Maps one real `…@macro.com` token to a fictitious one, preserving a leading
/// `macro|` prefix when present. The mapping is stable per local part.
fn fake_for(token: &str) -> String {
    let (prefix, rest) = match token.strip_prefix("macro|") {
        Some(rest) => ("macro|", rest),
        None => ("", token),
    };
    let local = rest.split('@').next().unwrap_or(rest);
    let name = FAKE_NAMES[(fnv1a(local) % FAKE_NAMES.len() as u64) as usize];
    format!("{prefix}{name}@macro.com")
}

/// Collects every `…@macro.com` email token in `text`, including a leading
/// `macro|` prefix when present, longest first so replacements don't clobber
/// each other (the prefixed form is replaced before its bare substring).
fn collect_macro_emails(text: &str) -> Vec<String> {
    const DOMAIN: &str = "@macro.com";
    let is_local = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-');

    let mut tokens = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find(DOMAIN) {
        let at = search_from + rel;
        // Walk left over the local part.
        let mut start = at;
        while start > 0 {
            let prev = text[..start].chars().next_back().unwrap();
            if !is_local(prev) {
                break;
            }
            start -= prev.len_utf8();
        }
        if start < at {
            // Include a `macro|` prefix if it immediately precedes the local part.
            let token_start = if text[..start].ends_with("macro|") {
                start - "macro|".len()
            } else {
                start
            };
            let end = at + DOMAIN.len();
            tokens.push(text[token_start..end].to_string());
        }
        search_from = at + DOMAIN.len();
    }
    tokens.sort_by_key(|token| std::cmp::Reverse(token.len()));
    tokens.dedup();
    tokens
}

/// Replaces every `…@macro.com` email in `text` with its fictitious mapping.
fn anonymize(text: &str) -> String {
    let mut out = text.to_string();
    for token in collect_macro_emails(text) {
        out = out.replace(&token, &fake_for(&token));
    }
    out
}

/// Anonymizes a task's property values by scrubbing emails from the serialized
/// JSON and parsing it back.
fn anonymize_properties(properties: &serde_json::Value) -> serde_json::Value {
    let serialized = properties.to_string();
    serde_json::from_str(&anonymize(&serialized)).unwrap_or_else(|_| properties.clone())
}

// ---------------------------------------------------------------------------
// Sensitivity filter
// ---------------------------------------------------------------------------

static SENSITIVITY_PROMPT: &str = r#"You screen internal engineering task descriptions before they are committed to a shared test fixture.

Answer whether the task contains SENSITIVE content that should not be committed. Sensitive means any of:
- HR or personnel decisions (hiring, firing, performance, promotions, complaints)
- compensation, salary, equity, or offer details
- payment details, financial account numbers, invoices, or revenue figures tied to a named customer
- SSNs, government ids, passport/license numbers
- secrets, API keys, passwords, private keys, credentials
- personal or medical information about an identifiable individual
- legal/contractual matters marked confidential

Ordinary engineering work (bugs, features, refactors, infra, UI, product ideas) is NOT sensitive, even if it names a product, service, or teammate. When genuinely unsure, mark it sensitive."#;

/// No-op usage recorder: the puller must not write ai_usage rows into the source
/// database, so the Haiku sensitivity calls are recorded nowhere.
struct NoopRecorder;

impl ai_usage::UsageRecorder for NoopRecorder {
    fn record(&self, _event: ai_usage::UsageEvent) {}
}

/// Asks Haiku whether a task is sensitive. Fails closed: any model or parse
/// error is treated as sensitive so questionable rows are excluded.
async fn is_sensitive(recorder: &dyn ai_usage::UsageRecorder, title: &str, body: &str) -> bool {
    let body_for_prompt = if body.is_empty() { "<empty>" } else { body };
    let prompt = format!("Task title:\n{title}\n\nTask body:\n{body_for_prompt}");
    let schema = DynamicSchema {
        name: "SensitivityScreen".to_string(),
        description: Some("Whether a task contains sensitive content.".to_string()),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["sensitive"],
            "properties": {
                "sensitive": { "type": "boolean" },
                "reason": { "type": "string" }
            }
        }),
    };

    let value = dynamic_structured_completion(
        PredefinedModel::Fast,
        SENSITIVITY_PROMPT,
        vec![Message::user(prompt)],
        schema,
        recorder,
        ai_usage::UsageContext::system(ai_usage::AiFeature::Automation),
    )
    .await;

    match value {
        Ok(value) => value
            .get("sensitive")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
        Err(_) => true,
    }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/// A candidate task row as pulled from the database.
struct CandidateRow {
    id: String,
    title: String,
    owner: String,
    properties: serde_json::Value,
}

/// A processed task plus whether it landed in the title-only bucket.
struct Processed {
    title_only: bool,
    task: CorpusTask,
}

/// Shared, cheaply-cloneable context for the concurrent processing stage.
struct Ctx {
    lexical: LexicalClient,
    recorder: NoopRecorder,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let database_url = match args.env {
        Env::Local => "postgres://user:password@localhost:5432/macrodb".to_string(),
        env => fetch_database_url(env)?,
    };
    let internal_api_secret_key = resolve_internal_api_secret_key(args.env).await?;
    let lexical_service_url = args.env.lexical_service_url()?;
    println!(
        "pulling from {}: {} (lexical {})",
        args.env.suffix(),
        masked_db_url(&database_url),
        lexical_service_url,
    );

    let pool = PgPool::connect(&database_url)
        .await
        .context("failed to connect to database")?;
    let ctx = Arc::new(Ctx {
        lexical: LexicalClient::new(internal_api_secret_key, lexical_service_url),
        recorder: NoopRecorder,
    });

    // Explicit-id mode: fetch exactly the requested tasks, no recency scan or
    // sensitivity filter (the caller vetted them), still anonymized.
    if !args.ids.is_empty() {
        let out = args.out.context("--out is required when --id is given")?;
        let rows = fetch_by_ids(&pool, &args.ids).await?;
        println!(
            "fetched {}/{} requested task(s)",
            rows.len(),
            args.ids.len()
        );
        let tasks: Vec<CorpusTask> = futures::stream::iter(rows)
            .map(|row| {
                let ctx = ctx.clone();
                async move { process_explicit(&ctx, row).await }
            })
            .buffer_unordered(args.concurrency)
            .collect()
            .await;
        write_corpus(&out, tasks)?;
        return Ok(());
    }

    let out_title_only = args
        .out_title_only
        .context("--out-title-only is required in recency mode")?;
    let out_with_body = args
        .out_with_body
        .context("--out-with-body is required in recency mode")?;

    let candidates = fetch_candidates(&pool, args.max_candidates, args.min_title_chars).await?;
    println!("scanning {} candidate task(s)", candidates.len());

    let dropped = Arc::new(Mutex::new(0usize));
    let processed: Vec<Processed> = futures::stream::iter(candidates)
        .map(|row| {
            let ctx = ctx.clone();
            let dropped = dropped.clone();
            async move { process_candidate(&ctx, row, &dropped).await }
        })
        .buffer_unordered(args.concurrency)
        .filter_map(|result| async move { result })
        .collect()
        .await;

    let mut title_only: Vec<CorpusTask> = processed
        .iter()
        .filter(|p| p.title_only)
        .map(|p| p.task.clone())
        .collect();
    let mut with_body: Vec<CorpusTask> = processed
        .iter()
        .filter(|p| !p.title_only)
        .map(|p| p.task.clone())
        .collect();
    title_only.truncate(args.limit_per_set);
    with_body.truncate(args.limit_per_set);

    println!(
        "dropped {} sensitive/unfetchable; kept {} title-only, {} with-body",
        *dropped.lock().unwrap(),
        title_only.len(),
        with_body.len(),
    );

    write_corpus(&out_title_only, title_only)?;
    write_corpus(&out_with_body, with_body)?;
    Ok(())
}

/// Fetches the given document ids (whatever their sub-type), with owner + raw
/// property values, for `--id` mode. Missing/deleted ids are simply absent from
/// the result.
async fn fetch_by_ids(pool: &PgPool, ids: &[String]) -> Result<Vec<CandidateRow>> {
    let rows = sqlx::query!(
        r#"
        SELECT
            d.id AS "id!",
            d.name AS "title!",
            d.owner AS "owner!",
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'property', pd.display_name,
                            'data_type', pd.data_type,
                            'values', ep.values
                        )
                    )
                    FROM entity_properties ep
                    JOIN property_definitions pd ON pd.id = ep.property_definition_id
                    WHERE ep.entity_id = d.id
                      AND ep.entity_type = 'TASK'::property_entity_type
                      AND ep.values IS NOT NULL
                ),
                '[]'::json
            ) AS "properties!"
        FROM "Document" d
        WHERE d.id = ANY($1)
          AND d."deletedAt" IS NULL
        "#,
        ids,
    )
    .fetch_all(pool)
    .await
    .context("failed to query tasks by id")?;

    Ok(rows
        .into_iter()
        .map(|row| CandidateRow {
            id: row.id,
            title: row.title,
            owner: row.owner,
            properties: row.properties,
        })
        .collect())
}

/// Fetches a body and anonymizes one explicitly-requested task. Unlike
/// [`process_candidate`] it does not run the sensitivity filter and keeps the
/// task even if the body can't be fetched (empty body).
async fn process_explicit(ctx: &Ctx, row: CandidateRow) -> CorpusTask {
    let body = ctx
        .lexical
        .get_markdown(&row.id, MarkdownTarget::Embedding)
        .await
        .map(|body| body.trim().to_string())
        .unwrap_or_default();

    CorpusTask {
        id: row.id,
        title: anonymize(&row.title),
        body: anonymize(&body),
        owner: Some(anonymize(&row.owner)),
        source: TaskSource::Prod,
        properties: Some(anonymize_properties(&row.properties))
            .filter(|value| !is_empty_json_array(value)),
    }
}

/// Fetches, classifies, screens, and anonymizes one candidate. Returns `None`
/// when the body can't be fetched or the task is judged sensitive.
async fn process_candidate(
    ctx: &Ctx,
    row: CandidateRow,
    dropped: &Mutex<usize>,
) -> Option<Processed> {
    let body = match ctx
        .lexical
        .get_markdown(&row.id, MarkdownTarget::Embedding)
        .await
    {
        Ok(body) => body.trim().to_string(),
        Err(_) => {
            *dropped.lock().unwrap() += 1;
            return None;
        }
    };

    if is_sensitive(&ctx.recorder, &row.title, &body).await {
        *dropped.lock().unwrap() += 1;
        return None;
    }

    let title_only = body.is_empty();
    let task = CorpusTask {
        id: row.id,
        title: anonymize(&row.title),
        body: anonymize(&body),
        owner: Some(anonymize(&row.owner)),
        source: TaskSource::Prod,
        properties: Some(anonymize_properties(&row.properties))
            .filter(|value| !is_empty_json_array(value)),
    };
    Some(Processed { title_only, task })
}

/// Selects the most recent employee-created tasks with owner + raw property
/// values. Bodies are fetched separately from the lexical service.
async fn fetch_candidates(
    pool: &PgPool,
    max_candidates: i64,
    min_title_chars: i32,
) -> Result<Vec<CandidateRow>> {
    let rows = sqlx::query!(
        r#"
        SELECT
            d.id AS "id!",
            d.name AS "title!",
            d.owner AS "owner!",
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'property', pd.display_name,
                            'data_type', pd.data_type,
                            'values', ep.values
                        )
                    )
                    FROM entity_properties ep
                    JOIN property_definitions pd ON pd.id = ep.property_definition_id
                    WHERE ep.entity_id = d.id
                      AND ep.entity_type = 'TASK'::property_entity_type
                      AND ep.values IS NOT NULL
                ),
                '[]'::json
            ) AS "properties!"
        FROM document_sub_type dst
        JOIN "Document" d ON d.id = dst.document_id
        WHERE dst.sub_type = 'task'
          AND d."deletedAt" IS NULL
          AND d.owner LIKE 'macro|%@macro.com'
          AND length(btrim(d.name)) >= $1
        ORDER BY d."createdAt" DESC
        LIMIT $2
        "#,
        min_title_chars,
        max_candidates,
    )
    .fetch_all(pool)
    .await
    .context("failed to query tasks")?;

    Ok(rows
        .into_iter()
        .map(|row| CandidateRow {
            id: row.id,
            title: row.title,
            owner: row.owner,
            properties: row.properties,
        })
        .collect())
}

fn write_corpus(path: &PathBuf, tasks: Vec<CorpusTask>) -> Result<()> {
    let corpus = EvalCorpus {
        tasks,
        pairs: Vec::new(),
    };
    let json = corpus.to_json()?;
    std::fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    println!("wrote {} task(s) to {}", corpus.tasks.len(), path.display());
    Ok(())
}

fn is_empty_json_array(value: &serde_json::Value) -> bool {
    value.as_array().is_some_and(|array| array.is_empty())
}

/// Resolves the lexical-service internal auth key: for local, from the
/// `INTERNAL_API_SECRET_KEY` env var; for dev/prod, from the
/// `document-storage-service-auth-key-<env>` secret.
async fn resolve_internal_api_secret_key(env: Env) -> Result<String> {
    if env == Env::Local {
        let vars =
            LocalVars::new().context("INTERNAL_API_SECRET_KEY must be set for local pulls")?;
        return Ok(vars.internal_api_secret_key.as_ref().to_string());
    }
    // SAFETY: runs once at startup before other threads read the env.
    unsafe { std::env::remove_var("LOCAL_AWS_URL") };
    let secrets = SecretsManager::new(aws_sdk_secretsmanager::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ));
    let key = secrets
        .get_secret_value(format!(
            "document-storage-service-auth-key-{}",
            env.suffix()
        ))
        .await?;
    Ok(key.as_ref().to_string())
}

/// Fetches the full `DATABASE_URL` for `env` from AWS Secrets Manager via the
/// `aws` CLI, reading the `macro-db-<env>` secret. The CLI must be authenticated.
fn fetch_database_url(env: Env) -> Result<String> {
    let secret_id = format!("macro-db-{}", env.suffix());
    println!("fetching DATABASE_URL from secret {secret_id}");

    let output = std::process::Command::new("aws")
        .args([
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            &secret_id,
            "--query",
            "SecretString",
            "--output",
            "text",
            "--region",
            "us-east-1",
        ])
        .output()
        .with_context(|| format!("failed to run `aws` to read secret {secret_id}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "`aws secretsmanager get-secret-value` failed for {secret_id} \
             (check AWS auth / permissions): {}",
            stderr.trim()
        );
    }

    let database_url = String::from_utf8(output.stdout)
        .context("aws output was not valid UTF-8")?
        .trim()
        .to_string();

    if database_url.is_empty() {
        bail!("secret {secret_id} resolved to an empty value");
    }

    Ok(database_url)
}

/// Masks the password in a `postgres://user:password@host/...` URL for logging.
fn masked_db_url(url: &str) -> String {
    url.split_once("://")
        .and_then(|(scheme, rest)| {
            let (creds, host) = rest.split_once('@')?;
            let user = creds.split_once(':').map_or(creds, |(user, _)| user);
            Some(format!("{scheme}://{user}:******@{host}"))
        })
        .unwrap_or_else(|| url.to_string())
}
