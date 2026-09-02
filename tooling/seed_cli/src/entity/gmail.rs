//! Seed REAL Gmail test mailboxes (`@macro-test.com`) through the Gmail API.
//!
//! Unlike `entity::email` (which fabricates rows directly in the local
//! database), this imports messages into an actual Workspace test account so
//! the real connect → backfill → sync pipeline has something to pull
//! (macro-2634). Deterministic: the same `--rng-seed` and `--count` produce
//! the same mailbox shape.
//!
//! Auth: a stored refresh token per account (`GMAIL_TEST_ACCOUNT_TOKENS`, a
//! JSON map of account email → refresh token) issued by the Internal OAuth
//! client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET_KEY` — in local mode the
//! latter holds the secret value itself). `just gmail …` in this crate's
//! justfile pulls all three from AWS Secrets Manager.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use clap::{Args, Subcommand};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

#[cfg(test)]
mod test;

use crate::config::{
    GmailForwarderSaKey, GmailTestAccountTokens, GoogleClientId, GoogleClientSecretKey,
};
use crate::entity::email::{FAKE_CONTACTS, SUBJECTS, sample_bodies};

const GMAIL_BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// Hard safety line: this tool only ever touches dedicated test accounts.
const TEST_DOMAIN: &str = "@macro-test.com";

/// Arguments for the `gmail` entity command.
#[derive(Debug, Args)]
pub struct GmailArgs {
    /// The gmail action to perform
    #[command(subcommand)]
    pub command: GmailCommand,
}

/// Actions against a real test mailbox.
#[derive(Debug, Subcommand)]
pub enum GmailCommand {
    /// Import deterministic fixture messages into a test mailbox
    Seed(SeedArgs),
    /// Delete every message in a test mailbox (including spam/trash)
    Reset(AccountArg),
    /// Print the mailbox's message/thread totals
    Status(AccountArg),
    /// Forward Gmail push notifications from the Pub/Sub subscription to a
    /// local stack's webhook, so connected inboxes sync live (runs forever)
    Forward(ForwardArgs),
}

/// Arguments for `gmail forward`.
#[derive(Debug, Args)]
pub struct ForwardArgs {
    /// The local email-service webhook to deliver notifications to, through
    /// the instance proxy (e.g. http://localhost:50009/email/gmail/webhook
    /// for `--instance 2634`)
    #[arg(long, default_value = "http://localhost:8090/email/gmail/webhook")]
    target: String,
    /// The Pub/Sub pull subscription attached to the Gmail watch topic
    #[arg(
        long,
        default_value = "projects/macro-email-testing/subscriptions/gmail-local-watch-sub"
    )]
    subscription: String,
    /// OIDC audience the webhook validates (`GmailClient` hardcodes this)
    #[arg(long, default_value = "macro-gmail-webhook")]
    webhook_audience: String,
    /// Topic to attach the subscription to if it does not exist yet
    #[arg(
        long,
        default_value = "projects/macro-email-testing/topics/gmail-local-watch"
    )]
    topic: String,
}

/// Arguments for `gmail seed`.
#[derive(Debug, Args)]
pub struct SeedArgs {
    /// Test account to import into (must be @macro-test.com)
    #[arg(long)]
    account: String,
    /// Total number of messages to import
    #[arg(long, default_value_t = 10_000)]
    count: usize,
    /// RNG seed: same seed + count → same mailbox shape
    #[arg(long, default_value_t = 42)]
    rng_seed: u64,
    /// Imports per second (import costs 25 quota units against a 250
    /// units/sec/user cap, so keep this below 10)
    #[arg(long, default_value_t = 6)]
    rps: u64,
    /// Skip the first N generated messages (resume an interrupted run — the
    /// generation is deterministic, so the remainder picks up exactly where
    /// the previous run stopped)
    #[arg(long, default_value_t = 0)]
    offset: usize,
    /// Concurrent in-flight imports (paced by --rps regardless)
    #[arg(long, default_value_t = 5)]
    concurrency: usize,
}

/// Arguments naming just the target account.
#[derive(Debug, Args)]
pub struct AccountArg {
    /// Test account (must be @macro-test.com)
    #[arg(long)]
    account: String,
}

impl GmailArgs {
    /// Execute the gmail command. Deliberately does not take the
    /// `SeedCliContext`: this talks only to Google, so it must work without
    /// the local stack (DB) running.
    pub async fn execute(self) -> anyhow::Result<()> {
        match self.command {
            GmailCommand::Seed(args) => seed(args).await,
            GmailCommand::Reset(args) => reset(args).await,
            GmailCommand::Status(args) => status(args).await,
            GmailCommand::Forward(args) => forward(args).await,
        }
    }
}

fn http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("building the HTTP client")
}

fn require_test_account(email: &str) -> anyhow::Result<()> {
    if !email.ends_with(TEST_DOMAIN) {
        bail!("refusing to touch {email}: only {TEST_DOMAIN} test accounts are allowed");
    }
    Ok(())
}

/// An authenticated Gmail API client for one test account, with retry,
/// pacing-agnostic backoff, and automatic access-token refresh. Shareable
/// across concurrent import tasks (`&self` everywhere; the token refresh is
/// single-flight behind `refresh_gate`).
struct GmailApi {
    http: reqwest::Client,
    access_token: tokio::sync::RwLock<String>,
    refresh_gate: tokio::sync::Mutex<()>,
    client_id: String,
    client_secret: String,
    refresh_token: String,
}

impl GmailApi {
    async fn for_account(account: &str) -> anyhow::Result<Self> {
        require_test_account(account)?;
        let client_id = GoogleClientId::new()
            .context(
                "GOOGLE_CLIENT_ID is not set (use `just gmail …` to pull it from Secrets Manager)",
            )?
            .to_string();
        let client_secret = GoogleClientSecretKey::new()
            .context("GOOGLE_CLIENT_SECRET_KEY is not set (use `just gmail …`)")?
            .to_string();
        let tokens = GmailTestAccountTokens::new()
            .context("GMAIL_TEST_ACCOUNT_TOKENS is not set (use `just gmail …`)")?
            .to_string();
        let tokens: BTreeMap<String, String> = serde_json::from_str(&tokens)
            .context("GMAIL_TEST_ACCOUNT_TOKENS is not a JSON map of email → refresh token")?;
        let refresh_token = tokens
            .get(account)
            .with_context(|| {
                format!(
                    "no refresh token stored for {account}; known accounts: {:?}",
                    tokens.keys().collect::<Vec<_>>()
                )
            })?
            .clone();

        let api = GmailApi {
            http: http_client()?,
            access_token: tokio::sync::RwLock::new(String::new()),
            refresh_gate: tokio::sync::Mutex::new(()),
            client_id,
            client_secret,
            refresh_token,
        };
        api.refresh_access_token(String::new()).await?;
        Ok(api)
    }

    /// Refresh the access token, single-flight: concurrent 401s all pass the
    /// token they failed with, and whoever loses the race to the gate returns
    /// immediately if the token has already been replaced.
    async fn refresh_access_token(&self, failed_token: String) -> anyhow::Result<()> {
        let _gate = self.refresh_gate.lock().await;
        if *self.access_token.read().await != failed_token {
            return Ok(());
        }
        let resp: serde_json::Value = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("refresh_token", self.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .context("refresh-token request failed")?
            .json()
            .await
            .context("refresh-token response was not JSON")?;
        *self.access_token.write().await = resp["access_token"]
            .as_str()
            .with_context(|| format!("no access_token in refresh response: {resp}"))?
            .to_string();
        Ok(())
    }

    /// POST/GET with exponential backoff on 429/5xx and a one-shot token
    /// refresh on 401. Returns the response body for 2xx.
    async fn call(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<&serde_json::Value>,
    ) -> anyhow::Result<serde_json::Value> {
        let mut refreshed = false;
        for attempt in 0..7u32 {
            let token = self.access_token.read().await.clone();
            let mut req = self.http.request(method.clone(), url).bearer_auth(&token);
            if let Some(body) = body {
                req = req.json(body);
            }
            let resp = match req.send().await {
                Ok(resp) => resp,
                Err(e) if attempt < 6 => {
                    tracing::warn!(error=?e, attempt, "gmail request error, backing off");
                    tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                Err(e) => return Err(e).context("gmail request failed after retries"),
            };
            let status = resp.status();
            if status.is_success() {
                if status == reqwest::StatusCode::NO_CONTENT {
                    return Ok(serde_json::Value::Null);
                }
                return resp.json().await.context("gmail response was not JSON");
            }
            if status == reqwest::StatusCode::UNAUTHORIZED && !refreshed {
                refreshed = true;
                self.refresh_access_token(token).await?;
                continue;
            }
            // Gmail reports per-user quota exhaustion as 403 rateLimitExceeded
            // (not 429); it is transient and must back off like a 429.
            if status == reqwest::StatusCode::FORBIDDEN {
                let text = resp.text().await.unwrap_or_default();
                if text.contains("rateLimitExceeded") && attempt < 6 {
                    tracing::warn!(attempt, "gmail per-user quota exceeded, backing off");
                    tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                bail!("gmail request to {url} failed: {status}: {text}");
            }
            if (status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
                && attempt < 6
            {
                tracing::warn!(%status, attempt, "gmail request throttled, backing off");
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                continue;
            }
            let text = resp.text().await.unwrap_or_default();
            bail!("gmail request to {url} failed: {status}: {text}");
        }
        bail!("gmail request to {url} failed: retries exhausted")
    }
}

/// A leaky-bucket pacer: each caller takes the next start slot (spaced
/// `1/rps` apart) and sleeps until it. Bounds the request START rate across
/// all concurrent import tasks regardless of response latency.
struct Pacer {
    next_slot: tokio::sync::Mutex<tokio::time::Instant>,
    step: Duration,
}

impl Pacer {
    fn new(rps: u64) -> Self {
        Pacer {
            next_slot: tokio::sync::Mutex::new(tokio::time::Instant::now()),
            step: Duration::from_millis(1000 / rps.max(1)),
        }
    }

    async fn wait_turn(&self) {
        let slot = {
            let mut next = self.next_slot.lock().await;
            let now = tokio::time::Instant::now();
            let slot = (*next).max(now);
            *next = slot + self.step;
            slot
        };
        tokio::time::sleep_until(slot).await;
    }
}

/// One planned RFC 2822 message.
struct PlannedMessage {
    message_id: String,
    date: DateTime<Utc>,
    from: (String, String),
    to: (String, String),
    subject: String,
    references: Vec<String>,
    labels: Vec<&'static str>,
    body: String,
}

impl PlannedMessage {
    fn to_rfc2822(&self) -> String {
        let mut headers = vec![
            format!("Message-ID: {}", self.message_id),
            format!("Date: {}", self.date.to_rfc2822()),
            format!("From: {} <{}>", self.from.1, self.from.0),
            format!("To: {} <{}>", self.to.1, self.to.0),
            format!("Subject: {}", self.subject),
        ];
        if let Some(parent) = self.references.last() {
            headers.push(format!("In-Reply-To: {parent}"));
            headers.push(format!("References: {}", self.references.join(" ")));
        }
        headers.push("MIME-Version: 1.0".to_string());
        headers.push("Content-Type: text/plain; charset=\"UTF-8\"".to_string());
        let body = self.body.replace('\n', "\r\n");
        format!("{}\r\n\r\n{}", headers.join("\r\n"), body)
    }
}

/// Deterministically generate the full mailbox plan. Thread-structured: ~30%
/// of threads have 2–5 messages with alternating direction (incoming vs the
/// account's own replies, which land as SENT), realistic category mix
/// (CATEGORY_PERSONAL-heavy so the backfill priority pass has work to do),
/// and dates quadratically weighted toward the recent past year.
fn generate_plan(account: &str, count: usize, rng_seed: u64) -> Vec<PlannedMessage> {
    let mut rng = StdRng::seed_from_u64(rng_seed);
    let bodies = sample_bodies::load_sample_bodies();
    let template_names = sample_bodies::TEMPLATE_NAMES;
    let now = Utc::now();
    let mut plan: Vec<PlannedMessage> = Vec::with_capacity(count);
    let mut msg_index = 0usize;

    while plan.len() < count {
        let thread_len = if rng.random_range(0..100) < 30 {
            rng.random_range(2..=5usize)
        } else {
            1
        };
        let contact_idx = rng.random_range(0..FAKE_CONTACTS.len());
        let (contact_addr, contact_name) = FAKE_CONTACTS[contact_idx];
        let subject = SUBJECTS[rng.random_range(0..SUBJECTS.len())].to_string();
        let category = match rng.random_range(0..100) {
            0..55 => "CATEGORY_PERSONAL",
            55..75 => "CATEGORY_UPDATES",
            75..90 => "CATEGORY_PROMOTIONS",
            _ => "CATEGORY_FORUMS",
        };
        // Quadratic weighting: most threads start in the recent months.
        let age_frac: f64 = rng.random::<f64>();
        let mut date = now
            - chrono::Duration::seconds((age_frac * age_frac * 365.0 * 86_400.0) as i64)
            - chrono::Duration::seconds(rng.random_range(0..86_400));
        let mut references: Vec<String> = Vec::new();

        for reply_idx in 0..thread_len {
            if plan.len() >= count {
                break;
            }
            // First message is always incoming; replies alternate, so
            // multi-message threads exercise SENT + conversation grouping.
            let outgoing = reply_idx > 0 && reply_idx % 2 == 1;
            let message_id = format!("<seed-{rng_seed}-{msg_index}@seed.macro-test.local>");
            msg_index += 1;

            let mut labels: Vec<&'static str> = Vec::new();
            if outgoing {
                labels.push("SENT");
            } else {
                labels.push("INBOX");
                labels.push(category);
                if rng.random_range(0..100) < 35 {
                    labels.push("UNREAD");
                }
                if rng.random_range(0..100) < 15 {
                    labels.push("IMPORTANT");
                }
                if rng.random_range(0..100) < 3 {
                    labels.push("STARRED");
                }
            }

            let template = template_names[rng.random_range(0..template_names.len())];
            let (text_body, _html) = &bodies[template];
            // Vary body size: 1–4 copies of the template paragraph block.
            let body = text_body.repeat(rng.random_range(1..=4));

            let subject = if reply_idx == 0 {
                subject.clone()
            } else {
                format!("Re: {subject}")
            };
            let (from, to) = if outgoing {
                (
                    (account.to_string(), "Bigbox Test".to_string()),
                    (contact_addr.to_string(), contact_name.to_string()),
                )
            } else {
                (
                    (contact_addr.to_string(), contact_name.to_string()),
                    (account.to_string(), "Bigbox Test".to_string()),
                )
            };

            plan.push(PlannedMessage {
                message_id: message_id.clone(),
                // Reply offsets can walk a recent thread past current time, clamp so
                // the fixture never contains future-dated mail.
                date: date.min(now),
                from,
                to,
                subject,
                references: references.clone(),
                labels,
                body,
            });
            references.push(message_id);
            date += chrono::Duration::seconds(rng.random_range(600..172_800));
        }
    }
    plan
}

async fn seed(args: SeedArgs) -> anyhow::Result<()> {
    use futures::StreamExt;

    let api = std::sync::Arc::new(GmailApi::for_account(&args.account).await?);
    let plan = generate_plan(&args.account, args.count, args.rng_seed);
    let total = plan.len();
    if args.offset >= total {
        bail!("--offset {} is beyond the plan size {total}", args.offset);
    }
    tracing::info!(
        account = %args.account,
        total,
        offset = args.offset,
        rps = args.rps,
        concurrency = args.concurrency,
        eta_min = ((total - args.offset) as u64 / args.rps.max(1)) / 60,
        "importing messages"
    );

    let url = std::sync::Arc::new(format!(
        "{GMAIL_BASE}/messages/import?internalDateSource=dateHeader&neverMarkSpam=true"
    ));
    let started = Instant::now();
    let pacer = std::sync::Arc::new(Pacer::new(args.rps));
    let done = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    // Concurrent imports, paced at the start (Gmail threads by the References
    // headers, so parent/reply arrival order does not matter). On any failure
    // the earliest failed index is reported so `--offset` can resume.
    let failures: Vec<usize> =
        futures::stream::iter(plan.into_iter().enumerate().skip(args.offset))
            .map(|(i, message)| {
                let api = api.clone();
                let url = url.clone();
                let pacer = pacer.clone();
                let done = done.clone();
                async move {
                    pacer.wait_turn().await;
                    let body = serde_json::json!({
                        "raw": URL_SAFE_NO_PAD.encode(message.to_rfc2822()),
                        "labelIds": message.labels,
                    });
                    let result = api.call(reqwest::Method::POST, &url, Some(&body)).await;
                    match result {
                        Ok(_) => {
                            let count = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                            if count.is_multiple_of(250) {
                                let elapsed = started.elapsed().as_secs().max(1);
                                let rate = count as u64 / elapsed;
                                tracing::info!(
                                    done = args.offset + count,
                                    total,
                                    rate_per_sec = rate,
                                    eta_min =
                                        (total - args.offset - count) as u64 / rate.max(1) / 60,
                                    "import progress"
                                );
                            }
                            None
                        }
                        Err(e) => {
                            tracing::error!(error=?e, index = i, "import failed");
                            Some(i)
                        }
                    }
                }
            })
            .buffer_unordered(args.concurrency)
            .filter_map(futures::future::ready)
            .collect()
            .await;

    if let Some(first_failed) = failures.iter().min() {
        // Imports after the first failure may have succeeded (concurrency), so
        // resuming at the first failed index would re-import those and create
        // duplicates. `--offset` is only exact for a clean interruption
        // (ctrl-c/crash); scattered failures need a reset.
        bail!(
            "{} of {total} imports failed (first at index {first_failed}); the mailbox now has \
             gaps that `--offset` cannot resume without duplicates — run `gmail reset` and reseed \
             (consider lower --rps/--concurrency: sustained failures usually mean quota contention, \
             e.g. a connected local stack live-syncing this mailbox while it seeds)",
            failures.len()
        );
    }
    status(AccountArg {
        account: args.account,
    })
    .await
}

async fn reset(args: AccountArg) -> anyhow::Result<()> {
    let api = GmailApi::for_account(&args.account).await?;
    let mut deleted = 0usize;
    loop {
        let list = api
            .call(
                reqwest::Method::GET,
                &format!("{GMAIL_BASE}/messages?maxResults=500&includeSpamTrash=true"),
                None,
            )
            .await?;
        let ids: Vec<String> = list["messages"]
            .as_array()
            .map(|messages| {
                messages
                    .iter()
                    .filter_map(|message| message["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if ids.is_empty() {
            break;
        }
        deleted += ids.len();
        let body = serde_json::json!({ "ids": ids });
        api.call(
            reqwest::Method::POST,
            &format!("{GMAIL_BASE}/messages/batchDelete"),
            Some(&body),
        )
        .await?;
        tracing::info!(deleted, "reset progress");
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    tracing::info!(account = %args.account, deleted, "mailbox reset complete");
    status(args).await
}

async fn status(args: AccountArg) -> anyhow::Result<()> {
    let api = GmailApi::for_account(&args.account).await?;
    let profile = api
        .call(reqwest::Method::GET, &format!("{GMAIL_BASE}/profile"), None)
        .await?;
    tracing::info!(
        email = %profile["emailAddress"].as_str().unwrap_or("?"),
        messages_total = profile["messagesTotal"].as_u64().unwrap_or(0),
        threads_total = profile["threadsTotal"].as_u64().unwrap_or(0),
        history_id = %profile["historyId"].as_str().unwrap_or("?"),
        "mailbox status"
    );
    Ok(())
}

/// A service-account access token, minted via the OAuth JWT-bearer grant and
/// re-minted before expiry.
struct SaToken {
    http: reqwest::Client,
    client_email: String,
    encoding_key: jsonwebtoken::EncodingKey,
    access_token: String,
    minted_at: Instant,
    /// Google-signed OIDC identity token presented to the webhook — the same
    /// authentication a real Pub/Sub push subscription uses.
    id_token: String,
    id_token_audience: String,
    id_minted_at: Instant,
}

impl SaToken {
    async fn from_env(http: reqwest::Client) -> anyhow::Result<Self> {
        let key_json = GmailForwarderSaKey::new()
            .context("GMAIL_FORWARDER_SA_KEY is not set (use `just gmail …`)")?
            .to_string();
        let key: serde_json::Value =
            serde_json::from_str(&key_json).context("GMAIL_FORWARDER_SA_KEY is not JSON")?;
        let client_email = key["client_email"]
            .as_str()
            .context("SA key has no client_email")?
            .to_string();
        let encoding_key = jsonwebtoken::EncodingKey::from_rsa_pem(
            key["private_key"]
                .as_str()
                .context("SA key has no private_key")?
                .as_bytes(),
        )
        .context("SA private_key is not a valid RSA PEM")?;
        let mut token = SaToken {
            http,
            client_email,
            encoding_key,
            access_token: String::new(),
            minted_at: Instant::now(),
            id_token: String::new(),
            id_token_audience: String::new(),
            id_minted_at: Instant::now(),
        };
        token.refresh().await?;
        Ok(token)
    }

    /// Google-signed OIDC id token for `audience`, re-minted before expiry.
    /// The JWT-bearer grant with a `target_audience` claim (instead of
    /// `scope`) returns an identity token with iss=accounts.google.com and
    /// aud=`audience` — which is exactly what the webhook's
    /// `validate_google_token` verifies.
    async fn webhook_bearer(&mut self, audience: &str) -> anyhow::Result<&str> {
        if self.id_token_audience == audience
            && self.id_minted_at.elapsed() < Duration::from_secs(50 * 60)
            && !self.id_token.is_empty()
        {
            return Ok(&self.id_token);
        }
        #[derive(serde::Serialize)]
        struct IdClaims<'a> {
            iss: &'a str,
            aud: &'a str,
            target_audience: &'a str,
            iat: u64,
            exp: u64,
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_secs();
        let assertion = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
            &IdClaims {
                iss: &self.client_email,
                aud: TOKEN_URL,
                target_audience: audience,
                iat: now,
                exp: now + 3600,
            },
            &self.encoding_key,
        )
        .context("signing the id-token assertion")?;
        let resp: serde_json::Value = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .context("id-token request failed")?
            .json()
            .await
            .context("id-token response was not JSON")?;
        self.id_token = resp["id_token"]
            .as_str()
            .with_context(|| format!("no id_token in response: {resp}"))?
            .to_string();
        self.id_token_audience = audience.to_string();
        self.id_minted_at = Instant::now();
        Ok(&self.id_token)
    }

    async fn refresh(&mut self) -> anyhow::Result<()> {
        #[derive(serde::Serialize)]
        struct Claims<'a> {
            iss: &'a str,
            scope: &'a str,
            aud: &'a str,
            iat: u64,
            exp: u64,
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_secs();
        let assertion = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
            &Claims {
                iss: &self.client_email,
                scope: "https://www.googleapis.com/auth/pubsub",
                aud: TOKEN_URL,
                iat: now,
                exp: now + 3600,
            },
            &self.encoding_key,
        )
        .context("signing the service-account JWT")?;
        let resp: serde_json::Value = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .context("SA token request failed")?
            .json()
            .await
            .context("SA token response was not JSON")?;
        self.access_token = resp["access_token"]
            .as_str()
            .with_context(|| format!("no access_token in SA token response: {resp}"))?
            .to_string();
        self.minted_at = Instant::now();
        Ok(())
    }

    async fn bearer(&mut self) -> anyhow::Result<&str> {
        // SA access tokens live an hour; re-mint with headroom.
        if self.minted_at.elapsed() > Duration::from_secs(50 * 60) {
            self.refresh().await?;
        }
        Ok(&self.access_token)
    }
}

/// Create the pull subscription if it does not exist. Per-instance
/// subscriptions let concurrent local stacks each receive every notification
/// (a subscription is a queue, not a broadcast); the expiration policy lets
/// Google garbage-collect subscriptions of instances nobody runs anymore.
async fn ensure_subscription(
    http: &reqwest::Client,
    sa: &mut SaToken,
    subscription: &str,
    topic: &str,
) -> anyhow::Result<()> {
    let url = format!("https://pubsub.googleapis.com/v1/{subscription}");
    let token = sa.bearer().await?.to_string();
    let status = http
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .context("subscription lookup failed")?
        .status();
    if status.is_success() {
        return Ok(());
    }
    if status != reqwest::StatusCode::NOT_FOUND {
        bail!("subscription lookup returned {status}");
    }
    let resp = http
        .put(&url)
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "topic": topic,
            "ackDeadlineSeconds": 30,
            "expirationPolicy": { "ttl": "2678400s" },
        }))
        .send()
        .await
        .context("subscription create failed")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!(
            "creating subscription {subscription} failed: {status}: {body} \
             (the service account needs Pub/Sub Editor on the topic/project)"
        );
    }
    tracing::info!(%subscription, %topic, "created pull subscription");
    Ok(())
}

/// Pull Gmail watch notifications and re-deliver them to the local webhook in
/// Pub/Sub push-envelope shape (what the webhook deserializes as
/// `GmailInboxSyncPayload`). Messages are acked only after the webhook accepts
/// them, so a stack that is down redelivers instead of losing sync events.
async fn forward(args: ForwardArgs) -> anyhow::Result<()> {
    let http = http_client()?;
    let mut sa = SaToken::from_env(http.clone()).await?;
    ensure_subscription(&http, &mut sa, &args.subscription, &args.topic).await?;
    let pull_url = format!(
        "https://pubsub.googleapis.com/v1/{}:pull",
        args.subscription
    );
    let ack_url = format!(
        "https://pubsub.googleapis.com/v1/{}:acknowledge",
        args.subscription
    );
    tracing::info!(subscription = %args.subscription, target = %args.target, "forwarding gmail notifications (ctrl-c to stop)");

    let mut forwarded = 0u64;
    loop {
        let token = sa.bearer().await?;
        let pull: serde_json::Value = match http
            .post(&pull_url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "maxMessages": 25 }))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                resp.json().await.unwrap_or(serde_json::Value::Null)
            }
            Ok(resp) => {
                tracing::warn!(status = %resp.status(), "pull failed, backing off");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
            Err(e) => {
                tracing::warn!(error = ?e, "pull error, backing off");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };
        let received = pull["receivedMessages"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if received.is_empty() {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }

        let mut ack_ids: Vec<String> = Vec::new();
        for entry in &received {
            // Pub/Sub pull returns STANDARD base64 but the webhook's
            // deserializer strictly decodes URL_SAFE (the push alphabet) —
            // transcode so payloads containing '+'/'/' can't poison the queue.
            let data = entry["message"]["data"].as_str().unwrap_or_default();
            let decoded = match STANDARD.decode(data) {
                Ok(bytes) => bytes,
                Err(e) => {
                    tracing::warn!(error = ?e, "notification data is not base64; acking to discard");
                    if let Some(ack) = entry["ackId"].as_str() {
                        ack_ids.push(ack.to_string());
                    }
                    continue;
                }
            };
            let envelope = serde_json::json!({
                "message": {
                    "data": URL_SAFE.encode(&decoded),
                    "messageId": entry["message"]["messageId"],
                    "publishTime": entry["message"]["publishTime"],
                },
                "subscription": args.subscription,
            });
            let webhook_token = sa.webhook_bearer(&args.webhook_audience).await?.to_string();
            match http
                .post(&args.target)
                .bearer_auth(webhook_token)
                .json(&envelope)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    if let Some(ack) = entry["ackId"].as_str() {
                        ack_ids.push(ack.to_string());
                    }
                    forwarded += 1;
                    let notification = String::from_utf8_lossy(&decoded);
                    tracing::info!(forwarded, %notification, "delivered to webhook");
                }
                Ok(resp) => {
                    tracing::warn!(status = %resp.status(), "webhook rejected notification; leaving unacked");
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "webhook unreachable; leaving unacked");
                }
            }
        }
        if !ack_ids.is_empty() {
            let token = sa.bearer().await?;
            if let Err(e) = http
                .post(&ack_url)
                .bearer_auth(token)
                .json(&serde_json::json!({ "ackIds": ack_ids }))
                .send()
                .await
            {
                tracing::warn!(error = ?e, "ack failed; notifications will redeliver");
            }
        }
    }
}
