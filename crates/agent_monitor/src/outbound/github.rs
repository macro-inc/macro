//! Pull request status from GitHub: the one polled source.
//!
//! The store publishes what to look up ([`PrWanted`]: pull requests named by
//! transcripts and managers, and agent branches). Every `[monitor]
//! pr_poll_secs` (with jitter) while a viewer is subscribed, and at most every
//! [`IDLE_POLL`] otherwise, this source resolves each branch's working
//! directory to its `origin` repository (`git remote get-url origin`, cached)
//! and asks GitHub about everything in one batched GraphQL query through the
//! `gh` CLI (`gh api graphql --input -`), so it uses whatever account `gh` is
//! signed in to. A newly named pull request is looked up within seconds while
//! someone watches. Without `gh` the source reports itself absent and looks
//! again later; a failed query marks it unhealthy and keeps what it reported.

mod query;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use rand::Rng as _;
use tokio::io::AsyncWriteExt as _;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

use crate::domain::model::{PrRef, RepoName, SourceHealth, SourceKind, SourceState};
use crate::domain::observation::{
    BranchCandidate, Change, CheckoutFact, Fact, Observation, PrStatusFact, PrWanted,
};
use crate::domain::source::{AgentSource, PrInterest, SourceError};
pub use query::{CI_GATE_CONTEXT, Lookup, PrQuery, RepoLookups, parse_response, queries};

/// With no viewer subscribed, GitHub is asked at most this often.
pub const IDLE_POLL: Duration = Duration::from_secs(5 * 60);

/// How long to wait before looking for `gh` again when none was found.
const DISCOVERY_RETRY: Duration = Duration::from_secs(5 * 60);

/// A newly named pull request is looked up this long after it appears, so a
/// burst of changes makes one query.
const NEW_REF_DEBOUNCE: Duration = Duration::from_secs(5);

/// Never two queries closer together than this.
const MIN_GAP: Duration = Duration::from_secs(15);

/// Each interval is stretched or shrunk by up to this fraction.
const JITTER: f64 = 0.1;

/// How long one `gh` or `git` call may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Why a call to GitHub failed.
#[derive(Debug, thiserror::Error)]
pub enum GithubError {
    /// No `gh` program was found.
    #[error("gh not found")]
    NotFound,
    /// `gh` ran but returned no usable answer.
    #[error("gh api failed: {0}")]
    Failed(String),
}

/// How this source reaches GitHub and git. Behind a trait so tests answer
/// with fixtures instead of the network.
pub trait GithubBackend: Clone + Send + Sync + 'static {
    /// Runs one GraphQL query and returns the response body.
    fn graphql(&self, query: String) -> impl Future<Output = Result<Vec<u8>, GithubError>> + Send;

    /// The `origin` remote URL of the checkout holding `cwd`, if any.
    fn origin(&self, cwd: PathBuf) -> impl Future<Output = Option<String>> + Send;
}

/// The real backend: the first `gh` that exists, and `git`.
#[derive(Clone, Debug)]
pub struct GhCli {
    programs: Vec<PathBuf>,
}

impl GhCli {
    /// Runs the first of `programs` that exists (a bare name is looked up on
    /// `PATH`).
    pub fn new(programs: Vec<PathBuf>) -> Self {
        Self { programs }
    }

    /// Where `gh` usually is, after `PATH`, for a user's home directory.
    pub fn default_programs(home: &Path) -> Vec<PathBuf> {
        let mut programs = vec![PathBuf::from("gh"), home.join(".local/bin/gh")];
        if let Some(user) = home.file_name() {
            programs.push(
                Path::new("/etc/profiles/per-user")
                    .join(user)
                    .join("bin/gh"),
            );
        }
        programs.extend([
            home.join(".nix-profile/bin/gh"),
            PathBuf::from("/run/current-system/sw/bin/gh"),
            PathBuf::from("/opt/homebrew/bin/gh"),
            PathBuf::from("/usr/local/bin/gh"),
            PathBuf::from("/usr/bin/gh"),
        ]);
        programs
    }
}

impl GithubBackend for GhCli {
    async fn graphql(&self, query: String) -> Result<Vec<u8>, GithubError> {
        let body = serde_json::json!({ "query": query }).to_string();
        for program in &self.programs {
            let spawned = Command::new(program)
                .args(["api", "graphql", "--input", "-"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .env("GH_PROMPT_DISABLED", "1")
                .kill_on_drop(true)
                .spawn();
            let mut child = match spawned {
                Ok(child) => child,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(GithubError::Failed(error.to_string())),
            };
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(body.as_bytes())
                    .await
                    .map_err(|error| GithubError::Failed(error.to_string()))?;
            }
            let output = tokio::time::timeout(CALL_TIMEOUT, child.wait_with_output())
                .await
                .map_err(|_elapsed| GithubError::Failed(String::from("timed out")))?
                .map_err(|error| GithubError::Failed(error.to_string()))?;
            // A partial answer (some pull request not found) exits non-zero
            // but still carries `data`; the parser decides.
            if output.stdout.is_empty() {
                return Err(GithubError::Failed(format!("exit {}", output.status)));
            }
            return Ok(output.stdout);
        }
        Err(GithubError::NotFound)
    }

    async fn origin(&self, cwd: PathBuf) -> Option<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(&cwd)
            .args(["remote", "get-url", "origin"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .kill_on_drop(true)
            .output();
        let output = tokio::time::timeout(CALL_TIMEOUT, output)
            .await
            .ok()?
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let url = String::from_utf8(output.stdout).ok()?;
        Some(url.trim().to_owned())
    }
}

/// The repository a GitHub remote URL points at, over HTTPS
/// (`https://github.com/o/r`) or SSH (scp-style `github.com:o/r.git`, or
/// `ssh://` with `github.com/o/r.git`), with any user before the host.
pub fn repo_of_remote(url: &str) -> Option<RepoName> {
    let captures =
        lazy_regex::regex!(r"github\.com[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
            .captures(url.trim())?;
    RepoName::parse(&format!(
        "{}/{}",
        captures.get(1)?.as_str(),
        captures.get(2)?.as_str()
    ))
}

/// Polls GitHub for the pull requests the store wants.
#[derive(Clone)]
pub struct GithubSource<B = GhCli> {
    backend: B,
    interest: PrInterest,
    every: Duration,
}

impl<B: GithubBackend> GithubSource<B> {
    /// Asks through `backend` every `every` while someone watches.
    pub fn new(backend: B, interest: PrInterest, every: Duration) -> Self {
        Self {
            backend,
            interest,
            every,
        }
    }
}

#[async_trait]
impl<B: GithubBackend> AgentSource for GithubSource<B> {
    fn kind(&self) -> SourceKind {
        SourceKind::Github
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        let mut poller = Poller {
            source: *self,
            out,
            origins: HashMap::new(),
            sent_checkouts: BTreeMap::new(),
            polled: PrWanted::default(),
            last_poll: None,
            gap: Duration::ZERO,
            new_since: None,
            reported_absent: false,
        };
        poller.run(cancel).await
    }
}

struct Poller<B> {
    source: GithubSource<B>,
    out: mpsc::Sender<Observation>,
    /// Each working directory's repository, once looked up (`None`: not a
    /// GitHub checkout).
    origins: HashMap<PathBuf, Option<RepoName>>,
    sent_checkouts: BTreeMap<PathBuf, RepoName>,
    /// What the last query covered.
    polled: PrWanted,
    last_poll: Option<Instant>,
    /// The jittered interval chosen after the last query.
    gap: Duration,
    /// When something new to look up first appeared since the last query.
    new_since: Option<Instant>,
    reported_absent: bool,
}

impl<B: GithubBackend> Poller<B> {
    async fn run(&mut self, cancel: CancellationToken) -> Result<(), SourceError> {
        self.send(Change::Reset(Vec::new())).await?;
        let mut wanted = self.source.interest.wanted.clone();
        // The first poll is due at once and reads the current value.
        wanted.borrow_and_update();
        let mut arrivals = self.source.interest.arrivals.clone();
        arrivals.borrow_and_update();

        loop {
            let due = self.due();
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                changed = wanted.changed() => {
                    if changed.is_err() {
                        // The store is gone; nothing will ever be wanted again.
                        cancel.cancelled().await;
                        return Ok(());
                    }
                    let current = wanted.borrow_and_update().clone();
                    if self.new_since.is_none() && has_new(&current, &self.polled) {
                        self.new_since = Some(Instant::now());
                    }
                }
                // A viewer arrived: the next query is due on the watched
                // schedule, which `due` recomputes.
                arrived = arrivals.changed() => {
                    if arrived.is_err() {
                        cancel.cancelled().await;
                        return Ok(());
                    }
                }
                () = tokio::time::sleep_until(due) => {
                    let current = wanted.borrow().clone();
                    self.poll(&current).await?;
                }
            }
        }
    }

    fn watching(&self) -> bool {
        (self.source.interest.subscribers)() > 0
    }

    /// When the next query is due: the interval after the last one (longer
    /// with no viewer), or soon when something new appeared while someone
    /// watches.
    fn due(&self) -> Instant {
        let Some(last) = self.last_poll else {
            return Instant::now();
        };
        let watching = self.watching();
        let gap = if watching {
            self.gap
        } else {
            self.gap.max(IDLE_POLL)
        };
        let mut due = last + gap;
        if let (true, Some(since)) = (watching, self.new_since) {
            due = due.min((since + NEW_REF_DEBOUNCE).max(last + MIN_GAP));
        }
        due
    }

    async fn poll(&mut self, wanted: &PrWanted) -> Result<(), SourceError> {
        let span = tracing::info_span!(
            "macrod.monitor.github.poll",
            refs = wanted.refs.len(),
            branches = wanted.branches.len(),
            queries = tracing::field::Empty,
            prs = tracing::field::Empty,
            duration_ms = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let started = Instant::now();
        self.last_poll = Some(started);
        self.new_since = None;
        // Covered even when it fails: a failure is retried on the schedule,
        // not as soon as anything changes.
        self.polled = wanted.clone();
        let factor = rand::rng().random_range(1.0 - JITTER..=1.0 + JITTER);
        self.gap = self.source.every.mul_f64(factor);

        let branches = self.branches(wanted).instrument(span.clone()).await;
        self.send_checkouts().await?;
        let result = self
            .query(wanted, &branches, &span)
            .instrument(span.clone())
            .await;
        span.record(
            "duration_ms",
            u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        );
        match result {
            Ok(statuses) => {
                span.record("prs", statuses.len());
                span.record("outcome", "ok");
                self.reported_absent = false;
                let count = statuses.len();
                for status in statuses {
                    self.send(Change::Upsert(Fact::PrStatus(Box::new(status))))
                        .await?;
                }
                self.health(SourceState::Healthy, count, None).await
            }
            Err(GithubError::NotFound) => {
                span.record("outcome", "absent");
                // Look again later, as for a fresh start.
                self.gap = self.gap.max(DISCOVERY_RETRY);
                if self.reported_absent {
                    return Ok(());
                }
                self.reported_absent = true;
                self.health(SourceState::Absent, 0, Some("gh not found"))
                    .await
            }
            Err(GithubError::Failed(reason)) => {
                span.record("outcome", "failed");
                tracing::warn!(parent: &span, error = %reason, "github query failed");
                self.health(SourceState::Unhealthy, 0, Some("gh api failed"))
                    .await
            }
        }
    }

    /// Each branch candidate's repository, looked up once per directory.
    async fn branches(&mut self, wanted: &PrWanted) -> BTreeSet<(RepoName, String)> {
        let mut branches = BTreeSet::new();
        for BranchCandidate { cwd, branch } in &wanted.branches {
            if let Some(repo) = self.repo_of(cwd).await {
                branches.insert((repo, branch.clone()));
            }
        }
        branches
    }

    /// Runs the queries and parses them.
    async fn query(
        &self,
        wanted: &PrWanted,
        branches: &BTreeSet<(RepoName, String)>,
        span: &tracing::Span,
    ) -> Result<Vec<PrStatusFact>, GithubError> {
        let queries = queries(&wanted.refs, branches);
        span.record("queries", queries.len());
        let mut statuses: BTreeMap<PrRef, PrStatusFact> = BTreeMap::new();
        for query in queries {
            let body = self.source.backend.graphql(query.text.clone()).await?;
            let parsed = parse_response(&query, &body)?;
            for status in parsed {
                statuses.insert(status.pr.clone(), status);
            }
        }
        Ok(statuses.into_values().collect())
    }

    async fn repo_of(&mut self, cwd: &Path) -> Option<RepoName> {
        if let Some(repo) = self.origins.get(cwd) {
            return repo.clone();
        }
        let repo = self
            .source
            .backend
            .origin(cwd.to_owned())
            .await
            .as_deref()
            .and_then(repo_of_remote);
        self.origins.insert(cwd.to_owned(), repo.clone());
        repo
    }

    /// Reports each working directory resolved to a repository, once.
    async fn send_checkouts(&mut self) -> Result<(), SourceError> {
        let fresh: Vec<(PathBuf, RepoName)> = self
            .origins
            .iter()
            .filter_map(|(cwd, repo)| Some((cwd.clone(), repo.clone()?)))
            .filter(|(cwd, repo)| self.sent_checkouts.get(cwd) != Some(repo))
            .collect();
        for (cwd, repo) in fresh {
            self.sent_checkouts.insert(cwd.clone(), repo.clone());
            self.send(Change::Upsert(Fact::Checkout(CheckoutFact { cwd, repo })))
                .await?;
        }
        Ok(())
    }

    async fn health(
        &self,
        state: SourceState,
        items: usize,
        detail: Option<&str>,
    ) -> Result<(), SourceError> {
        let mut health = SourceHealth::starting(SourceKind::Github);
        health.state = state;
        health.items = u32::try_from(items).unwrap_or(u32::MAX);
        health.detail = detail.map(str::to_owned);
        health.last_event = Some(Utc::now());
        health.poll_every = Some(self.source.every);
        self.send(Change::Health(health)).await
    }

    async fn send(&self, change: Change) -> Result<(), SourceError> {
        self.out
            .send(Observation {
                source: SourceKind::Github,
                change,
            })
            .await
            .map_err(|_closed| SourceError::StoreClosed)
    }
}

/// Whether `current` names anything the last query did not cover.
fn has_new(current: &Arc<PrWanted>, polled: &PrWanted) -> bool {
    !current.refs.is_subset(&polled.refs) || !current.branches.is_subset(&polled.branches)
}
