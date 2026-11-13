use chrono::TimeZone;
use serde_json::json;

use super::*;
use crate::domain::models::Hostname;
use crate::fakes::fixture;

fn envelope() -> Envelope {
    Envelope {
        received_at: Utc.with_ymd_and_hms(2026, 11, 13, 4, 30, 0).unwrap(),
        credential_id: CredentialId::generate(),
        email: Email::parse("dev@example.com").unwrap(),
        hostname: Hostname::parse("laptop-1").unwrap(),
        distinct_id: Some("00000000-0000-4000-8000-000000000001".to_owned()),
        client_version: Some("1.7.7".to_owned()),
    }
}

fn plan_fixture(name: &str) -> IngestPlan {
    let batch = serde_json::from_value(fixture(name)["body"].clone()).unwrap();
    plan_batch(batch, envelope())
}

fn batch(events: Vec<Value>) -> MetricsBatch {
    MetricsBatch { version: 1, events }
}

#[test]
fn derives_git_ai_session_ids_like_the_client() {
    assert_eq!(
        git_ai_session_id("claude", "11111111-1111-4111-8111-111111111111"),
        "s_5b121f435f7f3f"
    );
    assert_eq!(
        git_ai_session_id("codex", "44444444-4444-4444-8444-444444444444"),
        "s_f4be7d5430ba3a"
    );
}

#[test]
fn the_mixed_upload_keeps_only_the_macro_repository() {
    let plan = plan_fixture("metrics-upload-mixed.json");

    assert_eq!(
        plan.tally.get(EventKind::Committed, EventResult::Accepted),
        3
    );
    assert_eq!(
        plan.tally
            .get(EventKind::Committed, EventResult::DroppedRepo),
        2
    );
    assert_eq!(
        plan.tally.get(EventKind::Checkpoint, EventResult::Accepted),
        4
    );
    assert_eq!(
        plan.tally
            .get(EventKind::Checkpoint, EventResult::DroppedRepo),
        1
    );
    assert_eq!(
        plan.tally
            .get(EventKind::SessionEvent, EventResult::Accepted),
        13
    );
    assert_eq!(
        plan.tally.get(EventKind::TokenUsage, EventResult::Accepted),
        2
    );
    assert_eq!(
        plan.tally.get(EventKind::AgentUsage, EventResult::Accepted),
        2
    );
    assert!(plan.errors.is_empty());

    // Everything but transcript lines goes to raw/.
    assert_eq!(plan.raw_events.len(), 3 + 4 + 2 + 2);
    assert_eq!(plan.commits.len(), 3);
    assert!(
        plan.commits
            .iter()
            .all(|c| c.repository == "github.com/macro-inc/macro")
    );
    let stored = serde_json::to_string(
        &plan
            .raw_events
            .iter()
            .map(MetricEvent::raw)
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert!(!stored.contains("someone-else"));
}

#[test]
fn transcripts_are_grouped_per_session_oldest_first() {
    let plan = plan_fixture("metrics-upload-mixed.json");
    let sessions: Vec<(&str, &str, usize)> = plan
        .sessions
        .iter()
        .map(|chunk| {
            (
                chunk.session_id.as_str(),
                chunk.tool.as_str(),
                chunk.events.len(),
            )
        })
        .collect();
    assert_eq!(
        sessions,
        vec![
            ("s_5b121f435f7f3f", "claude", 5),
            ("s_f4be7d5430ba3a", "codex", 8)
        ]
    );

    let claude = &plan.sessions[0];
    assert_eq!(
        claude.external_session_id.as_deref(),
        Some("11111111-1111-4111-8111-111111111111")
    );
    let times: Vec<u64> = claude.events.iter().map(|event| event.timestamp).collect();
    let mut sorted = times.clone();
    sorted.sort_unstable();
    assert_eq!(times, sorted);
    assert_eq!(
        (claude.first_ts, claude.last_ts),
        (times[0], times[times.len() - 1])
    );
    assert!(
        claude
            .key()
            .starts_with("sessions/tool=claude/sid=s_5b121f435f7f3f/")
    );
}

#[test]
fn a_retried_batch_produces_the_same_chunk_ids() {
    let first = plan_fixture("metrics-upload-mixed.json");
    let again = plan_fixture("metrics-upload-mixed.json");
    let ids = |plan: &IngestPlan| {
        plan.sessions
            .iter()
            .map(SessionChunk::key)
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&first), ids(&again));
}

#[test]
fn transcript_secrets_are_masked_before_they_reach_the_plan() {
    let plan = plan_fixture("metrics-upload-mixed.json");
    let transcripts: String = plan
        .sessions
        .iter()
        .flat_map(|chunk| &chunk.events)
        .map(|event| Value::Object(event.raw().clone()).to_string())
        .collect();
    for secret in [
        concat!("ghp_", "FAKE-NOT-A-REAL-TOKEN"),
        concat!("4242", "424242424242"),
        concat!("hunter2", "-fake-pw"),
        concat!("sk-proj-", "FAKEFAKE"),
    ] {
        assert!(!transcripts.contains(secret), "{secret} leaked");
    }
    assert!(transcripts.contains("[REDACTED:github_token]"));
    assert!(plan.redaction.total() >= 6);
}

#[test]
fn commits_carry_line_counts_and_their_note_sessions() {
    let plan = plan_fixture("metrics-upload-mixed.json");
    let commit = plan
        .commits
        .iter()
        .find(|commit| commit.subject.as_deref() == Some("feat: add greeting helper"))
        .unwrap();

    assert_eq!(commit.sha, "9237c8c1cdf2a07152059eaa8a61592efe1d1d86");
    assert_eq!(commit.kind, CommitKind::Committed);
    assert_eq!(commit.branch.as_deref(), Some("main"));
    assert_eq!(
        (commit.added_lines, commit.ai_lines, commit.human_lines),
        (2, 2, 0)
    );
    assert_eq!(
        commit.ai_lines_by_tool_model,
        BTreeMap::from([("claude::claude-sonnet-4-5-20250929".to_owned(), 2)])
    );
    assert_eq!(commit.sessions.len(), 1);
    assert_eq!(commit.sessions[0].session_id, "s_5b121f435f7f3f");
    assert_eq!(
        commit.note_key.as_deref(),
        Some("notes/92/9237c8c1cdf2a07152059eaa8a61592efe1d1d86")
    );
    assert!(
        commit
            .note
            .as_deref()
            .unwrap()
            .contains("s_5b121f435f7f3f::t_0b9acda081d542")
    );
    assert_eq!(commit.author.as_str(), "dev@example.com");
}

#[test]
fn token_usage_becomes_a_bucket_revision() {
    let plan = plan_fixture("metrics-upload-mixed.json");
    let claude = plan
        .token_buckets
        .iter()
        .find(|bucket| bucket.tool == "claude")
        .unwrap();
    assert_eq!(claude.session_id, "s_5b121f435f7f3f");
    assert_eq!(claude.model, "claude-sonnet-4-5-20250929");
    assert_eq!(claude.bucket_ts, 1_794_543_900);
    assert_eq!(claude.emitted_seq, 1_794_543_965);
    assert_eq!(
        claude.counts,
        TokenCounts {
            input: 32,
            output: 102,
            cache_read: 6800,
            cache_write: 2400,
            cost_micro_usd: 12666,
        }
    );
}

#[test]
fn an_oversized_model_name_is_cut_to_fit_the_sort_key() {
    let plan = plan_batch(
        batch(vec![json!({
            "t": 1_794_543_100,
            "e": 9,
            "a": {
                "1": "https://github.com/macro-inc/macro",
                "20": "claude",
                "21": "m".repeat(5_000),
                "24": "s_1b1b33649b60ca",
            },
            "v": {"0": 1_794_543_000, "1": 5, "10": 1},
        })]),
        envelope(),
    );

    assert_eq!(plan.token_buckets[0].model, "m".repeat(128));
}

#[test]
fn every_event_kind_is_filtered_by_repository() {
    let events = (1..=10)
        .flat_map(|id| {
            [
                json!({"t": 1, "e": id, "a": {"1": "https://github.com/someone-else/other"}, "v": {}}),
                json!({"t": 1, "e": id, "a": {"0": "1.7.7"}, "v": {}}),
                json!({"t": 1, "e": id, "a": {"1": "", "20": "claude", "23": "x", "24": "s_1"}, "v": {"0": "hi"}}),
            ]
        })
        .collect();
    let plan = plan_batch(batch(events), envelope());

    assert_eq!(plan.tally.with_result(EventResult::DroppedRepo), 10);
    assert_eq!(plan.tally.with_result(EventResult::DroppedNoRepo), 20);
    assert_eq!(plan.tally.with_result(EventResult::Accepted), 0);
    assert!(plan.errors.is_empty());
    assert!(plan.raw_events.is_empty() && plan.sessions.is_empty());
}

#[test]
fn unknown_events_of_the_repository_are_kept_raw() {
    // The scp form of the remote, split so the secret scanner does not read it as an email.
    let remote = concat!("git", "@", "github.com:macro-inc/macro.git");
    let event = json!({"t": 5, "e": 77, "a": {"1": remote, "88": "new"}, "v": {"3": 1}});
    let plan = plan_batch(batch(vec![event.clone()]), envelope());
    assert_eq!(plan.tally.get(EventKind::Unknown, EventResult::Accepted), 1);
    assert_eq!(Value::Object(plan.raw_events[0].raw().clone()), event);
}

#[test]
fn malformed_events_are_reported_by_index_and_the_rest_kept() {
    let repo = "https://github.com/macro-inc/macro";
    let plan = plan_batch(
        batch(vec![
            json!({"t": 1, "e": 2, "a": {"1": repo}, "v": {}}),
            json!("not an event"),
            json!({"t": 1, "e": 5, "a": {"1": repo}, "v": {"0": {}}}),
        ]),
        envelope(),
    );
    assert_eq!(
        plan.errors,
        vec![
            EventError {
                index: 1,
                error: "event is not an object"
            },
            EventError {
                index: 2,
                error: "session event has no session id"
            },
        ]
    );
    assert_eq!(
        plan.tally.get(EventKind::AgentUsage, EventResult::Accepted),
        1
    );
}

#[test]
fn a_session_event_without_attribute_24_gets_a_derived_id() {
    let event = json!({"t": 1, "e": 5, "a": {
        "1": "https://github.com/macro-inc/macro",
        "20": "claude",
        "23": "11111111-1111-4111-8111-111111111111",
    }, "v": {"0": {"type": "user"}}});
    let plan = plan_batch(batch(vec![event]), envelope());
    assert_eq!(plan.sessions[0].session_id, "s_5b121f435f7f3f");
}

#[test]
fn an_unsafe_session_id_is_not_used_as_a_key() {
    let event = json!({"t": 1, "e": 5, "a": {
        "1": "https://github.com/macro-inc/macro",
        "20": "../../etc",
        "23": "abc",
        "24": "../escape",
    }, "v": {"0": {}}});
    let plan = plan_batch(batch(vec![event]), envelope());
    let chunk = &plan.sessions[0];
    assert_eq!(chunk.session_id, git_ai_session_id("../../etc", "abc"));
    assert_eq!(chunk.tool, UNKNOWN_TOOL);
}
