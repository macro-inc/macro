//! Predefined seed scenarios for local development and e2e tests.

pub mod apply;
pub mod matrix;
pub mod reset;
pub mod spec;
pub mod status;

use std::path::{Path, PathBuf};

use anyhow::{Context, ensure};
use clap::{Args, Subcommand};
use serde::Deserialize;

use crate::config::{EnvVars, SeedCliContext};
use crate::entity::{channel, channel_message, document};

const LOCAL_E2E_MANIFEST_JSON: &str = include_str!("../../../seed/local_e2e/manifest.json");
const LOCAL_E2E_RESET_SQL: &str = include_str!("../../../seed/local_e2e/reset.sql");
const LOCAL_E2E_USERS_JSON: &str = include_str!("../../../seed/local_e2e/users.json");
const LOCAL_E2E_CHANNEL_MESSAGES_SQL: &str =
    include_str!("../../../seed/local_e2e/channel_messages.sql");

#[derive(Debug, Deserialize)]
struct LocalE2eManifest {
    user: LocalE2eUserAlias,
}

#[derive(Debug, Deserialize)]
struct LocalE2eUserAlias {
    email: String,
}

#[derive(Debug, Deserialize)]
struct LocalE2eUser {
    macro_user_id: String,
    user_id: String,
    username: String,
    email: String,
    stripe_customer_id: String,
    first_name: String,
    last_name: String,
    roles: Vec<String>,
    tutorial_complete: bool,
    has_onboarding_documents: bool,
    has_trialed: bool,
    is_verified: bool,
}

struct LocalE2eSeedData {
    manifest: LocalE2eManifest,
    users: Vec<LocalE2eUser>,
}

fn local_e2e_seed_data() -> anyhow::Result<LocalE2eSeedData> {
    let manifest =
        serde_json::from_str(LOCAL_E2E_MANIFEST_JSON).context("valid local e2e manifest")?;
    let users = serde_json::from_str(LOCAL_E2E_USERS_JSON).context("valid local e2e users")?;

    Ok(LocalE2eSeedData { manifest, users })
}

fn seed_path(relative_path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path)
}

fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_bool(value: bool) -> &'static str {
    if value { "true" } else { "false" }
}

fn values_sql(rows: impl IntoIterator<Item = Vec<String>>) -> String {
    rows.into_iter()
        .map(|row| format!("({})", row.join(", ")))
        .collect::<Vec<_>>()
        .join(",\n  ")
}

fn reset_users_sql(users: &[LocalE2eUser]) -> String {
    let user_ids = users
        .iter()
        .map(|user| sql_string(&user.user_id))
        .collect::<Vec<_>>()
        .join(", ");
    let macro_user_ids = users
        .iter()
        .map(|user| sql_string(&user.macro_user_id))
        .collect::<Vec<_>>()
        .join(", ");
    let emails = users
        .iter()
        .map(|user| sql_string(&user.email))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        r#"DELETE FROM "User" WHERE id IN ({user_ids}) OR email IN ({emails});
DELETE FROM macro_user WHERE id IN ({macro_user_ids}) OR email IN ({emails});"#,
    )
}

fn seed_users_sql(users: &[LocalE2eUser]) -> String {
    let macro_user_values = values_sql(users.iter().map(|user| {
        vec![
            sql_string(&user.macro_user_id),
            sql_string(&user.username),
            sql_string(&user.email),
            sql_string(&user.stripe_customer_id),
            sql_bool(user.has_trialed).to_string(),
        ]
    }));

    let user_values = values_sql(users.iter().map(|user| {
        vec![
            sql_string(&user.user_id),
            sql_string(&user.email),
            sql_string(&user.stripe_customer_id),
            sql_string(&user.macro_user_id),
            sql_bool(user.tutorial_complete).to_string(),
            sql_bool(user.has_onboarding_documents).to_string(),
        ]
    }));

    let verification_values = values_sql(users.iter().map(|user| {
        vec![
            sql_string(&user.macro_user_id),
            sql_string(&user.email),
            sql_bool(user.is_verified).to_string(),
        ]
    }));

    let info_values = values_sql(users.iter().map(|user| {
        vec![
            sql_string(&user.macro_user_id),
            sql_string(&user.first_name),
            sql_string(&user.last_name),
        ]
    }));

    let role_rows = users.iter().flat_map(|user| {
        user.roles
            .iter()
            .map(|role| vec![sql_string(&user.user_id), sql_string(role)])
    });
    let role_values = values_sql(role_rows);
    let role_insert = if role_values.is_empty() {
        String::new()
    } else {
        format!(
            r#"
INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES
  {role_values}
ON CONFLICT DO NOTHING;"#
        )
    };

    format!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id, has_trialed) VALUES
  {macro_user_values}
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  stripe_customer_id = EXCLUDED.stripe_customer_id,
  has_trialed = EXCLUDED.has_trialed;

INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id, "tutorialComplete", "hasOnboardingDocuments") VALUES
  {user_values}
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  "stripeCustomerId" = EXCLUDED."stripeCustomerId",
  macro_user_id = EXCLUDED.macro_user_id,
  "tutorialComplete" = EXCLUDED."tutorialComplete",
  "hasOnboardingDocuments" = EXCLUDED."hasOnboardingDocuments";

INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified) VALUES
  {verification_values}
ON CONFLICT (email) DO UPDATE SET
  macro_user_id = EXCLUDED.macro_user_id,
  is_verified = EXCLUDED.is_verified;

INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES
  {info_values}
ON CONFLICT (macro_user_id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name;
{role_insert}"#,
    )
}

/// Arguments for the `scenario` subcommand.
#[derive(Debug, Args)]
pub struct ScenarioArgs {
    /// The scenario to apply.
    #[command(subcommand)]
    pub command: ScenarioCommand,
}

/// Arguments for applying a scenario config file.
#[derive(Debug, Args)]
pub struct ApplyScenarioArgs {
    /// Path to the scenario JSON file.
    #[arg(long)]
    pub file: String,
    /// Drop the local database entirely and re-run migrations before
    /// seeding. Destroys ALL local data, organic included.
    #[arg(long, short = 'f')]
    pub force: bool,
}

/// Arguments for resetting scenario data.
#[derive(Debug, Args)]
pub struct ResetScenarioArgs {
    /// Path to the scenario JSON file whose rows should be deleted.
    #[arg(long, conflicts_with = "all")]
    pub file: Option<String>,
    /// Delete the rows of every scenario (anything carrying the seed marker).
    #[arg(long)]
    pub all: bool,
}

/// Arguments for reporting a scenario's applied state.
#[derive(Debug, Args)]
pub struct StatusScenarioArgs {
    /// Path to a scenario JSON file. Omit to discover every applied
    /// scenario by its id marker.
    #[arg(long)]
    pub file: Option<String>,
}

/// Arguments for printing/verifying a scenario's access matrix.
#[derive(Debug, Args)]
pub struct MatrixScenarioArgs {
    /// Path to the scenario JSON file.
    #[arg(long)]
    pub file: String,
    /// Only print the expected matrix; skip the live database check.
    #[arg(long)]
    pub expected_only: bool,
}

/// Available seed scenarios.
#[derive(Debug, Subcommand)]
pub enum ScenarioCommand {
    /// Reset and apply the local Playwright smoke-test fixture data.
    LocalE2eSmoke,
    /// Apply a scenario config file (resets the scenario's own rows first).
    Apply(ApplyScenarioArgs),
    /// Delete every row a scenario seeded.
    Reset(ResetScenarioArgs),
    /// Print the scenario's expected access matrix and verify it against
    /// the live database.
    Matrix(MatrixScenarioArgs),
    /// Report which of a scenario's rows are present and re-print the
    /// persona login links (read-only).
    Status(StatusScenarioArgs),
}

impl ScenarioArgs {
    /// Validate environment-sensitive safety checks before connecting to services.
    pub fn validate_environment(&self, env_vars: &EnvVars) -> anyhow::Result<()> {
        match &self.command {
            ScenarioCommand::LocalE2eSmoke => {
                validate_local_e2e_environment(env_vars.database_url.as_ref())
            }
            ScenarioCommand::Apply(_) | ScenarioCommand::Reset(_) => {
                validate_scenario_environment(env_vars.database_url.as_ref())
            }
            ScenarioCommand::Matrix(_) | ScenarioCommand::Status(_) => {
                validate_scenario_database_url(env_vars.database_url.as_ref())
            }
        }
    }

    /// Execute the scenario command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            ScenarioCommand::LocalE2eSmoke => local_e2e_smoke(&ctx).await,
            ScenarioCommand::Apply(args) => apply_scenario(&ctx, &args).await,
            ScenarioCommand::Reset(args) => reset_scenario(&ctx, &args).await,
            ScenarioCommand::Matrix(args) => matrix_scenario(&ctx, &args).await,
            ScenarioCommand::Status(args) => status_scenario(&ctx, &args).await,
        }
    }

    /// Run destructive pre-connection setup (`apply --force` drops and
    /// re-migrates the database) before the CLI opens its connection pool.
    #[allow(clippy::disallowed_methods, reason = "seed-only dynamic SQL")]
    pub async fn pre_connect(&self, database_url: &str) -> anyhow::Result<()> {
        let ScenarioCommand::Apply(args) = &self.command else {
            return Ok(());
        };
        if !args.force {
            return Ok(());
        }

        use sqlx::migrate::MigrateDatabase;

        if !sqlx::Postgres::database_exists(database_url)
            .await
            .unwrap_or(false)
        {
            sqlx::Postgres::create_database(database_url)
                .await
                .context("creating database")?;
        }

        // Reset the schema rather than dropping the database: the running
        // services hold connection pools that reconnect instantly, which
        // makes DROP DATABASE lose its termination race. Dropping the
        // schema wipes every table (and the migrations ledger) while the
        // connections survive.
        println!("--force: resetting the local database schema");
        let pool = sqlx::PgPool::connect(database_url)
            .await
            .context("connecting for schema reset")?;
        for statement in [
            "DROP SCHEMA public CASCADE",
            "CREATE SCHEMA public",
            "GRANT ALL ON SCHEMA public TO PUBLIC",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .with_context(|| format!("running `{statement}`"))?;
        }

        println!("--force: running migrations");
        macro_db_migrator::MACRO_DB_MIGRATIONS
            .run(&pool)
            .await
            .context("running migrations")?;
        pool.close().await;
        Ok(())
    }
}

fn load_scenario(file: &str) -> anyhow::Result<spec::ScenarioSpec> {
    let content = std::fs::read_to_string(file)
        .with_context(|| format!("failed to read scenario file: {file}"))?;
    spec::ScenarioSpec::parse(&content)
}

#[tracing::instrument(skip(ctx), err)]
async fn apply_scenario(ctx: &SeedCliContext, args: &ApplyScenarioArgs) -> anyhow::Result<()> {
    let scenario = load_scenario(&args.file)?;
    apply::apply(ctx, &scenario, &seed_path("seed")).await
}

#[tracing::instrument(skip(ctx), err)]
async fn reset_scenario(ctx: &SeedCliContext, args: &ResetScenarioArgs) -> anyhow::Result<()> {
    let (marker, emails) = if args.all {
        (spec::SEED_MARKER.to_string(), Vec::new())
    } else {
        let file = args
            .file
            .as_deref()
            .context("pass --file <scenario.json> or --all")?;
        let scenario = load_scenario(file)?;
        let emails = scenario
            .users
            .values()
            .map(|user| user.email.clone())
            .collect();
        (spec::scenario_marker(&scenario.scenario), emails)
    };

    println!("Deleting seeded rows with marker {marker}");
    ctx.db
        .execute_sql_if_table_exists(
            "public.contacts_backfill_outbox",
            &reset::reset_contacts_outbox_statement(&marker),
        )
        .await?;
    let mut statements = reset::reset_statements(&marker);
    statements.extend(reset::reset_user_statements(&emails));
    ctx.db.execute_statements(&statements).await?;
    println!("Done.");
    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn matrix_scenario(ctx: &SeedCliContext, args: &MatrixScenarioArgs) -> anyhow::Result<()> {
    let scenario = load_scenario(&args.file)?;
    if args.expected_only {
        matrix::print_expected(&scenario);
        return Ok(());
    }
    let mismatches = matrix::verify(ctx.db.pool(), &scenario).await?;
    anyhow::ensure!(mismatches == 0, "{mismatches} matrix cell(s) mismatched");
    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn status_scenario(ctx: &SeedCliContext, args: &StatusScenarioArgs) -> anyhow::Result<()> {
    match args.file.as_deref() {
        Some(file) => {
            let scenario = load_scenario(file)?;
            status::report(ctx, &scenario).await
        }
        None => status::discover(ctx, &seed_path("seed").join("scenarios")).await,
    }
}

#[allow(clippy::disallowed_methods, reason = "Only used when running locally")]
fn validate_scenario_environment(database_url: &str) -> anyhow::Result<()> {
    ensure!(
        std::env::var("LOCAL_SEED").as_deref() == Ok("true"),
        "refusing to run scenario seeding without LOCAL_SEED=true"
    );
    validate_scenario_database_url(database_url)
}

/// Like the local-e2e guard, but allows any port so named `run_local`
/// instances work.
fn validate_scenario_database_url(database_url: &str) -> anyhow::Result<()> {
    let parsed = url::Url::parse(database_url).context("DATABASE_URL must be a valid URL")?;
    let host = parsed.host_str().unwrap_or_default();
    let username = parsed.username();
    let database = parsed.path().trim_start_matches('/');

    let is_local_host = matches!(host, "localhost" | "127.0.0.1" | "::1" | "postgres");
    let is_local_db = username == "user" && database == "macrodb";

    ensure!(
        is_local_host && is_local_db,
        "refusing to run scenario seeding against DATABASE_URL host={host:?} user={username:?} database={database:?}; expected the local docker database postgres://user:...@(localhost|127.0.0.1|postgres):<port>/macrodb"
    );

    Ok(())
}

#[allow(clippy::disallowed_methods, reason = "Only used when running locally")]
fn validate_local_e2e_environment(database_url: &str) -> anyhow::Result<()> {
    ensure!(
        std::env::var("LOCAL_E2E_SEED").as_deref() == Ok("true"),
        "refusing to run destructive local-e2e-smoke seed without LOCAL_E2E_SEED=true"
    );

    validate_local_e2e_database_url(database_url)
}

fn validate_local_e2e_database_url(database_url: &str) -> anyhow::Result<()> {
    let parsed = url::Url::parse(database_url).context("DATABASE_URL must be a valid URL")?;
    let host = parsed.host_str().unwrap_or_default();
    let username = parsed.username();
    let database = parsed.path().trim_start_matches('/');
    let is_local_host = matches!(host, "localhost" | "127.0.0.1" | "::1" | "postgres");
    let is_local_compose_db = username == "user" && database == "macrodb";

    ensure!(
        is_local_host && is_local_compose_db,
        "refusing to run local-e2e-smoke seed against DATABASE_URL host={host:?} user={username:?} database={database:?}; expected a local database postgres://user:...@(localhost|127.0.0.1|postgres):<port>/macrodb"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{local_e2e_seed_data, validate_local_e2e_database_url};

    #[test]
    fn local_e2e_database_url_accepts_localhost_compose_db() {
        validate_local_e2e_database_url("postgres://user:password@localhost:5432/macrodb").unwrap();
        validate_local_e2e_database_url("postgres://user:password@localhost:31000/macrodb")
            .unwrap();
        validate_local_e2e_database_url("postgres://user:password@127.0.0.1:5432/macrodb").unwrap();
        validate_local_e2e_database_url("postgres://user:password@postgres:5432/macrodb").unwrap();
    }

    #[test]
    fn local_e2e_database_url_rejects_dev_like_db() {
        assert!(
            validate_local_e2e_database_url(
                "postgres://macrouser:secret@macro-db-dev.example.com:5432/macrodb"
            )
            .is_err()
        );
    }

    #[test]
    fn local_e2e_database_url_rejects_wrong_local_user() {
        assert!(
            validate_local_e2e_database_url("postgres://macrouser:secret@localhost:5432/macrodb")
                .is_err()
        );
    }

    #[test]
    fn local_e2e_manifest_user_exists_in_users_json() {
        let seed_data = local_e2e_seed_data().unwrap();

        assert!(
            seed_data
                .users
                .iter()
                .any(|user| user.email == seed_data.manifest.user.email)
        );
    }
}

#[tracing::instrument(skip(ctx), err)]
async fn local_e2e_smoke(ctx: &SeedCliContext) -> anyhow::Result<()> {
    let seed_data = local_e2e_seed_data()?;
    let local_e2e_user_id = seed_data
        .users
        .iter()
        .find(|user| user.email == seed_data.manifest.user.email)
        .map(|user| user.user_id.clone())
        .with_context(|| {
            format!(
                "local e2e user {} must exist in users.json",
                seed_data.manifest.user.email
            )
        })?;

    tracing::info!("resetting local e2e smoke data");
    ctx.db
        .execute_sql_if_table_exists(
            "public.contacts_backfill_outbox",
            "DELETE FROM contacts_backfill_outbox WHERE comms_channel_id::text LIKE '00000000-0000-0000-0000-00000000000%'",
        )
        .await?;
    ctx.db.execute_sql_script(LOCAL_E2E_RESET_SQL).await?;
    ctx.db
        .execute_sql_script(&reset_users_sql(&seed_data.users))
        .await?;

    tracing::info!("creating local e2e smoke users");
    ctx.db
        .execute_sql_script(&seed_users_sql(&seed_data.users))
        .await?;

    tracing::info!("seeding local e2e smoke documents");
    let documents_path = seed_path("seed/documents/documents.json");
    document::seed_from_file_ref(
        &document::SeedArgs {
            user_id: local_e2e_user_id.clone(),
            file_path: None,
        },
        ctx,
        &documents_path,
    )
    .await?;

    tracing::info!("seeding local e2e smoke channels");
    let channels_path = seed_path("seed/channels.json");
    channel::seed_from_file_ref(
        &channel::SeedArgs {
            user_id: local_e2e_user_id.clone(),
            file_path: None,
        },
        ctx,
        &channels_path,
    )
    .await?;

    tracing::info!("seeding local e2e smoke channel messages");
    let channel_messages_path = seed_path("seed/channel_messages.json");
    channel_message::seed_from_file_ref(ctx, &channel_messages_path).await?;

    tracing::info!("seeding 5,000 local e2e messages per channel");
    ctx.db
        .execute_sql_script(LOCAL_E2E_CHANNEL_MESSAGES_SQL)
        .await?;

    println!("Local e2e smoke seed data ready for {local_e2e_user_id}");
    Ok(())
}
