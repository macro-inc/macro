use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{TimeZone, Utc};
use tokio::sync::{mpsc, watch};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::{
    Discovered, GitBackend, GitCli, GitError, GitSource, IDLE_GAP, LogLine, QUIET, RawCommit,
    RefRow, RepoPlace, RepoWanted, SETTLE, Schedule, gather, moves_refs,
};
use crate::domain::model::{LaneBase, Oid, RepoGraph, RepoId, RepoName, Timestamp};
use crate::domain::observation::{Change, Fact, GitWanted, Observation};
use crate::domain::source::{AgentSource as _, GitInterest};

// ---- schedule ----

#[test]
fn a_burst_of_ref_events_makes_one_gather_after_the_quiet() {
    let mut schedule = Schedule::default();
    let repo = Path::new("/r/.git");
    let start = Instant::now();
    for step in 0..50 {
        schedule.touch(repo, start + Duration::from_millis(step * 10));
    }
    let (due_repo, due) = schedule.next(true).expect("due");
    assert_eq!(due_repo, repo);
    // 300 ms after the last event (490 ms), within the 2 s settle.
    assert_eq!(due, start + Duration::from_millis(490) + QUIET);

    // Events that never stop still gather within the settle.
    let mut busy = Schedule::default();
    for step in 0..1_000 {
        busy.touch(repo, start + Duration::from_millis(step * 100));
    }
    assert_eq!(busy.next(true).map(|(_, at)| at), Some(start + SETTLE));
}

#[test]
fn a_slow_gather_holds_the_next_one_off_ten_times_as_long() {
    let mut schedule = Schedule::default();
    let repo = Path::new("/r/.git");
    let start = Instant::now();
    schedule.touch(repo, start);
    schedule.gathered(repo, start, Duration::from_millis(400), false);
    assert_eq!(schedule.next(true), None, "nothing changed since");

    schedule.touch(repo, start + Duration::from_millis(500));
    let (_, due) = schedule.next(true).expect("due");
    assert_eq!(
        due,
        start + Duration::from_millis(400) + Duration::from_secs(4)
    );

    // With nobody watching, at most every 15 s.
    let (_, idle) = schedule.next(false).expect("due");
    assert_eq!(idle, start + Duration::from_millis(400) + IDLE_GAP);
}

#[test]
fn only_ref_paths_wake_the_source() {
    for path in [
        "refs/heads/feat/x",
        "refs/heads/feat/x.lock",
        "refs/remotes/origin/main",
        "packed-refs",
        "HEAD",
        "FETCH_HEAD",
        "worktrees/wt",
        "worktrees/wt/HEAD",
        "logs/refs/remotes/origin/main",
    ] {
        assert!(moves_refs(Path::new(path)), "{path}");
    }
    for path in [
        "index",
        "index.lock",
        "worktrees/wt/index",
        "worktrees/wt/logs/HEAD",
        "objects/ab/cdef",
        "logs/HEAD",
        "COMMIT_EDITMSG",
    ] {
        assert!(!moves_refs(Path::new(path)), "{path}");
    }
}

// ---- the source, with a fake backend ----

fn oid(n: u64) -> Oid {
    Oid::parse(&format!("{n:040x}")).expect("an oid")
}

fn when() -> Timestamp {
    Utc::now()
}

#[derive(Clone, Default)]
struct Fake {
    /// Directories that are checkouts, by their common directory.
    checkouts: BTreeMap<PathBuf, PathBuf>,
    discovered: Arc<Mutex<Vec<PathBuf>>>,
    gathers: Arc<Mutex<u32>>,
}

impl GitBackend for Fake {
    async fn discover(&self, cwd: PathBuf) -> Option<Discovered> {
        self.discovered.lock().expect("lock").push(cwd.clone());
        self.checkouts.get(&cwd).map(|common| Discovered {
            common_dir: common.clone(),
        })
    }

    async fn refs(&self, _repo: PathBuf) -> Result<Vec<RefRow>, GitError> {
        *self.gathers.lock().expect("lock") += 1;
        Ok(vec![
            RefRow {
                name: String::from("refs/remotes/origin/main"),
                oid: oid(1),
                at: Some(when()),
                worktree: None,
                symref: None,
            },
            RefRow {
                name: String::from("refs/heads/feat"),
                oid: oid(2),
                at: Some(when()),
                worktree: Some(PathBuf::from("/wt/feat")),
                symref: None,
            },
        ])
    }

    async fn ahead_behind(
        &self,
        _repo: PathBuf,
        _trunk: String,
        _refs: Vec<String>,
    ) -> Result<BTreeMap<String, (u32, u32)>, GitError> {
        Ok(BTreeMap::from([(String::from("refs/heads/feat"), (1, 0))]))
    }

    async fn trunk_log(
        &self,
        _repo: PathBuf,
        _trunk: String,
        _max: usize,
    ) -> Result<Vec<RawCommit>, GitError> {
        Ok(Vec::new())
    }

    async fn lane_log(
        &self,
        _repo: PathBuf,
        _trunk: String,
        _tips: Vec<Oid>,
        _max: usize,
    ) -> Result<Vec<LogLine>, GitError> {
        let commit = |n, parents: Vec<Oid>| RawCommit {
            oid: oid(n),
            parents,
            at: Utc
                .with_ymd_and_hms(2030, 1, 2, 3, 4, 5)
                .single()
                .expect("a time"),
            author: String::from("t"),
            subject: String::from("s"),
        };
        Ok(vec![
            LogLine {
                boundary: false,
                commit: commit(2, vec![oid(1)]),
            },
            LogLine {
                boundary: true,
                commit: commit(1, Vec::new()),
            },
        ])
    }

    async fn merge_base(
        &self,
        _repo: PathBuf,
        _trunk: String,
        _tip: Oid,
    ) -> Option<(Oid, Timestamp)> {
        None
    }

    async fn origin(&self, _repo: PathBuf) -> Option<String> {
        Some(String::from("https://github.com/example-org/widgets.git"))
    }

    async fn modified(&self, _path: PathBuf) -> Option<Timestamp> {
        None
    }
}

struct Running {
    wanted: watch::Sender<Arc<GitWanted>>,
    out: mpsc::Receiver<Observation>,
    cancel: CancellationToken,
}

fn start(backend: impl GitBackend) -> Running {
    let (wanted, receiver) = watch::channel(Arc::new(GitWanted::default()));
    let interest = GitInterest {
        wanted: receiver,
        subscribers: Arc::new(|| 1),
    };
    let (sender, out) = mpsc::channel(64);
    let cancel = CancellationToken::new();
    let source = Box::new(GitSource::new(backend, interest));
    tokio::spawn(source.run(sender, cancel.clone()));
    Running {
        wanted,
        out,
        cancel,
    }
}

fn wanting(cwds: &[&str]) -> Arc<GitWanted> {
    Arc::new(GitWanted {
        cwds: cwds.iter().map(|cwd| (PathBuf::from(cwd), true)).collect(),
        pr_branches: BTreeMap::new(),
    })
}

/// The next graph sent, skipping health.
async fn next_graph(out: &mut mpsc::Receiver<Observation>) -> RepoGraph {
    loop {
        let observation = out.recv().await.expect("an observation");
        if let Change::Upsert(Fact::RepoGraph(graph)) = observation.change {
            return *graph;
        }
    }
}

/// Every graph sent until the channel is idle for `wait`.
async fn graphs_within(out: &mut mpsc::Receiver<Observation>, wait: Duration) -> usize {
    let mut graphs = 0;
    while let Ok(Some(observation)) = tokio::time::timeout(wait, out.recv()).await {
        if matches!(observation.change, Change::Upsert(Fact::RepoGraph(_))) {
            graphs += 1;
        }
    }
    graphs
}

#[tokio::test(start_paused = true)]
async fn a_new_agent_directory_is_discovered_gathered_and_sent_once() {
    let fake = Fake {
        checkouts: BTreeMap::from([
            (
                PathBuf::from("/wt/feat/sub"),
                PathBuf::from("/nowhere/repo/.git"),
            ),
            (
                PathBuf::from("/wt/feat"),
                PathBuf::from("/nowhere/repo/.git"),
            ),
        ]),
        ..Fake::default()
    };
    let mut running = start(fake.clone());
    running.wanted.send_replace(wanting(&["/wt/feat/sub"]));
    let graph = next_graph(&mut running.out).await;
    assert_eq!(graph.name, "example-org/widgets");
    assert_eq!(graph.remote, RepoName::parse("example-org/widgets"));
    assert_eq!(graph.lanes.len(), 1);
    assert_eq!(graph.lanes[0].branch, "feat");
    assert_eq!(
        graph.lanes[0].base,
        LaneBase::Trunk {
            oid: oid(1),
            at: Utc
                .with_ymd_and_hms(2030, 1, 2, 3, 4, 5)
                .single()
                .expect("a time"),
        }
    );

    // A second directory in the same repository regathers, but the graph is
    // unchanged, so nothing is sent.
    running
        .wanted
        .send_replace(wanting(&["/wt/feat/sub", "/wt/feat"]));
    assert_eq!(
        graphs_within(&mut running.out, Duration::from_secs(30)).await,
        0
    );
    assert_eq!(*fake.gathers.lock().expect("lock"), 2);
    assert_eq!(
        *fake.discovered.lock().expect("lock"),
        [PathBuf::from("/wt/feat/sub"), PathBuf::from("/wt/feat")]
    );
    running.cancel.cancel();
}

#[tokio::test(start_paused = true)]
async fn a_directory_that_is_no_checkout_is_asked_again_after_ten_minutes() {
    let fake = Fake::default();
    let mut running = start(fake.clone());
    running.wanted.send_replace(wanting(&["/home/someone"]));
    graphs_within(&mut running.out, Duration::from_secs(1)).await;
    running
        .wanted
        .send_replace(wanting(&["/home/someone", "/x"]));
    graphs_within(&mut running.out, Duration::from_secs(1)).await;
    let asked = |fake: &Fake| {
        fake.discovered
            .lock()
            .expect("lock")
            .iter()
            .filter(|cwd| cwd.as_path() == Path::new("/home/someone"))
            .count()
    };
    assert_eq!(asked(&fake), 1);

    tokio::time::advance(Duration::from_secs(11 * 60)).await;
    running.wanted.send_replace(wanting(&["/home/someone"]));
    graphs_within(&mut running.out, Duration::from_secs(1)).await;
    assert_eq!(asked(&fake), 2);
    running.cancel.cancel();
}

// ---- real git in temporary repositories ----

/// Runs git in `dir` with a fixed identity and clock; `None` when git is missing.
fn git(dir: &Path, args: &[&str], date: u32) -> Option<String> {
    let stamp = format!("2030-01-02T{:02}:{:02}:00Z", 10 + date / 60, date % 60);
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .env("GIT_AUTHOR_DATE", &stamp)
        .env("GIT_COMMITTER_DATE", &stamp)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .ok()?;
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn commit(dir: &Path, subject: &str, date: u32) {
    git(dir, &["commit", "--allow-empty", "-q", "-m", subject], date);
}

fn has_git() -> bool {
    let found = Command::new("git").arg("--version").output().is_ok();
    if !found {
        eprintln!("skipped: git is not installed");
    }
    found
}

/// A bare origin and a clone with `main` pushed, then three branches: `feat`
/// (two commits) checked out in a second worktree, `stacked` on `feat`, and
/// `done`, whose squash landed on `main` as `(#12)`.
fn fixture(root: &Path) -> PathBuf {
    let origin = root.join("origin.git");
    let work = root.join("work");
    std::fs::create_dir_all(&work).expect("mkdir");
    git(
        root,
        &["init", "-q", "--bare", "-b", "main", "origin.git"],
        0,
    );
    git(&work, &["init", "-q", "-b", "main"], 0);
    commit(&work, "first", 1);
    git(
        &work,
        &["remote", "add", "origin", &origin.to_string_lossy()],
        1,
    );
    git(&work, &["push", "-q", "origin", "main"], 1);

    git(&work, &["branch", "feat"], 2);
    git(&work, &["branch", "done"], 2);
    git(&work, &["worktree", "add", "-q", "../wt", "feat"], 2);
    let wt = root.join("wt");
    commit(&wt, "feat: one", 3);
    commit(&wt, "feat: two", 4);
    git(&wt, &["branch", "stacked"], 4);
    git(&wt, &["checkout", "-q", "stacked"], 4);
    commit(&wt, "feat: on top", 5);
    git(&wt, &["checkout", "-q", "feat"], 5);
    git(&wt, &["push", "-q", "origin", "feat"], 5);

    git(&work, &["checkout", "-q", "done"], 6);
    commit(&work, "fix: thing", 6);
    git(&work, &["checkout", "-q", "main"], 7);
    commit(&work, "fix: thing (#12)", 8);
    git(&work, &["push", "-q", "origin", "main"], 8);
    git(&work, &["fetch", "-q", "origin"], 8);
    commit(&work, "local only", 9);
    work
}

fn place(common: &Path) -> RepoPlace {
    RepoPlace {
        id: RepoId::of_common_dir(common),
        common_dir: common.to_owned(),
        name: String::from("work"),
        remote: None,
    }
}

fn fixed_now() -> Timestamp {
    Utc.with_ymd_and_hms(2030, 1, 2, 12, 0, 0)
        .single()
        .expect("a time")
}

#[tokio::test]
async fn a_real_repository_maps_its_trunk_worktree_stack_and_landing() {
    if !has_git() {
        return;
    }
    let root = tempfile::tempdir().expect("tempdir");
    let work = fixture(root.path());
    let cli = GitCli::new(vec![PathBuf::from("git")]);
    let found = cli
        .discover(root.path().join("wt"))
        .await
        .expect("a checkout");
    let common = std::fs::canonicalize(work.join(".git")).expect("canonical");
    assert_eq!(found.common_dir, common);

    let wanted = RepoWanted {
        cwds: BTreeMap::from([(root.path().join("wt"), true)]),
        ..RepoWanted::default()
    };
    let graph = gather(&cli, &place(&common), &wanted, fixed_now())
        .await
        .expect("a gather")
        .expect("a trunk");
    assert_eq!(graph.trunk.name, "origin/main");
    let subjects: Vec<&str> = graph
        .trunk
        .commits
        .iter()
        .map(|c| c.subject.as_str())
        .collect();
    assert_eq!(subjects, ["fix: thing (#12)", "first"]);
    assert_eq!(graph.trunk.commits[0].pr, Some(12));
    let local = graph.trunk.local.clone().expect("local main");
    assert_eq!((local.ahead, local.behind), (1, 0));
    assert!(graph.trunk.fetched_at.is_some());
    assert_eq!(graph.trunk.worktrees, [work.clone()]);

    let lanes: Vec<(&str, u32, u32, usize)> = graph
        .lanes
        .iter()
        .map(|lane| {
            (
                lane.branch.as_str(),
                lane.ahead,
                lane.behind,
                lane.commits.len(),
            )
        })
        .collect();
    // The agent's lane first, then by newest commit.
    assert_eq!(
        lanes,
        [("feat", 2, 1, 2), ("done", 1, 1, 1), ("stacked", 3, 1, 1)]
    );
    let feat = &graph.lanes[0];
    assert_eq!(
        feat.worktree.as_deref(),
        Some(root.path().join("wt").as_path())
    );
    assert_eq!(feat.pushed.as_ref(), feat.tip().map(|tip| &tip.oid));
    assert!(matches!(feat.base, LaneBase::Trunk { .. }));
    assert_eq!(
        graph.lanes[2].base,
        LaneBase::Lane {
            branch: String::from("feat"),
            oid: feat.tip().expect("a tip").oid.clone()
        }
    );
    assert_eq!(graph.lanes[2].pushed, None);
}

#[tokio::test]
async fn packed_refs_and_a_repository_without_a_remote_still_map() {
    if !has_git() {
        return;
    }
    let root = tempfile::tempdir().expect("tempdir");
    let work = fixture(root.path());
    git(&work, &["pack-refs", "--all"], 10);
    let cli = GitCli::new(vec![PathBuf::from("git")]);
    let common = std::fs::canonicalize(work.join(".git")).expect("canonical");
    let graph = gather(&cli, &place(&common), &RepoWanted::default(), fixed_now())
        .await
        .expect("a gather")
        .expect("a trunk");
    assert_eq!(graph.lanes.len(), 3);

    let lone = root.path().join("lone");
    std::fs::create_dir_all(&lone).expect("mkdir");
    git(&lone, &["init", "-q", "-b", "main"], 0);
    commit(&lone, "first", 1);
    git(&lone, &["checkout", "-q", "-b", "side"], 1);
    commit(&lone, "side", 2);
    let common = std::fs::canonicalize(lone.join(".git")).expect("canonical");
    let graph = gather(&cli, &place(&common), &RepoWanted::default(), fixed_now())
        .await
        .expect("a gather")
        .expect("a trunk");
    assert_eq!(graph.trunk.name, "main");
    assert_eq!(graph.trunk.local, None);
    assert_eq!(graph.trunk.fetched_at, None);
    assert_eq!(graph.lanes.len(), 1);
    assert_eq!(graph.lanes[0].branch, "side");
}

#[tokio::test]
async fn a_commit_reaches_the_store_within_three_seconds_through_the_watcher() {
    if !has_git() {
        return;
    }
    let root = tempfile::tempdir().expect("tempdir");
    fixture(root.path());
    let wt = root.path().join("wt");
    let mut running = start(GitCli::new(vec![PathBuf::from("git")]));
    running
        .wanted
        .send_replace(wanting(&[&wt.to_string_lossy()]));
    let first = tokio::time::timeout(Duration::from_secs(10), next_graph(&mut running.out))
        .await
        .expect("a first graph");
    assert_eq!(first.lanes[0].commits.len(), 2);

    commit(&wt, "feat: three", 20);
    let next = tokio::time::timeout(Duration::from_secs(3), next_graph(&mut running.out))
        .await
        .expect("the commit within 3 s");
    assert_eq!(next.lanes[0].commits.len(), 3);
    assert_eq!(next.lanes[0].commits[0].subject, "feat: three");
    running.cancel.cancel();
}
