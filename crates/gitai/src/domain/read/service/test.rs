use chrono::Utc;
use upstream_error::{UpstreamError, UpstreamFailure};

use super::*;
use crate::domain::read::models::{BlameHunk, GithubBlame};
use crate::read_fakes::{ReadHarness, committed, note, session_event, token_usage};

const DIRECT: &str = "1111111111111111111111111111111111111111";
const FIRST_PR_COMMIT: &str = "2222222222222222222222222222222222222222";
const SECOND_PR_COMMIT: &str = "3333333333333333333333333333333333333333";
const UNNOTED_PR_COMMIT: &str = "4444444444444444444444444444444444444444";
const SQUASH: &str = "5555555555555555555555555555555555555555";
const SESSION_A: &str = "s_aaaaaaaaaaaaaa";
const SESSION_B: &str = "s_bbbbbbbbbbbbbb";

/// A direct commit by session A (10 lines of src/a.rs), with its tokens.
async fn with_direct_commit(harness: &ReadHarness) {
    let note = note("src/a.rs\n  s_aaaaaaaaaaaaaa::t_00000000000001 1-10\n", &[SESSION_A]);
    harness
        .upload(vec![
            committed(DIRECT, 10, 2, &note),
            token_usage(SESSION_A, 1_000, 200, 1_500_000),
        ])
        .await;
}

/// Two noted commits of pull request 42 (squash-merged as SQUASH): A wrote
/// 3 lines of src/a.rs, B 5 lines of src/b.rs.
async fn with_squashed_pull_request(harness: &ReadHarness) {
    let first = note("src/a.rs\n  s_aaaaaaaaaaaaaa::t_00000000000002 1-3\n", &[SESSION_A]);
    let second = note("src/b.rs\n  s_bbbbbbbbbbbbbb::t_00000000000003 4-8\n", &[SESSION_B]);
    harness
        .upload(vec![
            committed(FIRST_PR_COMMIT, 3, 0, &first),
            committed(SECOND_PR_COMMIT, 5, 1, &second),
            token_usage(SESSION_B, 400, 40, 250_000),
        ])
        .await;
    let mut script = harness.github.script.lock().unwrap();
    script.commits.insert(
        SQUASH.to_owned(),
        "feat(gitai): read API (#42)".to_owned(),
    );
    script.pull_requests.insert(
        42,
        (
            false,
            vec![FIRST_PR_COMMIT.to_owned(), SECOND_PR_COMMIT.to_owned()],
        ),
    );
}

#[tokio::test]
async fn a_noted_commit_answers_from_its_note() {
    let harness = ReadHarness::new().await;
    with_direct_commit(&harness).await;

    let attribution = harness.reader.commit(harness.key(), DIRECT).await.unwrap();

    assert_eq!(attribution.resolved_via, ResolvedVia::Note);
    assert_eq!(attribution.sha.as_deref(), Some(DIRECT));
    assert_eq!(attribution.pr, None);
    assert_eq!(attribution.commits, vec![DIRECT.to_owned()]);
    assert_eq!((attribution.ai_lines, attribution.human_lines), (10, 2));
    assert_eq!(attribution.ai_share, Some(10.0 / 12.0));
    assert_eq!(attribution.cost_usd, 1.5);
    assert_eq!(attribution.tokens.input, 1_000);
    let [session] = attribution.sessions.as_slice() else {
        panic!("one session expected: {:?}", attribution.sessions);
    };
    assert_eq!(session.id, SESSION_A);
    assert_eq!(session.ai_lines, 10);
    assert_eq!(session.tool.as_deref(), Some("claude"));
    assert_eq!(session.author.as_deref(), Some("dev@example.com"));
    assert_eq!(session.events_url, "/gitai/v1/sessions/s_aaaaaaaaaaaaaa/events");
    assert_eq!(harness.github.calls(), 0);
}

#[tokio::test]
async fn a_squash_commit_resolves_through_its_pull_request() {
    let harness = ReadHarness::new().await;
    with_squashed_pull_request(&harness).await;

    let attribution = harness.reader.commit(harness.key(), SQUASH).await.unwrap();

    assert_eq!(attribution.resolved_via, ResolvedVia::Pr);
    assert_eq!(attribution.sha.as_deref(), Some(SQUASH));
    assert_eq!(attribution.pr.as_ref().map(|pr| pr.number), Some(42));
    assert_eq!(
        attribution.commits,
        vec![FIRST_PR_COMMIT.to_owned(), SECOND_PR_COMMIT.to_owned()]
    );
    assert!(attribution.unattributed_commits.is_empty());
    assert_eq!((attribution.ai_lines, attribution.human_lines), (8, 1));
    let sessions: Vec<(&str, u64)> = attribution
        .sessions
        .iter()
        .map(|session| (session.id.as_str(), session.ai_lines))
        .collect();
    assert_eq!(sessions, vec![(SESSION_B, 5), (SESSION_A, 3)]);
    assert_eq!(attribution.cost_usd, 0.25);

    // The second lookup is answered from the cache.
    let calls = harness.github.calls();
    harness.reader.commit(harness.key(), SQUASH).await.unwrap();
    assert_eq!(harness.github.calls(), calls);
}

#[tokio::test]
async fn an_abbreviated_squash_sha_resolves_too() {
    let harness = ReadHarness::new().await;
    with_squashed_pull_request(&harness).await;

    let attribution = harness.reader.commit(harness.key(), "5555555").await.unwrap();

    assert_eq!(attribution.sha.as_deref(), Some(SQUASH));
    assert_eq!(attribution.pr.map(|pr| pr.number), Some(42));
}

#[tokio::test]
async fn commits_without_notes_are_unattributed() {
    let harness = ReadHarness::new().await;
    with_squashed_pull_request(&harness).await;
    harness.github.script.lock().unwrap().pull_requests.insert(
        43,
        (
            true,
            vec![FIRST_PR_COMMIT.to_owned(), UNNOTED_PR_COMMIT.to_owned()],
        ),
    );

    let attribution = harness.reader.pull_request(harness.key(), 43).await.unwrap();

    assert_eq!(attribution.sha, None);
    assert_eq!(attribution.unattributed_commits, vec![UNNOTED_PR_COMMIT.to_owned()]);
    assert_eq!((attribution.ai_lines, attribution.human_lines), (3, 0));
    assert_eq!(attribution.ai_share, Some(1.0));
    assert_eq!(attribution.sessions.len(), 1);

    // An open pull request is cached briefly, so new commits show up.
    let cached = harness.index.cache.lock().unwrap().pull_requests[&43].clone();
    assert!(cached.open);
    assert!(cached.expires_at <= Utc::now() + OPEN_PULL_REQUEST_TTL);
}

#[tokio::test]
async fn an_expired_pull_request_cache_asks_github_again() {
    let harness = ReadHarness::new().await;
    with_squashed_pull_request(&harness).await;
    harness.index.cache.lock().unwrap().pull_requests.insert(
        42,
        CachedPullRequest {
            number: 42,
            commits: vec![FIRST_PR_COMMIT.to_owned()],
            open: true,
            expires_at: Utc::now() - Duration::minutes(1),
        },
    );

    let attribution = harness.reader.pull_request(harness.key(), 42).await.unwrap();

    assert_eq!(attribution.commits.len(), 2);
}

#[tokio::test]
async fn unknown_commits_and_pull_requests_are_not_found() {
    let harness = ReadHarness::new().await;
    harness.github.script.lock().unwrap().commits.insert(
        "6666666666666666666666666666666666666666".to_owned(),
        "chore: a commit with no pull request".to_owned(),
    );

    let unknown = harness
        .reader
        .commit(harness.key(), "9999999999999999999999999999999999999999")
        .await;
    let without_pr = harness
        .reader
        .commit(harness.key(), "6666666666666666666666666666666666666666")
        .await;
    let pull_request = harness.reader.pull_request(harness.key(), 7).await;

    assert!(matches!(unknown, Err(ReadError::Gitai(GitaiError::NotFound))));
    assert!(matches!(without_pr, Err(ReadError::Gitai(GitaiError::NotFound))));
    assert!(matches!(pull_request, Err(ReadError::Gitai(GitaiError::NotFound))));
}

#[tokio::test]
async fn reads_need_a_device_credential() {
    let harness = ReadHarness::new().await;
    with_direct_commit(&harness).await;

    let anonymous = harness.reader.commit(None, DIRECT).await;
    let shared_key = harness
        .reader
        .session(Some(crate::fakes::SHARED_KEY), SESSION_A)
        .await;

    assert!(matches!(anonymous, Err(ReadError::Gitai(GitaiError::Unauthorized))));
    assert!(matches!(shared_key, Err(ReadError::Gitai(GitaiError::Unauthorized))));
}

#[tokio::test]
async fn github_failures_surface_as_upstream_errors() {
    let harness = ReadHarness::new().await;
    let rate_limited = UpstreamError {
        service: "GitHub",
        failure: UpstreamFailure::RateLimited { retry_after: None },
    };
    harness.github.script.lock().unwrap().failure = Some(GithubError::Upstream(rate_limited));

    let result = harness.reader.commit(harness.key(), SQUASH).await;

    assert!(matches!(result, Err(ReadError::Github(error)) if error == rate_limited));
}

#[tokio::test]
async fn session_entry_has_totals_and_commits() {
    let harness = ReadHarness::new().await;
    with_direct_commit(&harness).await;
    harness
        .upload(vec![
            session_event(SESSION_A, 1_794_543_010, 1),
            session_event(SESSION_A, 1_794_543_020, 2),
        ])
        .await;

    let entry = harness.reader.session(harness.key(), SESSION_A).await.unwrap();

    assert_eq!(entry.event_count, 2);
    assert_eq!(entry.commits, vec![DIRECT.to_owned()]);
    assert_eq!(entry.cost_usd, 1.5);
    assert_eq!(entry.first_seen.map(|t| t.timestamp()), Some(1_794_543_010));
    assert!(matches!(
        harness.reader.session(harness.key(), "s_unknown").await,
        Err(ReadError::Gitai(GitaiError::NotFound))
    ));
}

#[tokio::test]
async fn session_events_page_across_chunks_in_order() {
    let harness = ReadHarness::new().await;
    // Two batches make two chunks: lines 1-3, then 4-5. git-ai sends lines
    // newest first.
    harness
        .upload(vec![
            session_event(SESSION_A, 1_794_543_003, 3),
            session_event(SESSION_A, 1_794_543_002, 2),
            session_event(SESSION_A, 1_794_543_001, 1),
        ])
        .await;
    harness
        .upload(vec![
            session_event(SESSION_A, 1_794_543_005, 5),
            session_event(SESSION_A, 1_794_543_004, 4),
        ])
        .await;

    let mut numbers = Vec::new();
    let mut pages = 0;
    let mut from: Option<String> = None;
    loop {
        let page = harness
            .reader
            .session_events(harness.key(), SESSION_A, from.as_deref(), Some(2))
            .await
            .unwrap();
        pages += 1;
        numbers.extend(page.events.iter().map(|event| event["n"].as_u64().unwrap()));
        match page.next {
            Some(next) => from = Some(next),
            None => break,
        }
    }

    assert_eq!(numbers, vec![1, 2, 3, 4, 5]);
    assert_eq!(pages, 3);
}

#[tokio::test]
async fn a_page_ending_with_the_last_line_has_no_next() {
    let harness = ReadHarness::new().await;
    harness
        .upload(vec![
            session_event(SESSION_A, 1_794_543_002, 2),
            session_event(SESSION_A, 1_794_543_001, 1),
        ])
        .await;

    let page = harness
        .reader
        .session_events(harness.key(), SESSION_A, None, Some(2))
        .await
        .unwrap();

    assert_eq!(page.events.len(), 2);
    assert_eq!(page.next, None);
}

#[tokio::test]
async fn session_events_reject_bad_cursors_and_cap_the_limit() {
    let harness = ReadHarness::new().await;
    harness
        .upload(vec![session_event(SESSION_A, 1_794_543_001, 1)])
        .await;

    let bad_cursor = harness
        .reader
        .session_events(harness.key(), SESSION_A, Some("not-a-cursor"), None)
        .await;
    let zero = harness
        .reader
        .session_events(harness.key(), SESSION_A, None, Some(0))
        .await;
    let huge = harness
        .reader
        .session_events(harness.key(), SESSION_A, None, Some(100_000))
        .await;

    assert!(matches!(bad_cursor, Err(ReadError::Gitai(GitaiError::BadRequest(_)))));
    assert!(matches!(zero, Err(ReadError::Gitai(GitaiError::BadRequest(_)))));
    assert_eq!(huge.unwrap().events.len(), 1);
}

#[tokio::test]
async fn blame_of_a_noted_revision_is_line_exact() {
    let harness = ReadHarness::new().await;
    with_direct_commit(&harness).await;
    harness.github.script.lock().unwrap().blames.insert(
        DIRECT.to_owned(),
        GithubBlame {
            commit: DIRECT.to_owned(),
            hunks: vec![BlameHunk {
                start: 1,
                end: 12,
                commit: DIRECT.to_owned(),
            }],
        },
    );

    let blame = harness
        .reader
        .blame(
            harness.key(),
            BlameQuery {
                path: "src/a.rs".to_owned(),
                start: 5,
                end: 12,
                rev: Some(DIRECT.to_owned()),
            },
        )
        .await
        .unwrap();

    let ranges: Vec<(u32, u32, Option<&str>)> = blame
        .ranges
        .iter()
        .map(|range| (range.start, range.end, range.session_id.as_deref()))
        .collect();
    assert_eq!(ranges, vec![(5, 10, Some(SESSION_A)), (11, 12, None)]);
    assert_eq!(blame.ranges[0].tool.as_deref(), Some("claude"));
}

#[tokio::test]
async fn blame_on_main_resolves_squash_commits_by_file() {
    let harness = ReadHarness::new().await;
    with_squashed_pull_request(&harness).await;
    harness.github.script.lock().unwrap().blames.insert(
        "main".to_owned(),
        GithubBlame {
            commit: "7777777777777777777777777777777777777777".to_owned(),
            hunks: vec![
                BlameHunk {
                    start: 1,
                    end: 4,
                    commit: SQUASH.to_owned(),
                },
                BlameHunk {
                    start: 5,
                    end: 9,
                    commit: "8888888888888888888888888888888888888888".to_owned(),
                },
            ],
        },
    );

    let blame = harness
        .reader
        .blame(
            harness.key(),
            BlameQuery {
                path: "src/a.rs".to_owned(),
                start: 1,
                end: 20,
                rev: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(blame.rev, "main");
    let ranges: Vec<(u32, u32, &str, Option<&str>)> = blame
        .ranges
        .iter()
        .map(|range| {
            (
                range.start,
                range.end,
                range.commit.as_str(),
                range.session_id.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        ranges,
        vec![
            (1, 4, SQUASH, Some(SESSION_A)),
            (5, 9, "8888888888888888888888888888888888888888", None),
        ]
    );
}

#[tokio::test]
async fn blame_of_a_missing_path_is_not_found() {
    let harness = ReadHarness::new().await;
    harness.github.script.lock().unwrap().blames.insert(
        "main".to_owned(),
        GithubBlame {
            commit: SQUASH.to_owned(),
            hunks: Vec::new(),
        },
    );

    let blame = harness
        .reader
        .blame(
            harness.key(),
            BlameQuery {
                path: "does/not/exist.rs".to_owned(),
                start: 1,
                end: 2,
                rev: None,
            },
        )
        .await;

    assert!(matches!(blame, Err(ReadError::Gitai(GitaiError::NotFound))));
}

#[test]
fn reads_the_pull_request_from_a_squash_subject() {
    assert_eq!(pull_request_in_subject("feat(x): thing (#10645)"), Some(10645));
    assert_eq!(pull_request_in_subject("Revert \"a (#1)\" (#2) "), Some(2));
    assert_eq!(pull_request_in_subject("fix: see #12 for details"), None);
    assert_eq!(pull_request_in_subject("fix: (#12) then more"), None);
}
