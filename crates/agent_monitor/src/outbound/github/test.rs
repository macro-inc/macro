use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::DateTime;
use tokio::sync::watch;

use super::*;
use crate::domain::model::{CiState, Mergeable, PrState, ReviewState, Timestamp};
use crate::outbound::test_support::fixtures;

fn repo(name: &str) -> RepoName {
    RepoName::parse(name).expect("a repo")
}

fn pr(name: &str, number: u32) -> PrRef {
    PrRef {
        repo: repo(name),
        number,
    }
}

fn at(text: &str) -> Timestamp {
    DateTime::parse_from_rfc3339(text)
        .expect("timestamp")
        .with_timezone(&Utc)
}

fn fixture_query() -> PrQuery {
    let refs = [
        pr("example-org/widgets", 42),
        pr("example-org/widgets", 41),
        pr("example-org/gadgets", 7),
    ]
    .into_iter()
    .collect();
    let branches = [(repo("example-org/widgets"), String::from("feat/codex"))]
        .into_iter()
        .collect();
    let mut queries = queries(&refs, &branches);
    assert_eq!(queries.len(), 1);
    queries.remove(0)
}

#[test]
fn one_query_asks_every_repository_for_its_numbers_and_branches() {
    let query = fixture_query();
    assert_eq!(
        query.repos,
        vec![
            RepoLookups {
                alias: String::from("r0"),
                repo: repo("example-org/gadgets"),
                items: vec![(String::from("p0"), Lookup::Number(7))],
            },
            RepoLookups {
                alias: String::from("r1"),
                repo: repo("example-org/widgets"),
                items: vec![
                    (String::from("p0"), Lookup::Number(41)),
                    (String::from("p1"), Lookup::Number(42)),
                    (
                        String::from("b2"),
                        Lookup::Branch(String::from("feat/codex"))
                    ),
                ],
            },
        ]
    );
    assert!(
        query
            .text
            .contains("r1: repository(owner: \"example-org\", name: \"widgets\")")
    );
    assert!(
        query
            .text
            .contains("b2: pullRequests(headRefName: \"feat/codex\"")
    );
    assert!(query.text.contains("context(name: \"CI gate\")"));
}

#[test]
fn a_branch_with_quotes_is_escaped_and_big_sets_split_into_several_queries() {
    let branches = [(repo("example-org/widgets"), String::from("odd\"name"))]
        .into_iter()
        .collect();
    let query = &queries(&BTreeSet::new(), &branches)[0];
    assert!(query.text.contains(r#"headRefName: "odd\"name""#));

    let refs: BTreeSet<PrRef> = (1..=250).map(|n| pr("example-org/widgets", n)).collect();
    let split = queries(&refs, &BTreeSet::new());
    assert_eq!(split.len(), 3);
    let asked: usize = split
        .iter()
        .flat_map(|query| &query.repos)
        .map(|repo| repo.items.len())
        .sum();
    assert_eq!(asked, 250);
    assert!(queries(&BTreeSet::new(), &BTreeSet::new()).is_empty());
}

#[test]
fn an_answer_parses_state_ci_review_and_conflicts_and_skips_what_github_lacks() {
    let body = std::fs::read(fixtures().join("github/response.json")).expect("fixture");
    let mut statuses = parse_response(&fixture_query(), &body).expect("parsed");
    statuses.sort_by(|a, b| a.pr.cmp(&b.pr));

    assert_eq!(
        statuses,
        vec![
            PrStatusFact {
                pr: pr("example-org/gadgets", 7),
                url: String::from("https://github.com/example-org/gadgets/pull/7"),
                title: Some(String::from("fix: gadget hinge")),
                state: PrState::Merged,
                // The gate decides over the rollup.
                ci: CiState::Passed,
                review: ReviewState::Approved,
                mergeable: Mergeable::Unknown,
                branch: Some(String::from("fix/hinge")),
                created: Some(at("2030-01-02T10:03:05Z")),
                updated: Some(at("2030-01-02T12:00:00Z")),
                closed: Some(at("2030-01-02T12:00:00Z")),
            },
            PrStatusFact {
                pr: pr("example-org/widgets", 42),
                url: String::from("https://github.com/example-org/widgets/pull/42"),
                title: Some(String::from("perf: faster widgets")),
                state: PrState::Open,
                ci: CiState::Failed,
                review: ReviewState::ChangesRequested,
                mergeable: Mergeable::Conflicting,
                branch: Some(String::from("feat/faster")),
                created: Some(at("2030-01-02T10:02:05Z")),
                updated: Some(at("2030-01-02T11:00:00Z")),
                closed: None,
            },
            PrStatusFact {
                pr: pr("example-org/widgets", 44),
                url: String::from("https://github.com/example-org/widgets/pull/44"),
                title: Some(String::from("feat: codex widgets")),
                state: PrState::Draft,
                ci: CiState::Running,
                review: ReviewState::None,
                mergeable: Mergeable::Mergeable,
                branch: Some(String::from("feat/codex")),
                created: Some(at("2030-01-02T10:05:00Z")),
                updated: Some(at("2030-01-02T10:06:00Z")),
                closed: None,
            },
        ]
    );

    assert!(matches!(
        parse_response(
            &fixture_query(),
            br#"{"errors":[{"message":"Bad credentials"}]}"#
        ),
        Err(GithubError::Failed(_))
    ));
}

/// An SSH remote for `rest` (the host and path), with git's usual user.
fn ssh_remote(rest: &str) -> String {
    format!("{}@{rest}", "git")
}

#[test]
fn remote_urls_name_their_github_repository() {
    for url in [
        &ssh_remote("github.com:example-org/widgets.git"),
        &String::from("https://github.com/example-org/widgets"),
        &String::from("https://github.com/example-org/widgets.git\n"),
        &format!("ssh://{}", ssh_remote("github.com/example-org/widgets.git")),
    ] {
        assert_eq!(
            repo_of_remote(url),
            Some(repo("example-org/widgets")),
            "{url}"
        );
    }
    assert_eq!(
        repo_of_remote("https://gitlab.com/example-org/widgets"),
        None
    );
}

/// Answers every query with the fixture and records when it was asked.
#[derive(Clone)]
struct FakeGithub {
    calls: Arc<Mutex<Vec<Instant>>>,
    absent: bool,
    /// Calls after this many fail.
    fail_after: Option<usize>,
}

impl GithubBackend for FakeGithub {
    async fn graphql(&self, _query: String) -> Result<Vec<u8>, GithubError> {
        let made = {
            let mut calls = self.calls.lock().expect("calls");
            calls.push(Instant::now());
            calls.len()
        };
        if self.absent {
            return Err(GithubError::NotFound);
        }
        if self.fail_after.is_some_and(|limit| made > limit) {
            return Err(GithubError::Failed(String::from("HTTP 502")));
        }
        Ok(std::fs::read(fixtures().join("github/response.json")).expect("fixture"))
    }

    async fn origin(&self, cwd: PathBuf) -> Option<String> {
        (cwd == Path::new("/work/widgets"))
            .then(|| ssh_remote("github.com:example-org/widgets.git"))
    }
}

struct Harness {
    calls: Arc<Mutex<Vec<Instant>>>,
    observations: mpsc::Receiver<Observation>,
    subscribers: Arc<AtomicUsize>,
    cancel: CancellationToken,
    arrivals: watch::Sender<u64>,
    _wanted: watch::Sender<Arc<PrWanted>>,
}

fn run_fake(watchers: usize, absent: bool) -> Harness {
    run_backend(watchers, absent, None, std::iter::empty())
}

/// `extra` refs are looked up after the fixture's.
fn run_backend(
    watchers: usize,
    absent: bool,
    fail_after: Option<usize>,
    extra: impl IntoIterator<Item = PrRef>,
) -> Harness {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let backend = FakeGithub {
        calls: Arc::clone(&calls),
        absent,
        fail_after,
    };
    let mut wanted = PrWanted {
        // What the fixture answers.
        refs: [
            pr("example-org/widgets", 42),
            pr("example-org/widgets", 41),
            pr("example-org/gadgets", 7),
        ]
        .into_iter()
        .collect(),
        branches: [
            BranchCandidate {
                cwd: PathBuf::from("/work/widgets"),
                branch: String::from("feat/codex"),
            },
            BranchCandidate {
                cwd: PathBuf::from("/elsewhere"),
                branch: String::from("feat/x"),
            },
        ]
        .into_iter()
        .collect(),
    };
    wanted.refs.extend(extra);
    let (sender, receiver) = watch::channel(Arc::new(wanted));
    let subscribers = Arc::new(AtomicUsize::new(watchers));
    let count = Arc::clone(&subscribers);
    let (arrivals, arrived) = watch::channel(0);
    let interest = PrInterest {
        wanted: receiver,
        subscribers: Arc::new(move || count.load(Ordering::SeqCst)),
        arrivals: arrived,
    };
    let source = GithubSource::new(backend, interest, Duration::from_secs(60));
    let (out, observations) = mpsc::channel(1024);
    let cancel = CancellationToken::new();
    tokio::spawn(Box::new(source).run(out, cancel.clone()));
    Harness {
        calls,
        observations,
        subscribers,
        cancel,
        arrivals,
        _wanted: sender,
    }
}

impl Harness {
    async fn until_health(&mut self) -> (Vec<Change>, SourceHealth) {
        let mut changes = Vec::new();
        loop {
            let observation = self.observations.recv().await.expect("running");
            assert_eq!(observation.source, SourceKind::Github);
            match observation.change {
                Change::Health(health) => return (changes, health),
                change => changes.push(change),
            }
        }
    }

    fn gaps(&self) -> Vec<Duration> {
        let calls = self.calls.lock().expect("calls");
        calls.windows(2).map(|pair| pair[1] - pair[0]).collect()
    }
}

#[tokio::test(start_paused = true)]
async fn a_poll_reports_checkouts_and_statuses_then_repeats_each_minute_while_watched() {
    let mut harness = run_fake(1, false);

    let (changes, health) = harness.until_health().await;
    assert_eq!(changes[0], Change::Reset(Vec::new()));
    assert!(
        changes.contains(&Change::Upsert(Fact::Checkout(CheckoutFact {
            cwd: PathBuf::from("/work/widgets"),
            repo: repo("example-org/widgets"),
        })))
    );
    let statuses = changes
        .iter()
        .filter(|change| matches!(change, Change::Upsert(Fact::PrStatus(_))))
        .count();
    assert_eq!(statuses, 3);
    assert_eq!(health.state, SourceState::Healthy);
    assert_eq!(health.items, 3);
    assert_eq!(health.poll_every, Some(Duration::from_secs(60)));

    harness.until_health().await;
    harness.until_health().await;
    for gap in harness.gaps() {
        assert!(
            gap >= Duration::from_secs(54) && gap <= Duration::from_secs(66),
            "{gap:?}"
        );
    }

    // With nobody watching, at most every five minutes.
    harness.subscribers.store(0, Ordering::SeqCst);
    harness.until_health().await;
    harness.until_health().await;
    let last = *harness.gaps().last().expect("a gap");
    assert!(last >= IDLE_POLL, "{last:?}");

    // A viewer arriving a minute and a half in brings the next query forward.
    tokio::time::sleep(Duration::from_secs(90)).await;
    harness.subscribers.store(1, Ordering::SeqCst);
    harness.arrivals.send_modify(|count| *count += 1);
    harness.until_health().await;
    let last = *harness.gaps().last().expect("a gap");
    assert!(last < Duration::from_secs(100), "{last:?}");
    harness.cancel.cancel();
}

#[tokio::test(start_paused = true)]
async fn without_gh_the_source_is_absent_once_and_looks_again_later() {
    let mut harness = run_fake(1, true);

    let (_, health) = harness.until_health().await;
    assert_eq!(health.state, SourceState::Absent);
    assert_eq!(health.detail.as_deref(), Some("gh not found"));

    // Looks again after the discovery retry, and only then; quietly.
    tokio::time::sleep(DISCOVERY_RETRY - Duration::from_secs(1)).await;
    assert_eq!(harness.calls.lock().expect("calls").len(), 1);
    tokio::time::sleep(DISCOVERY_RETRY / 10).await;
    assert_eq!(harness.calls.lock().expect("calls").len(), 2);
    assert!(harness.observations.try_recv().is_err());
    harness.cancel.cancel();
}

#[tokio::test(start_paused = true)]
async fn a_failed_later_query_keeps_what_the_earlier_one_answered() {
    // The fixture's 4 lookups plus 120 in a repository sorted after them make
    // two queries; the second fails.
    let extra = (1..=120).map(|number| pr("example-org/zzz", number));
    let mut harness = run_backend(1, false, Some(1), extra);

    let (changes, health) = harness.until_health().await;
    assert_eq!(harness.calls.lock().expect("calls").len(), 2);
    let statuses = changes
        .iter()
        .filter(|change| matches!(change, Change::Upsert(Fact::PrStatus(_))))
        .count();
    assert_eq!(statuses, 3);
    assert_eq!(health.state, SourceState::Unhealthy);
    assert_eq!(health.items, 3);
    assert_eq!(health.detail.as_deref(), Some("gh api failed"));
    harness.cancel.cancel();
}
