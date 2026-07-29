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
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use clap::{Args, Subcommand};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

use crate::config::{GmailTestAccountTokens, GoogleClientId, GoogleClientSecretKey};
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
        }
    }
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
            http: reqwest::Client::new(),
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
        unreachable!("retry loop always returns or bails")
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
                date,
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
        bail!(
            "{} imports failed; resume with `--offset {first_failed}` after checking the errors above",
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
