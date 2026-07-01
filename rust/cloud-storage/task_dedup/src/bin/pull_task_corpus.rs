//! Pulls a snapshot of real tasks into an [`EvalCorpus`] fixture for the
//! semantic evaluation suite.
//!
//! This is read-only. It selects tasks created by Macro employees (owner
//! `macro|…@macro.com`) — internal dogfooding data, deliberately excluding
//! customer tasks — and writes their titles and raw property values to a JSON
//! corpus. Task *bodies* live in the lexical service rather than Postgres, so
//! this DB-only puller captures titles and properties; the labeled body-based
//! cases are covered by the hand-authored synthetic corpus. Bodies could be
//! layered in later via the same lexical path the embedding backfill uses.
//!
//! The emitted corpus has no labeled pairs — pair labels are a human judgement
//! and are added by hand (or merged from the synthetic set) afterwards.
//!
//! Usage:
//! ```text
//! # against local macrodb
//! cargo run -p task_dedup --features backfill --bin pull_task_corpus -- local --limit 150 --output <path>
//! # against prod (reads the macro-db-prod secret via the aws CLI; requires aws auth)
//! cargo run -p task_dedup --features backfill --bin pull_task_corpus -- prod --limit 150 --output <path>
//! ```

use std::path::PathBuf;

use anyhow::{Context as _, Result, bail};
use clap::Parser;
use sqlx::PgPool;
use task_dedup::eval::{CorpusTask, EvalCorpus, TaskSource};

/// Target environment for the pull.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum Env {
    /// Local development macrodb on localhost.
    Local,
    /// Dev environment: resolve the DB URL from AWS Secrets Manager.
    Dev,
    /// Production environment: resolve the DB URL from AWS Secrets Manager.
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
}

/// Pulls a task snapshot into an eval corpus fixture.
#[derive(Debug, clap::Parser)]
#[command(name = "pull_task_corpus", about, long_about = None)]
struct Args {
    /// Environment to pull from: local | dev | prod.
    #[arg(value_enum)]
    env: Env,
    /// Maximum number of tasks to pull (most recent first).
    #[arg(long, default_value_t = 150)]
    limit: i64,
    /// Skip tasks whose trimmed title is shorter than this, to drop empty/junk
    /// rows.
    #[arg(long, default_value_t = 4)]
    min_title_chars: i32,
    /// Path to write the corpus JSON to.
    #[arg(long)]
    output: PathBuf,
}

/// One task row as pulled from the database.
struct TaskRow {
    id: String,
    title: String,
    properties: serde_json::Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let database_url = match args.env {
        Env::Local => "postgres://user:password@localhost:5432/macrodb".to_string(),
        env => fetch_database_url(env)?,
    };
    println!(
        "pulling from {}: {}",
        args.env.suffix(),
        masked_db_url(&database_url)
    );

    let pool = PgPool::connect(&database_url)
        .await
        .context("failed to connect to database")?;

    let rows = fetch_tasks(&pool, args.limit, args.min_title_chars).await?;
    println!("pulled {} task(s)", rows.len());

    let corpus = EvalCorpus {
        tasks: rows
            .into_iter()
            .map(|row| CorpusTask {
                id: row.id,
                title: row.title,
                body: String::new(),
                source: TaskSource::Prod,
                properties: Some(row.properties).filter(|value| !is_empty_json_array(value)),
            })
            .collect(),
        pairs: Vec::new(),
    };

    let json = corpus.to_json()?;
    std::fs::write(&args.output, json)
        .with_context(|| format!("failed to write corpus to {}", args.output.display()))?;
    println!(
        "wrote {} task(s) to {}",
        corpus.tasks.len(),
        args.output.display()
    );
    Ok(())
}

/// Selects the most recent employee-created tasks with their raw property values.
///
/// Scoped to `owner LIKE 'macro|%@macro.com'` (internal dogfooding data only)
/// and non-deleted task documents with a non-trivial title. Properties are
/// aggregated as `[{property, data_type, values}]` using each definition's
/// display name; SelectOption/EntityReference ids inside `values` are left
/// unresolved (readable-label resolution is follow-up work).
async fn fetch_tasks(pool: &PgPool, limit: i64, min_title_chars: i32) -> Result<Vec<TaskRow>> {
    let rows = sqlx::query!(
        r#"
        SELECT
            d.id AS "id!",
            d.name AS "title!",
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
        limit,
    )
    .fetch_all(pool)
    .await
    .context("failed to query tasks")?;

    Ok(rows
        .into_iter()
        .map(|row| TaskRow {
            id: row.id,
            title: row.title,
            properties: row.properties,
        })
        .collect())
}

fn is_empty_json_array(value: &serde_json::Value) -> bool {
    value.as_array().is_some_and(|array| array.is_empty())
}

/// Fetches the full `DATABASE_URL` for `env` from AWS Secrets Manager by
/// shelling out to the `aws` CLI, reading the `macro-db-<env>` secret — the same
/// primary-writer connection string the deployed services use. The `aws` CLI
/// must be on `PATH` and authenticated.
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
