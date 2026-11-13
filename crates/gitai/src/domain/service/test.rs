use serde_json::json;

use super::*;
use crate::domain::metrics::EventResult;
use crate::domain::wire::EventKind;
use crate::fakes::{SHARED_KEY, TestService, fixture_body, service};

fn headers() -> ClientHeaders {
    ClientHeaders {
        distinct_id: Some("00000000-0000-4000-8000-000000000001".to_owned()),
        client_version: Some("1.7.7".to_owned()),
    }
}

async fn device(service: &TestService, credential: &str) -> DeviceIdentity {
    service.authenticate_device(Some(credential)).await.unwrap()
}

async fn mint(service: &TestService) -> String {
    service
        .mint_credential(Some(SHARED_KEY), "Dev@Example.com", "laptop-1")
        .await
        .unwrap()
        .credential
        .expose()
        .to_owned()
}

fn batch_results(metrics: &[Metric]) -> Vec<(Endpoint, BatchResult)> {
    metrics
        .iter()
        .filter_map(|metric| match metric {
            Metric::Batch {
                endpoint, result, ..
            } => Some((*endpoint, *result)),
            _ => None,
        })
        .collect()
}

fn sum_events(metrics: &[Metric], kind: EventKind, outcome: EventResult) -> u64 {
    metrics
        .iter()
        .filter_map(|metric| match metric {
            Metric::Events {
                event,
                result,
                count,
            } if *event == kind && *result == outcome => Some(*count),
            _ => None,
        })
        .sum()
}

#[tokio::test]
async fn credential_lifecycle_mint_list_use_revoke() {
    let (service, _, index, _) = service();

    let minted = service
        .mint_credential(Some(SHARED_KEY), "Dev@Example.com", " laptop-1 ")
        .await
        .unwrap();
    let credential = minted.credential.expose().to_owned();
    assert!(credential.starts_with("gitai_"));
    assert_eq!(credential.len(), "gitai_".len() + 43);
    assert_eq!(minted.info.email.as_str(), "dev@example.com");
    assert_eq!(minted.info.hostname.as_str(), "laptop-1");

    // Only the hash is stored.
    {
        let state = index.state.lock().unwrap();
        let (hash, _) = state.credentials.iter().next().unwrap();
        assert_ne!(hash.as_str(), credential);
        assert_eq!(hash.as_str().len(), 64);
    }

    let listed = service.list_credentials(Some(SHARED_KEY)).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, minted.info.id);

    let identity = service.whoami(Some(&credential)).await.unwrap();
    assert_eq!(identity.credential_id, minted.info.id);
    assert_eq!(identity.email.as_str(), "dev@example.com");

    service
        .revoke_credential(Some(SHARED_KEY), minted.info.id)
        .await
        .unwrap();
    assert!(matches!(
        service.whoami(Some(&credential)).await,
        Err(GitaiError::Unauthorized)
    ));
    let listed = service.list_credentials(Some(SHARED_KEY)).await.unwrap();
    assert!(listed[0].revoked_at.is_some());

    // Revoking again keeps working; an unknown id is not found.
    service
        .revoke_credential(Some(SHARED_KEY), minted.info.id)
        .await
        .unwrap();
    assert!(matches!(
        service
            .revoke_credential(Some(SHARED_KEY), CredentialId::generate())
            .await,
        Err(GitaiError::NotFound)
    ));
}

#[tokio::test]
async fn the_shared_key_and_device_credentials_are_not_interchangeable() {
    let (service, _, _, _) = service();
    let credential = mint(&service).await;

    for presented in [None, Some(""), Some("wrong"), Some(credential.as_str())] {
        assert!(matches!(
            service
                .mint_credential(presented, "a@example.com", "h")
                .await,
            Err(GitaiError::Unauthorized)
        ));
        assert!(matches!(
            service.list_credentials(presented).await,
            Err(GitaiError::Unauthorized)
        ));
    }
    for presented in [
        None,
        Some(SHARED_KEY),
        Some("gitai_unknown"),
        Some("gitai_"),
        Some("gitai_has spaces"),
    ] {
        assert!(matches!(
            service.whoami(presented).await,
            Err(GitaiError::Unauthorized)
        ));
    }
}

#[tokio::test]
async fn minting_validates_email_and_hostname() {
    let (service, _, _, _) = service();
    for (email, hostname) in [
        ("not-an-email", "h"),
        ("a@b", "h"),
        ("a@example.com", " "),
        ("a@example.com", "x\ny"),
    ] {
        assert!(matches!(
            service
                .mint_credential(Some(SHARED_KEY), email, hostname)
                .await,
            Err(GitaiError::BadRequest(_))
        ));
    }
}

#[tokio::test]
async fn last_used_at_is_written_at_most_every_few_minutes() {
    let (service, _, index, _) = service();
    let credential = mint(&service).await;
    for _ in 0..3 {
        service.whoami(Some(&credential)).await.unwrap();
    }
    let state = index.state.lock().unwrap();
    assert_eq!(state.touches, 1);
    assert!(
        state
            .credentials
            .values()
            .next()
            .unwrap()
            .last_used_at
            .is_some()
    );
}

#[tokio::test]
async fn ingesting_the_mixed_upload_stores_only_the_macro_repository() {
    let (service, objects, index, metrics) = service();
    let credential = mint(&service).await;

    let errors = service
        .ingest_metrics(
            &device(&service, &credential).await,
            &headers(),
            &fixture_body("metrics-upload-mixed.json"),
        )
        .await
        .unwrap();
    assert!(errors.is_empty());

    // Objects in both buckets.
    let events = objects.keys(Bucket::Events);
    assert_eq!(
        events
            .iter()
            .filter(|k| k.starts_with("raw/v=1/dt="))
            .count(),
        1
    );
    assert_eq!(events.iter().filter(|k| k.starts_with("notes/")).count(), 3);
    assert_eq!(
        events
            .iter()
            .filter(|k| k.starts_with("commits/repo=macro-inc__macro/"))
            .count(),
        1
    );
    assert_eq!(events.iter().filter(|k| k.starts_with("usage/")).count(), 1);
    let sessions = objects.keys(Bucket::Sessions);
    assert_eq!(
        sessions
            .iter()
            .filter(|k| k.starts_with("sessions/tool=claude/sid=s_5b121f435f7f3f/"))
            .count(),
        1
    );
    assert_eq!(
        sessions
            .iter()
            .filter(|k| k.starts_with("sessions/tool=codex/sid=s_f4be7d5430ba3a/"))
            .count(),
        1
    );
    assert_eq!(
        sessions
            .iter()
            .filter(|k| k.starts_with("session-index/"))
            .count(),
        1
    );

    // Nothing of the other repository, and no fake secret, anywhere.
    let stored = objects.all_text();
    assert!(!stored.contains("someone-else"));
    assert!(!stored.contains("not allowed repo"));
    for secret in [
        concat!("ghp_", "FAKE-NOT-A-REAL-TOKEN"),
        concat!("4242", "424242424242"),
        concat!("hunter2", "-fake-pw"),
        concat!("sk-proj-", "FAKEFAKE"),
    ] {
        assert!(!stored.contains(secret), "{secret} stored");
    }

    // Lines carry the credential's identity, not X-Author-Identity.
    let raw_key = events.iter().find(|k| k.starts_with("raw/")).unwrap();
    let line = &objects.jsonl_zst(Bucket::Events, raw_key)[0];
    assert_eq!(line["envelope"]["email"], "dev@example.com");
    assert_eq!(line["envelope"]["hostname"], "laptop-1");
    assert_eq!(line["envelope"]["client_version"], "1.7.7");

    // Index entries.
    let state = index.state.lock().unwrap();
    assert_eq!(state.commits.len(), 3);
    let claude = &state.sessions["s_5b121f435f7f3f"];
    assert_eq!(claude.event_count, 5);
    assert_eq!(claude.tool.as_deref(), Some("claude"));
    assert_eq!(claude.model.as_deref(), Some("claude-sonnet-4-5-20250929"));
    assert_eq!(claude.author.as_deref(), Some("dev@example.com"));
    assert_eq!(
        claude.external_session_id.as_deref(),
        Some("11111111-1111-4111-8111-111111111111")
    );
    assert!(
        claude
            .commit_shas
            .contains("9237c8c1cdf2a07152059eaa8a61592efe1d1d86")
    );
    assert_eq!(claude.tokens.cost_micro_usd, 12666);
    assert_eq!(state.sessions["s_f4be7d5430ba3a"].event_count, 8);
    assert!(!state.sessions.contains_key("s_a5a876c86efa83"));
    drop(state);

    let recorded = metrics.all();
    assert_eq!(
        batch_results(&recorded),
        vec![(Endpoint::MetricsUpload, BatchResult::Ok)]
    );
    assert_eq!(
        sum_events(&recorded, EventKind::Committed, EventResult::DroppedRepo),
        2
    );
    assert_eq!(
        sum_events(&recorded, EventKind::SessionEvent, EventResult::Accepted),
        13
    );
    assert_eq!(
        recorded
            .iter()
            .filter(|m| matches!(m, Metric::Commit { .. }))
            .count(),
        3
    );
    assert_eq!(
        recorded
            .iter()
            .filter(|m| matches!(m, Metric::SessionStarted { .. }))
            .count(),
        2
    );
    assert!(
        recorded
            .iter()
            .any(|m| matches!(m, Metric::RedactionHits { .. }))
    );
    assert!(recorded.iter().any(|m| matches!(
        m,
        Metric::Lines { kind: LineKind::Ai, count: 2, tool, .. } if tool == "claude"
    )));
    assert!(recorded.iter().any(|m| matches!(
        m,
        Metric::Tokens { kind: TokenKind::CacheRead, count: 6800, author, .. } if author == "dev@example.com"
    )));
}

#[tokio::test]
async fn a_retried_batch_counts_nothing_twice() {
    let (service, _, index, metrics) = service();
    let credential = mint(&service).await;
    let body = fixture_body("metrics-upload-mixed.json");

    service
        .ingest_metrics(&device(&service, &credential).await, &headers(), &body)
        .await
        .unwrap();
    service
        .ingest_metrics(&device(&service, &credential).await, &headers(), &body)
        .await
        .unwrap();

    let state = index.state.lock().unwrap();
    assert_eq!(state.sessions["s_5b121f435f7f3f"].event_count, 5);
    assert_eq!(
        state.sessions["s_5b121f435f7f3f"].tokens.cost_micro_usd,
        12666
    );
    let recorded = metrics.all();
    assert_eq!(
        recorded
            .iter()
            .filter(|m| matches!(m, Metric::Commit { .. }))
            .count(),
        3
    );
    assert_eq!(
        recorded
            .iter()
            .filter(|m| matches!(m, Metric::Tokens { .. }))
            .count(),
        6
    );
}

#[tokio::test]
async fn every_recorded_upload_is_accepted() {
    let (service, objects, _, _) = service();
    let credential = mint(&service).await;
    for name in [
        "metrics-upload-sweep-allowed-only.json",
        "metrics-upload-503.json",
        "metrics-upload-429-retry-after.json",
        "metrics-upload-401.json",
        "metrics-upload-errors-array.json",
        "metrics-upload-retry-after-503.json",
    ] {
        let errors = service
            .ingest_metrics(
                &device(&service, &credential).await,
                &headers(),
                &fixture_body(name),
            )
            .await
            .unwrap();
        assert!(errors.is_empty(), "{name}");
    }
    for name in [
        "logs-upload.json",
        "logs-upload-daemon-start.json",
        "logs-upload-after-503.json",
    ] {
        let accepted = service
            .accept_logs(
                &device(&service, &credential).await,
                &headers(),
                &fixture_body(name),
            )
            .await
            .unwrap();
        assert!(accepted > 0, "{name}");
    }
    // Logs are never stored.
    assert!(!objects.all_text().contains("metrics upload batch"));
}

#[tokio::test]
async fn an_unauthorized_client_is_refused_and_counted() {
    let (service, objects, _, metrics) = service();
    for presented in [None, Some(SHARED_KEY), Some("gitai_revoked")] {
        let result = service
            .authenticate_client(Endpoint::MetricsUpload, presented, &headers())
            .await;
        assert!(matches!(result, Err(GitaiError::Unauthorized)));
    }
    assert!(objects.objects.lock().unwrap().is_empty());
    assert!(
        batch_results(&metrics.all())
            .iter()
            .all(|(_, result)| *result == BatchResult::Unauthorized)
    );
}

#[tokio::test]
async fn a_body_that_is_not_a_batch_is_invalid() {
    let (service, _, _, metrics) = service();
    let credential = mint(&service).await;
    for body in [&b"not json"[..], br#"{"events": 3}"#] {
        assert!(matches!(
            service
                .ingest_metrics(&device(&service, &credential).await, &headers(), body)
                .await,
            Err(GitaiError::BadRequest(_))
        ));
    }
    assert!(
        batch_results(&metrics.all())
            .iter()
            .all(|(_, r)| *r == BatchResult::Invalid)
    );
}

#[tokio::test]
async fn a_storage_failure_is_an_internal_error_the_client_retries() {
    let (service, objects, _, metrics) = service();
    let credential = mint(&service).await;
    *objects.failing.lock().unwrap() = true;
    let result = service
        .ingest_metrics(
            &device(&service, &credential).await,
            &headers(),
            &fixture_body("metrics-upload-mixed.json"),
        )
        .await;
    assert!(matches!(result, Err(GitaiError::Internal(_))));
    assert_eq!(
        batch_results(&metrics.all()),
        vec![(Endpoint::MetricsUpload, BatchResult::Error)]
    );
}

fn token_event(seq: u64, input: u64, cost: u64) -> serde_json::Value {
    json!({"t": 10, "e": 9, "a": {
        "1": "https://github.com/macro-inc/macro", "20": "claude", "21": "m", "23": "x", "24": "s_abc",
    }, "v": {"0": 600, "1": input, "7": cost, "10": seq}})
}

#[tokio::test]
async fn token_buckets_count_only_their_newest_revision() {
    let (service, _, index, metrics) = service();
    let credential = mint(&service).await;
    for (seq, input, cost) in [
        (1, 100, 1_000),
        (3, 250, 2_500),
        (2, 999, 9_999),
        (4, 200, 2_000),
    ] {
        let body = serde_json::to_vec(&json!({"v": 1, "events": [token_event(seq, input, cost)]}))
            .unwrap();
        service
            .ingest_metrics(&device(&service, &credential).await, &headers(), &body)
            .await
            .unwrap();
    }

    let tokens = index.state.lock().unwrap().sessions["s_abc"].tokens;
    assert_eq!((tokens.input, tokens.cost_micro_usd), (200, 2_000));
    // Counters only grow: 100, then +150; the stale and downward revisions add nothing.
    let input_counted: u64 = metrics
        .all()
        .iter()
        .filter_map(|m| match m {
            Metric::Tokens {
                kind: TokenKind::Input,
                count,
                ..
            } => Some(*count),
            _ => None,
        })
        .sum();
    assert_eq!(input_counted, 250);
}

#[tokio::test]
async fn session_first_and_last_seen_widen_across_batches() {
    let (service, _, index, _) = service();
    let credential = mint(&service).await;
    let line = |t: u64, text: &str| {
        json!({"t": t, "e": 5, "a": {
        "1": "https://github.com/macro-inc/macro", "20": "claude", "23": "x", "24": "s_abc",
    }, "v": {"0": {"text": text}}})
    };
    for events in [
        vec![line(20, "b"), line(30, "c")],
        vec![line(10, "a")],
        vec![line(40, "d")],
    ] {
        let body = serde_json::to_vec(&json!({"v": 1, "events": events})).unwrap();
        service
            .ingest_metrics(&device(&service, &credential).await, &headers(), &body)
            .await
            .unwrap();
    }
    let state = index.state.lock().unwrap();
    let session = &state.sessions["s_abc"];
    assert_eq!(
        (session.first_seen, session.last_seen, session.event_count),
        (Some(10), Some(40), 4)
    );
    assert_eq!(state.chunks["s_abc"].len(), 3);
}

#[tokio::test]
async fn notes_are_stored_only_for_commits_of_the_repository() {
    let (service, objects, _, _) = service();
    let credential = mint(&service).await;
    service
        .ingest_metrics(
            &device(&service, &credential).await,
            &headers(),
            &fixture_body("metrics-upload-mixed.json"),
        )
        .await
        .unwrap();

    let known = "9237c8c1cdf2a07152059eaa8a61592efe1d1d86";
    let other = "c0b0ba0222e9126d7b87227a7853db620ddd449a";
    let body = serde_json::to_vec(&json!({"entries": [
        {"commit_sha": known, "content": format!("note password={}", "hunter2")},
        {"commit_sha": other, "content": "other repo note"},
        {"commit_sha": "not-hex", "content": "x"},
    ]}))
    .unwrap();
    let outcome = service
        .upload_notes(&device(&service, &credential).await, &headers(), &body)
        .await
        .unwrap();
    assert_eq!(
        outcome,
        NotesUploadOutcome {
            success_count: 1,
            failure_count: 2
        }
    );
    assert!(!objects.all_text().contains("other repo note"));

    let notes = service
        .read_notes(
            &device(&service, &credential).await,
            &headers(),
            &format!("{known},{other}"),
        )
        .await
        .unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[known], "note password=[REDACTED:password_assignment]");
}

#[tokio::test]
async fn the_recorded_notes_upload_stores_nothing_for_unknown_commits() {
    let (service, objects, _, _) = service();
    let credential = mint(&service).await;
    let outcome = service
        .upload_notes(
            &device(&service, &credential).await,
            &headers(),
            &fixture_body("notes-upload.json"),
        )
        .await
        .unwrap();
    assert_eq!(outcome.success_count, 0);
    assert!(outcome.failure_count > 0);
    assert!(objects.objects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn releases_offer_the_pinned_version_on_every_channel() {
    let (service, _, _, _) = service();
    let credential = mint(&service).await;
    let channels = service
        .releases(&device(&service, &credential).await, &headers())
        .await
        .unwrap();
    assert_eq!(channels.len(), 4);
    assert!(
        channels
            .values()
            .all(|c| c.version == "v1.7.6" && c.checksum == PINNED_SHA256SUMS_CHECKSUM)
    );
    assert!(matches!(
        service
            .authenticate_client(Endpoint::Releases, None, &headers())
            .await,
        Err(GitaiError::Unauthorized)
    ));
}

#[test]
fn release_downloads_redirect_to_the_pinned_github_release() {
    assert_eq!(
        release_download_url("latest", "SHA256SUMS").unwrap(),
        "https://github.com/git-ai-project/git-ai/releases/download/v1.7.6/SHA256SUMS"
    );
    assert!(release_download_url("latest", "install.sh").is_ok());
    for (channel, file) in [
        ("nightly", "install.sh"),
        ("latest", "../x"),
        ("latest", ".hidden"),
        ("latest", ""),
    ] {
        assert!(matches!(
            release_download_url(channel, file),
            Err(GitaiError::NotFound)
        ));
    }
}

#[tokio::test]
async fn cas_objects_are_acknowledged_and_not_stored() {
    let (service, objects, _, _) = service();
    let credential = mint(&service).await;
    let body =
        serde_json::to_vec(&json!({"objects": [{"hash": "h1", "content": {"messages": []}}]}))
            .unwrap();
    let hashes = service
        .accept_cas(&device(&service, &credential).await, &headers(), &body)
        .await
        .unwrap();
    assert_eq!(hashes, vec!["h1"]);
    assert!(objects.objects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_retry_after_a_partial_index_failure_applies_session_counters_once() {
    let (service, _, index, metrics) = service();
    let credential = mint(&service).await;
    let identity = device(&service, &credential).await;
    let session = "s_cccccccccccccc";
    let body = serde_json::to_vec(&json!({
        "v": 1,
        "events": [
            crate::read_fakes::session_event(session, 1_794_543_002, 2),
            crate::read_fakes::session_event(session, 1_794_543_001, 1),
            crate::read_fakes::token_usage(session, 1_000, 200, 1_500_000),
        ],
    }))
    .unwrap();

    // The transcript's session update and chunk succeed; the token bucket's
    // session update fails, so the client retries the whole batch.
    index.state.lock().unwrap().fail_session_update = Some(2);
    let first = service.ingest_metrics(&identity, &headers(), &body).await;
    assert!(matches!(first, Err(GitaiError::Internal(_))));
    for _ in 0..2 {
        service
            .ingest_metrics(&identity, &headers(), &body)
            .await
            .unwrap();
    }

    let state = index.state.lock().unwrap();
    let stored = &state.sessions[session];
    assert_eq!(stored.event_count, 2);
    assert_eq!(stored.tokens.input, 1_000);
    assert_eq!(stored.tokens.cost_micro_usd, 1_500_000);
    let input_tokens: u64 = metrics
        .all()
        .iter()
        .filter_map(|metric| match metric {
            Metric::Tokens {
                kind: TokenKind::Input,
                count,
                ..
            } => Some(*count),
            _ => None,
        })
        .sum();
    assert_eq!(input_tokens, 1_000);
}
