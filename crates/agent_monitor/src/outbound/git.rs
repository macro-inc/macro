//! Local git repositories: the trunk, the branches agents work on, and their
//! commits, for the CHANGES page.
//!
//! The store publishes what to map ([`GitWanted`]: agent working directories
//! and pull request head branches). Each directory resolves once to its
//! repository's common directory, so every worktree of a clone is one
//! repository. A repository is regathered when its refs change on disk
//! (inotify through [`Watch`]: loose refs, `packed-refs`, worktree `HEAD`s,
//! the remote trunk's reflog), when what is wanted in it changes, and after
//! a watcher rescan. There is no timer.
//!
//! Cost limits: a regather waits for [`QUIET`] of quiet (at most [`SETTLE`]
//! after the first event), and the next one for a repository is no sooner
//! than `max(1 s, 10 × the last gather's duration)` (15 s with no viewer),
//! so the source stays under a tenth of a core; repositories gather one at a
//! time; an unchanged graph is not sent. It never fetches, never takes a git
//! lock, never runs `git status` and never writes to a repository.

mod assemble;
mod backend;
mod gather;
mod parse;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub use assemble::{
    Assembled, Candidate, Gathered, Picked, RECENT, Ranked, RepoWanted, TrunkRef, assemble,
    candidates, choose_trunk, rank,
};
pub use backend::{Discovered, GitBackend, GitCli, GitError};
pub use gather::{MAX_REPO_COMMITS, RepoPlace, gather};
pub use parse::{LogLine, RawCommit, RefRow};

use crate::domain::model::{RepoGraph, RepoId, SourceHealth, SourceKind, SourceState, Timestamp};
use crate::domain::observation::{Change, Fact, FactKey, GitWanted, Observation};
use crate::domain::source::{AgentSource, GitInterest, SourceError};
use crate::outbound::github::repo_of_remote;
use crate::outbound::watch::{Changes, Watch};

/// Repositories mapped at most; the rest are counted in the health line.
pub const MAX_REPOS: usize = 8;

/// A regather waits for this much quiet after a ref event…
pub const QUIET: Duration = Duration::from_millis(300);

/// …but no longer than this after the first one, so a long rebase still
/// shows progress.
pub const SETTLE: Duration = Duration::from_secs(2);

/// Never two gathers of one repository closer than this.
pub const MIN_GAP: Duration = Duration::from_secs(1);

/// A gather that took `d` holds the next one off for this many `d`s.
pub const BUDGET_FACTOR: u32 = 10;

/// With no viewer subscribed, a repository is gathered at most this often.
pub const IDLE_GAP: Duration = Duration::from_secs(15);

/// A directory that was not a checkout is looked at again after this.
pub const RECHECK_NON_CHECKOUT: Duration = Duration::from_secs(10 * 60);

/// After a failed gather, wait this long before the next.
const FAILURE_GAP: Duration = Duration::from_secs(30);

/// When each repository may next gather.
#[derive(Clone, Debug, Default)]
pub struct Schedule {
    repos: BTreeMap<PathBuf, Timing>,
}

#[derive(Clone, Copy, Debug, Default)]
struct Timing {
    /// The first and the latest event since the last gather.
    dirty: Option<(Instant, Instant)>,
    /// When the last gather started, and how long it took.
    last: Option<(Instant, Duration)>,
    /// The last gather failed.
    failed: bool,
}

impl Schedule {
    /// Records a change in `repo` at `now`.
    pub fn touch(&mut self, repo: &Path, now: Instant) {
        let timing = self.repos.entry(repo.to_owned()).or_default();
        timing.dirty = Some(match timing.dirty {
            Some((first, _)) => (first, now),
            None => (now, now),
        });
    }

    /// Forgets a repository.
    pub fn drop_repo(&mut self, repo: &Path) {
        self.repos.remove(repo);
    }

    /// Records a gather of `repo` that started at `started` and took `took`.
    pub fn gathered(&mut self, repo: &Path, started: Instant, took: Duration, failed: bool) {
        let timing = self.repos.entry(repo.to_owned()).or_default();
        // Events during the gather leave it dirty: they may not be in it.
        if timing.dirty.is_some_and(|(_, latest)| latest <= started) {
            timing.dirty = None;
        }
        timing.last = Some((started, took));
        timing.failed = failed;
    }

    /// The repository due first, and when; `watching` is whether a viewer
    /// is subscribed.
    pub fn next(&self, watching: bool) -> Option<(PathBuf, Instant)> {
        self.repos
            .iter()
            .filter_map(|(repo, timing)| Some((repo.clone(), due(timing, watching)?)))
            .min_by_key(|(_, at)| *at)
    }
}

fn due(timing: &Timing, watching: bool) -> Option<Instant> {
    let (first, latest) = timing.dirty?;
    let settled = (latest + QUIET).min(first + SETTLE);
    let Some((started, took)) = timing.last else {
        return Some(settled);
    };
    let mut gap = MIN_GAP.max(took * BUDGET_FACTOR);
    if !watching {
        gap = gap.max(IDLE_GAP);
    }
    if timing.failed {
        gap = gap.max(FAILURE_GAP);
    }
    Some(settled.max(started + took + gap))
}

/// Whether a path changed under a common directory can move a ref:
/// loose refs, `packed-refs`, `HEAD`, `FETCH_HEAD` (a fetch, which the
/// header ages from), a worktree's `HEAD` or its directory,
/// the remote's reflogs, or the reftable. `index` writes from `git status`
/// and other noise are dropped here.
pub fn moves_refs(relative: &Path) -> bool {
    let parts: Vec<&str> = relative
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect();
    matches!(
        parts.as_slice(),
        ["refs", "heads", ..]
            | ["refs", "remotes", "origin", ..]
            | ["packed-refs" | "packed-refs.lock" | "HEAD" | "FETCH_HEAD"]
            | ["worktrees", _]
            | ["worktrees", _, "HEAD"]
            | ["logs", "refs", "remotes", "origin", ..]
            | ["reftable", ..]
    )
}

/// Whether a changed path adds or removes a worktree, so watches must follow.
fn worktree_moved(relative: &Path) -> bool {
    let parts: Vec<&str> = relative
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect();
    matches!(parts.as_slice(), ["worktrees", _])
}

/// The directories watched for one repository.
fn watch_dirs(common: &Path) -> Vec<(PathBuf, bool)> {
    let mut dirs = vec![(common.to_owned(), false)];
    if common.join("reftable").is_dir() {
        dirs.push((common.join("reftable"), true));
    } else {
        dirs.push((common.join("refs/heads"), true));
        dirs.push((common.join("refs/remotes/origin"), true));
    }
    dirs.push((common.join("logs/refs/remotes/origin"), false));
    let worktrees = common.join("worktrees");
    if let Ok(entries) = std::fs::read_dir(&worktrees) {
        dirs.push((worktrees, false));
        dirs.extend(
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .map(|path| (path, false)),
        );
    }
    dirs.into_iter().filter(|(dir, _)| dir.is_dir()).collect()
}

/// A repository's display name: the directory's, as a person calls it.
fn dir_name(common: &Path) -> String {
    let named = if common.file_name().is_some_and(|name| name == ".git") {
        common.parent().unwrap_or(common)
    } else {
        common
    };
    named
        .file_name()
        .map(|name| name.to_string_lossy().trim_end_matches(".git").to_owned())
        .unwrap_or_else(|| common.display().to_string())
}

/// Maps the repositories agents work in.
#[derive(Clone)]
pub struct GitSource<B = GitCli> {
    backend: B,
    interest: GitInterest,
}

impl<B: GitBackend> GitSource<B> {
    /// Reads repositories through `backend`, mapping what `interest` names.
    pub fn new(backend: B, interest: GitInterest) -> Self {
        Self { backend, interest }
    }
}

#[async_trait]
impl<B: GitBackend> AgentSource for GitSource<B> {
    fn kind(&self) -> SourceKind {
        SourceKind::Git
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        let watch = Watch::new()
            .map_err(|error| SourceError::Internal(rootcause::Report::new(error).into_dynamic()))?;
        let mut mapper = Mapper {
            backend: self.backend,
            interest: self.interest,
            out,
            watch,
            watched: BTreeSet::new(),
            discovered: HashMap::new(),
            repos: BTreeMap::new(),
            schedule: Schedule::default(),
            wanted: Arc::new(GitWanted::default()),
            hidden_repos: 0,
            gathers: 0,
            last_ms: None,
            failure: None,
            git_missing: false,
        };
        mapper.run(cancel).await
    }
}

/// One repository being mapped.
struct Repo {
    place: RepoPlace,
    wanted: RepoWanted,
    sent: Option<RepoGraph>,
}

struct Mapper<B> {
    backend: B,
    interest: GitInterest,
    out: mpsc::Sender<Observation>,
    watch: Watch,
    watched: BTreeSet<PathBuf>,
    /// Each working directory's common directory, once looked up (`None`:
    /// not a checkout, looked up again after [`RECHECK_NON_CHECKOUT`]).
    discovered: HashMap<PathBuf, (Option<PathBuf>, Instant)>,
    repos: BTreeMap<PathBuf, Repo>,
    schedule: Schedule,
    wanted: Arc<GitWanted>,
    hidden_repos: usize,
    gathers: u64,
    last_ms: Option<u64>,
    failure: Option<String>,
    git_missing: bool,
}

impl<B: GitBackend> Mapper<B> {
    async fn run(&mut self, cancel: CancellationToken) -> Result<(), SourceError> {
        self.send(Change::Reset(Vec::new())).await?;
        self.health().await?;
        let mut wanted = self.interest.wanted.clone();
        let current = wanted.borrow_and_update().clone();
        self.sync(current).await?;

        loop {
            let watching = (self.interest.subscribers)() > 0;
            let next = self.schedule.next(watching);
            let sleep_until = next
                .as_ref()
                .map_or_else(|| Instant::now() + Duration::from_secs(3600), |(_, at)| *at);
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                changed = wanted.changed() => {
                    if changed.is_err() {
                        cancel.cancelled().await;
                        return Ok(());
                    }
                    let current = wanted.borrow_and_update().clone();
                    self.sync(current).await?;
                }
                changes = self.watch.next() => {
                    let Some(changes) = changes else {
                        return Err(SourceError::Internal(rootcause::report!("the ref watcher stopped").into_dynamic()));
                    };
                    self.changed(changes);
                }
                () = tokio::time::sleep_until(sleep_until), if next.is_some() => {
                    if let Some((repo, _)) = next {
                        self.gather(&repo).await?;
                    }
                }
            }
        }
    }

    /// Maps what `wanted` names: resolves new directories, adds and drops
    /// repositories, and regathers those whose wanted set changed.
    async fn sync(&mut self, wanted: Arc<GitWanted>) -> Result<(), SourceError> {
        self.wanted = wanted.clone();
        let now = Instant::now();
        // Directories to repositories.
        let mut by_repo: BTreeMap<PathBuf, BTreeMap<PathBuf, bool>> = BTreeMap::new();
        for (cwd, live) in &wanted.cwds {
            let known = match self.discovered.get(cwd) {
                Some((Some(common), _)) => Some(common.clone()),
                Some((None, checked)) if now.duration_since(*checked) < RECHECK_NON_CHECKOUT => {
                    None
                }
                _ => {
                    let found = self
                        .backend
                        .discover(cwd.clone())
                        .await
                        .map(|found| found.common_dir);
                    self.discovered.insert(cwd.clone(), (found.clone(), now));
                    found
                }
            };
            if let Some(common) = known {
                by_repo
                    .entry(common)
                    .or_default()
                    .insert(cwd.clone(), *live);
            }
        }

        // The busiest repositories: live agents, then the newest commit.
        let mut ranked: Vec<(PathBuf, BTreeMap<PathBuf, bool>)> = by_repo.into_iter().collect();
        ranked.sort_by_key(|(common, cwds)| {
            let live = cwds.values().filter(|live| **live).count();
            let newest = self
                .repos
                .get(common)
                .and_then(|repo| repo.sent.as_ref())
                .and_then(newest_commit);
            (std::cmp::Reverse(live), std::cmp::Reverse(newest))
        });
        self.hidden_repos = ranked.len().saturating_sub(MAX_REPOS);
        ranked.truncate(MAX_REPOS);
        let keep: BTreeSet<PathBuf> = ranked.iter().map(|(common, _)| common.clone()).collect();

        let gone: Vec<PathBuf> = self
            .repos
            .keys()
            .filter(|common| !keep.contains(*common))
            .cloned()
            .collect();
        for common in gone {
            self.drop_repo(&common).await?;
        }

        for (common, cwds) in ranked {
            if !self.repos.contains_key(&common) {
                let place = self.place(&common).await;
                self.repos.insert(
                    common.clone(),
                    Repo {
                        place,
                        wanted: RepoWanted::default(),
                        sent: None,
                    },
                );
                self.watch_repo(&common);
            }
            let Some(repo) = self.repos.get_mut(&common) else {
                continue;
            };
            let pr_branches = repo
                .place
                .remote
                .as_ref()
                .and_then(|remote| wanted.pr_branches.get(remote))
                .cloned()
                .unwrap_or_default();
            let next = RepoWanted { cwds, pr_branches };
            if repo.wanted != next || repo.sent.is_none() {
                repo.wanted = next;
                self.schedule.touch(&common, now);
            }
        }
        Ok(())
    }

    async fn place(&self, common: &Path) -> RepoPlace {
        let remote = self
            .backend
            .origin(common.to_owned())
            .await
            .as_deref()
            .and_then(repo_of_remote);
        RepoPlace {
            id: RepoId::of_common_dir(common),
            common_dir: common.to_owned(),
            name: remote
                .as_ref()
                .map_or_else(|| dir_name(common), |remote| remote.as_str().to_owned()),
            remote,
        }
    }

    fn watch_repo(&mut self, common: &Path) {
        for (dir, recursive) in watch_dirs(common) {
            if self.watched.contains(&dir) {
                continue;
            }
            match self.watch.add(&dir, recursive) {
                Ok(()) => {
                    self.watched.insert(dir);
                }
                Err(error) => tracing::debug!(error = %error, "could not watch a ref directory"),
            }
        }
    }

    async fn drop_repo(&mut self, common: &Path) -> Result<(), SourceError> {
        let watched: Vec<PathBuf> = self
            .watched
            .iter()
            .filter(|dir| dir.starts_with(common))
            .cloned()
            .collect();
        for dir in watched {
            // A deleted directory's watch is already gone.
            let _ = self.watch.remove(&dir);
            self.watched.remove(&dir);
        }
        self.schedule.drop_repo(common);
        if let Some(repo) = self.repos.remove(common)
            && repo.sent.is_some()
        {
            self.send(Change::Remove(FactKey::Repo(repo.place.id)))
                .await?;
        }
        Ok(())
    }

    /// Marks the repositories whose refs moved.
    fn changed(&mut self, changes: Changes) {
        let now = Instant::now();
        if changes.rescan {
            let all: Vec<PathBuf> = self.repos.keys().cloned().collect();
            for common in all {
                self.watch_repo(&common);
                self.schedule.touch(&common, now);
            }
            return;
        }
        let mut rewatch = BTreeSet::new();
        for path in &changes.paths {
            let Some(common) = self
                .repos
                .keys()
                .filter(|common| path.starts_with(common))
                .max_by_key(|common| common.components().count())
                .cloned()
            else {
                continue;
            };
            let Ok(relative) = path.strip_prefix(&common) else {
                continue;
            };
            if moves_refs(relative) {
                self.schedule.touch(&common, now);
            }
            if worktree_moved(relative) {
                rewatch.insert(common);
            }
        }
        for common in rewatch {
            // Removed worktrees' watches went with their directories.
            self.watched.retain(|dir| dir.exists());
            self.watch_repo(&common);
        }
    }

    async fn gather(&mut self, common: &Path) -> Result<(), SourceError> {
        let Some(repo) = self.repos.get(common) else {
            self.schedule.drop_repo(common);
            return Ok(());
        };
        let span = tracing::debug_span!(
            "macrod.monitor.git.gather",
            lanes = tracing::field::Empty,
            commits = tracing::field::Empty,
            duration_ms = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let started = Instant::now();
        let result = gather(&self.backend, &repo.place, &repo.wanted, Utc::now()).await;
        let took = started.elapsed();
        let ms = u64::try_from(took.as_millis()).unwrap_or(u64::MAX);
        span.record("duration_ms", ms);
        self.schedule
            .gathered(common, started, took, result.is_err());
        self.gathers += 1;
        self.last_ms = Some(ms);

        match result {
            Ok(graph) => {
                self.failure = None;
                self.git_missing = false;
                span.record("outcome", "ok");
                if let Some(graph) = &graph {
                    span.record("lanes", graph.lanes.len());
                    let commits: usize = graph.lanes.iter().map(|lane| lane.commits.len()).sum();
                    span.record("commits", commits + graph.trunk.commits.len());
                }
                self.publish(common, graph).await?;
            }
            Err(GitError::NotFound) => {
                span.record("outcome", "absent");
                self.git_missing = true;
            }
            Err(GitError::Failed(reason)) => {
                span.record("outcome", "failed");
                tracing::warn!(parent: &span, error = %reason, "git gather failed");
                self.failure = Some(String::from("git failed"));
            }
        }
        self.health().await
    }

    /// Sends a repository's graph when it differs from the last one sent.
    async fn publish(
        &mut self,
        common: &Path,
        graph: Option<RepoGraph>,
    ) -> Result<(), SourceError> {
        let Some(repo) = self.repos.get_mut(common) else {
            return Ok(());
        };
        if repo.sent == graph {
            return Ok(());
        }
        let change = match &graph {
            Some(graph) => Change::Upsert(Fact::RepoGraph(Box::new(graph.clone()))),
            None => Change::Remove(FactKey::Repo(repo.place.id.clone())),
        };
        repo.sent = graph;
        self.send(change).await
    }

    async fn health(&self) -> Result<(), SourceError> {
        let mut health = SourceHealth::starting(SourceKind::Git);
        let lanes: usize = self
            .repos
            .values()
            .filter_map(|repo| repo.sent.as_ref())
            .map(|graph| graph.lanes.len())
            .sum();
        health.items = u32::try_from(self.repos.len()).unwrap_or(u32::MAX);
        health.state = if self.git_missing {
            SourceState::Absent
        } else if self.failure.is_some() {
            SourceState::Unhealthy
        } else if self.gathers == 0 {
            SourceState::Starting
        } else {
            SourceState::Healthy
        };
        let mut detail = format!(
            "{} repos · {lanes} lanes · {} gathers",
            self.repos.len(),
            self.gathers
        );
        if let Some(ms) = self.last_ms {
            detail.push_str(&format!(" · last {ms} ms"));
        }
        if self.hidden_repos > 0 {
            detail.push_str(&format!(" · {} more repos", self.hidden_repos));
        }
        if self.git_missing {
            detail = String::from("git not found");
        } else if let Some(failure) = &self.failure {
            detail = format!("{failure} · {detail}");
        }
        health.detail = Some(detail);
        health.last_event = Some(Utc::now());
        self.send(Change::Health(health)).await
    }

    async fn send(&self, change: Change) -> Result<(), SourceError> {
        self.out
            .send(Observation {
                source: SourceKind::Git,
                change,
            })
            .await
            .map_err(|_closed| SourceError::StoreClosed)
    }
}

/// The newest commit time in a graph.
fn newest_commit(graph: &RepoGraph) -> Option<Timestamp> {
    graph
        .lanes
        .iter()
        .filter_map(|lane| lane.tip().map(|tip| tip.at))
        .chain(graph.trunk.commits.first().map(|commit| commit.at))
        .max()
}
