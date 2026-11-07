//! Email-code signup: a new account joins its email domain's team and counts
//! for a referral only once a code sent to that address is used.

#[path = "support/http.rs"]
mod http;

use anyhow::{Context, ensure};
use local_e2e_test_support::{LocalE2eConfig, LocalE2eServices};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

const DEFAULT_LOCAL_DATABASE_URL: &str = "postgres://user:password@localhost:5432/macrodb";
const REDIRECT_URI: &str = "https://localhost/app";

#[tokio::test]
#[ignore = "requires `just local-e2e-rust`"]
async fn domain_team_and_referral_wait_for_the_email_code() -> anyhow::Result<()> {
    let config = LocalE2eConfig::load()?;
    let services = LocalE2eServices::from_config(&config)?;
    let auth = Auth {
        http: http::http_client()?,
        url: services.authentication_url().to_owned(),
    };
    let pool = connect_db(&config).await?;

    let run = Uuid::now_v7().simple().to_string();
    let referrer_email = format!("referrer-{run}@referrer-{run}.test");
    let team_domain = format!("team-{run}.test");
    let new_email = format!("new-{run}@{team_domain}");

    let referrer_code = auth.start(&referrer_email, None).await?;
    let referrer_token = auth.complete(&referrer_email, &referrer_code).await?;
    let referral_code = auth.referral_code(&referrer_token).await?;

    let team = DomainTeam::seed(&pool, &team_domain, &format!("macro|{referrer_email}")).await?;
    let verification = verify(&auth, &pool, &team, &new_email, &referral_code).await;
    let cleanup = team.cleanup(&pool).await;
    verification.and(cleanup)
}

async fn verify(
    auth: &Auth,
    pool: &PgPool,
    team: &DomainTeam,
    new_email: &str,
    referral_code: &str,
) -> anyhow::Result<()> {
    let new_user_id = format!("macro|{new_email}");
    let code = auth.start(new_email, Some(referral_code)).await?;

    let before = Observed::read(pool, team, &new_user_id).await?;
    ensure!(
        before == Observed::default(),
        "a code request alone must not join the domain team or track the referral; saw {before:?}"
    );

    auth.complete(new_email, &code).await?;

    let after = Observed::read(pool, team, &new_user_id).await?;
    ensure!(
        after
            == Observed {
                team_member: true,
                referral_tracked: true,
            },
        "using the code must join the domain team and track the referral; saw {after:?}"
    );
    Ok(())
}

struct Auth {
    http: Client,
    url: String,
}

impl Auth {
    /// Requests an email code; local stacks return it in the response.
    async fn start(&self, email: &str, referral_code: Option<&str>) -> anyhow::Result<String> {
        let response = self
            .http
            .post(format!("{}/login/passwordless", self.url))
            .json(&json!({
                "email": email,
                "redirect_uri": REDIRECT_URI,
                "referral_code": referral_code,
            }))
            .send()
            .await
            .context("passwordless start request failed")?;
        ok_json(response, "passwordless start")
            .await?
            .get("code")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .context(
                "passwordless start returned no code; build auth with return_passwordless_code",
            )
    }

    /// Uses the code and returns the session's access token.
    async fn complete(&self, email: &str, code: &str) -> anyhow::Result<String> {
        let response = self
            .http
            .get(format!("{}/oauth/passwordless/{code}", self.url))
            .query(&[("email", email), ("disable_redirect", "true")])
            .send()
            .await
            .context("passwordless callback request failed")?;
        ok_json(response, "passwordless callback")
            .await?
            .get("access_token")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .context("passwordless callback returned no access token")
    }

    async fn referral_code(&self, access_token: &str) -> anyhow::Result<String> {
        let response = self
            .http
            .get(format!("{}/referral/code", self.url))
            .bearer_auth(access_token)
            .send()
            .await
            .context("referral code request failed")?;
        ok_json(response, "referral code")
            .await?
            .as_str()
            .map(str::to_owned)
            .context("referral code body is not a string")
    }
}

async fn ok_json(response: reqwest::Response, what: &str) -> anyhow::Result<Value> {
    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("{what}: unreadable body"))?;
    ensure!(status == StatusCode::OK, "{what}: {status} {body}");
    serde_json::from_str(&body).with_context(|| format!("{what}: body is not JSON: {body}"))
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Observed {
    team_member: bool,
    referral_tracked: bool,
}

impl Observed {
    #[expect(
        clippy::disallowed_methods,
        reason = "local E2E assertions read the runtime stack's database"
    )]
    async fn read(pool: &PgPool, team: &DomainTeam, user_id: &str) -> anyhow::Result<Self> {
        let team_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM team_user WHERE team_id = $1 AND user_id = $2)",
        )
        .bind(team.id)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .context("failed to read team membership")?;
        let referral_tracked = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM referral_tracking r
                JOIN "User" u ON u.macro_user_id = r.referred_id
                WHERE u.id = $1
            )
            "#,
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .context("failed to read referral tracking")?;
        Ok(Self {
            team_member,
            referral_tracked,
        })
    }
}

/// A team whose auto-join domain is the new account's email domain.
struct DomainTeam {
    id: Uuid,
}

impl DomainTeam {
    #[expect(
        clippy::disallowed_methods,
        reason = "local E2E fixture SQL is validated against the runtime stack"
    )]
    async fn seed(pool: &PgPool, domain: &str, owner_id: &str) -> anyhow::Result<Self> {
        let id = Uuid::now_v7();
        let mut transaction = pool.begin().await.context("failed to begin team fixture")?;
        sqlx::query(
            "INSERT INTO team (id, name, owner_id, auto_join_domain) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(format!("Email code signup E2E {id}"))
        .bind(owner_id)
        .bind(domain)
        .execute(&mut *transaction)
        .await
        .context("failed to insert domain team")?;
        sqlx::query(
            "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'owner'::team_role)",
        )
        .bind(owner_id)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .context("failed to add the team owner")?;
        transaction
            .commit()
            .await
            .context("failed to commit team fixture")?;
        Ok(Self { id })
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "local E2E fixture SQL is validated against the runtime stack"
    )]
    async fn cleanup(&self, pool: &PgPool) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await.context("failed to begin team cleanup")?;
        sqlx::query("DELETE FROM team_user WHERE team_id = $1")
            .bind(self.id)
            .execute(&mut *transaction)
            .await
            .context("failed to delete team members")?;
        sqlx::query("DELETE FROM team WHERE id = $1")
            .bind(self.id)
            .execute(&mut *transaction)
            .await
            .context("failed to delete domain team")?;
        transaction
            .commit()
            .await
            .context("failed to commit team cleanup")
    }
}

async fn connect_db(config: &LocalE2eConfig) -> anyhow::Result<PgPool> {
    let database_url = config
        .get("LOCAL_E2E_DATABASE_URL")
        .unwrap_or(DEFAULT_LOCAL_DATABASE_URL)
        .replace("@postgres:", "@localhost:");
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .context("failed to connect to MacroDB for the email code signup E2E")
}
