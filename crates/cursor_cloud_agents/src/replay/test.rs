//! The corpus sweep: every recorded run, replayed and pinned.
//!
//! Inputs are discovered with [`insta::glob!`] over `fixtures/real/`, so
//! adding a fixture means dropping a sanitized `.sse` there — no
//! registration anywhere. What each fixture uniquely covers is documented in
//! `fixtures/real/README.md`.
//!
//! Two kinds of coverage live here, and they age differently. The invariant
//! sweeps (no unknown vocabulary, chunking-invariance) stay meaningful as the
//! corpus grows, because every new recording is another chance to violate
//! them. The snapshots pin what a specific recording translates to, which is
//! what catches an unintended change in the translation itself.

use super::*;
use crate::domain::event::InteractionUpdate;
use crate::testing::fixture_sse;
use agent_client_protocol::schema::v1::ToolCallStatus;

/// Run `body` on every recorded fixture, as `(name, raw sse)`.
fn for_each_fixture(body: impl Fn(&str, &str)) {
    insta::glob!("../../fixtures/real", "*.sse", |path| {
        let sse = std::fs::read_to_string(path).expect("fixture is readable");
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .expect("fixture has a utf-8 name");
        body(name, &sse);
    });
}

/// The read sizes each fixture is replayed at.
///
/// One byte at a time is the pathological case that catches a decoder
/// buffering bug — every record, and every multi-byte character, split at
/// every possible boundary. The middling sizes land boundaries mid-line and
/// mid-record at sizes a real socket plausibly produces; `usize::MAX` is the
/// whole file in one push.
const CHUNK_SIZES: &[usize] = &[1, 3, 17, 64, 997, 8192, usize::MAX];

/// Framing must not depend on how the bytes were split across reads.
///
/// This is the property that lets the corpus store plain `.sse` text instead
/// of a faithful recording of chunk boundaries: if decoding is invariant
/// under every split, the split history a recording would have preserved
/// carries no information.
#[test]
fn decoding_is_invariant_under_chunking() {
    for_each_fixture(|name, sse| {
        let expected = chunked(sse, usize::MAX);
        assert!(!expected.is_empty(), "{name} decoded to no records at all");
        for &size in CHUNK_SIZES {
            assert_eq!(
                chunked(sse, size),
                expected,
                "{name} decoded differently at {size}-byte reads"
            );
        }
    });
}

/// Every record in every recording must be vocabulary the crate names.
///
/// A hit here is the alarm this corpus exists to raise: Cursor sent an event
/// this crate does not model, and the live path silently dropped it (see
/// [`TranslateMachine::push`]'s `Unknown` arm). It is also the alarm for a
/// payload whose *shape* drifted, since `from_wire` degrades a known event
/// with an unreadable body to `Unknown` rather than erroring.
#[test]
fn no_fixture_contains_unknown_events() {
    for_each_fixture(|name, sse| {
        let unknown: Vec<_> = events(sse)
            .into_iter()
            .filter_map(|event| match event {
                CursorEvent::Unknown { event, .. } => Some(event),
                _ => None,
            })
            .collect();
        assert!(
            unknown.is_empty(),
            "{name} contains events this crate does not model: {unknown:?}"
        );
    });
}

/// The `interaction_update` subtypes the corpus has actually seen.
///
/// Pinned as a list rather than asserted empty because most subtypes
/// legitimately carry nothing the documented events do not, so
/// [`InteractionUpdate::Other`] is the correct home for them. The point of
/// pinning is that a *new* subtype shows up as a diff to read — at which
/// point the question is whether it carries something worth translating —
/// instead of vanishing into the catch-all unnoticed.
#[test]
fn interaction_subtypes_are_pinned() {
    let mut kinds = std::collections::BTreeSet::new();
    for entry in std::fs::read_dir(crate::testing::fixtures_dir()).expect("corpus is readable") {
        let path = entry.expect("readable dir entry").path();
        if path.extension().is_none_or(|extension| extension != "sse") {
            continue;
        }
        let sse = std::fs::read_to_string(&path).expect("fixture is readable");
        for event in events(&sse) {
            if let CursorEvent::Interaction(update) = event {
                kinds.insert(match update {
                    InteractionUpdate::UserMessage { .. } => "user-message-appended".to_owned(),
                    InteractionUpdate::ToolCallStarted { .. } => "tool-call-started".to_owned(),
                    InteractionUpdate::ToolCallCompleted { .. } => "tool-call-completed".to_owned(),
                    InteractionUpdate::TokenDelta { .. } => "token-delta".to_owned(),
                    InteractionUpdate::Other { kind } => format!("(other) {kind}"),
                });
            }
        }
    }
    insta::assert_debug_snapshot!(kinds.iter().collect::<Vec<_>>());
}

/// Translation must not depend on chunking either — the property above,
/// carried through the two stages downstream of the decoder.
#[test]
fn translation_is_invariant_under_chunking() {
    for_each_fixture(|name, sse| {
        let expected = updates(sse);
        for &size in CHUNK_SIZES {
            let mut machine = TranslateMachine::new();
            let actual: Vec<_> = chunked(sse, size)
                .into_iter()
                .map(|record| {
                    let data =
                        serde_json::from_str(&record.data).unwrap_or(serde_json::Value::Null);
                    CursorEvent::from_wire(&record.event, data)
                })
                .flat_map(|event| machine.push(event))
                .collect();
            assert_eq!(
                serde_json::to_value(&actual).expect("updates serialize"),
                serde_json::to_value(&expected).expect("updates serialize"),
                "{name} translated differently at {size}-byte reads"
            );
        }
    });
}

/// A stream that stops early must still translate what it got.
///
/// Truncation is not hypothetical: a dropped connection ends a run's stream
/// wherever it happens to be, including mid-record. Derived from the real
/// corpus rather than stored as its own fixture, so it covers every
/// recording's shape instead of one hand-picked cut.
#[test]
fn truncated_recordings_still_translate() {
    for_each_fixture(|name, sse| {
        for fraction in [1, 2, 3, 5, 7] {
            let cut = sse.len() * fraction / 8;
            // Truncate on a character boundary; the cut itself is arbitrary.
            let truncated = match sse.is_char_boundary(cut) {
                true => &sse[..cut],
                false => continue,
            };
            let records = chunked(truncated, usize::MAX);
            let updates = updates(truncated);
            // The prefix's records are a prefix of the whole file's: a
            // partial trailing record stays buffered rather than emitting
            // something half-decoded.
            assert!(
                chunked(sse, usize::MAX).starts_with(&records),
                "{name} at {fraction}/8 decoded records the full file does not"
            );
            assert!(
                updates.len() <= self::updates(sse).len(),
                "{name} at {fraction}/8 translated more updates than the whole file"
            );
        }
    });
}

/// Every tool call a real run announced, with the kind it was classified as.
///
/// Kind inference is the crate's most guess-shaped logic — a token table over
/// tool names, refined by Cursor's typed descriptor when one arrives — so the
/// corpus's actual verdicts are worth reading as a list. A misclassification
/// shows up here as a diff naming the tool.
#[test]
fn tool_calls_and_their_kinds_are_pinned() {
    for_each_fixture(|_, sse| {
        let calls: Vec<String> = updates(sse)
            .iter()
            .filter_map(|update| match update {
                SessionUpdate::ToolCall(call) => Some(format!(
                    "tool_call {:?} kind={:?} status={:?}",
                    call.title, call.kind, call.status
                )),
                SessionUpdate::ToolCallUpdate(update) => Some(format!(
                    "  update   {:?} kind={:?} status={:?}",
                    update.fields.title, update.fields.kind, update.fields.status
                )),
                _ => None,
            })
            .collect();
        insta::assert_debug_snapshot!(calls);
    });
}

/// What each recording translates to, pinned whole rather than field by
/// field — the regression net for the translation itself.
#[test]
fn fixtures_translate_to_their_pinned_snapshot() {
    for_each_fixture(|_, sse| {
        insta::assert_json_snapshot!(updates(sse));
    });
}

/// The agent-visible prose of each run, as one readable block.
///
/// The snapshot above pins the exact update sequence, which is precise but
/// unreadable at 100 chunks per run. This is the same data as a human reads
/// it: reviewing a corpus addition means checking the agent actually said
/// something sensible, and that is impossible to see in a wall of
/// single-token chunks.
#[test]
fn fixtures_reassemble_into_readable_transcripts() {
    for_each_fixture(|_, sse| {
        let mut transcript = String::new();
        let mut last_kind = "";
        for update in updates(sse) {
            let (kind, text) = match &update {
                SessionUpdate::AgentMessageChunk(chunk) => ("assistant", chunk_text(chunk)),
                SessionUpdate::AgentThoughtChunk(chunk) => ("thinking", chunk_text(chunk)),
                _ => continue,
            };
            let Some(text) = text else { continue };
            if kind != last_kind {
                transcript.push_str(&format!("\n--- {kind} ---\n"));
                last_kind = kind;
            }
            transcript.push_str(&text);
        }
        insta::assert_snapshot!(transcript);
    });
}

/// The text of a content chunk, when it is a text block.
fn chunk_text(chunk: &agent_client_protocol::schema::v1::ContentChunk) -> Option<String> {
    match &chunk.content {
        agent_client_protocol::schema::v1::ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

/// The legacy hand-converted fixtures still carry what they were kept for:
/// `thinking_only` is a stream captured with no terminal `result` or `done`,
/// which every live-recorded fixture has.
#[test]
fn thinking_only_has_no_terminal_events() {
    let events = events(&fixture_sse("thinking_only.sse"));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, CursorEvent::Result { .. } | CursorEvent::Done)),
        "thinking_only is the no-terminal-events fixture; it grew one"
    );
    assert!(!updates(&fixture_sse("thinking_only.sse")).is_empty());
}

/// The corpus contains a genuinely failed tool call, and it reads as failed.
///
/// `read_and_search`'s `get_mcp_tools` call really did fail - "MCP tool
/// \"cursor-cloud-get-message-queue\" not found on server" - while Cursor
/// labelled it `completed`. This is the regression pin for reading the
/// result envelope rather than the status word.
#[test]
fn the_corpus_failed_tool_call_reads_as_failed() {
    let failed: Vec<String> = updates(&fixture_sse("read_and_search.sse"))
        .iter()
        .filter_map(|update| match update {
            SessionUpdate::ToolCall(call) if call.status == ToolCallStatus::Failed => {
                Some(call.title.clone())
            }
            SessionUpdate::ToolCallUpdate(update)
                if update.fields.status == Some(ToolCallStatus::Failed) =>
            {
                update.fields.title.clone()
            }
            _ => None,
        })
        .collect();
    assert!(
        failed.iter().any(|title| title == "get_mcp_tools"),
        "get_mcp_tools failed on the wire but no update reports Failed: {failed:?}"
    );
}

/// A forwarded MCP server really reached the cloud agent.
///
/// `mcp_servers.sse` was recorded with one HTTP MCP server configured through
/// `session/new` (`deepwiki`), and the agent's reply enumerates it as `ready`
/// alongside Cursor's own servers. That is the end-to-end evidence that
/// forwarding works: not that `POST /v1/agents` accepted the field, but that
/// the sandbox connected to the server and the model could see its tools.
#[test]
fn the_forwarded_mcp_server_is_visible_to_the_agent() {
    let transcript: String = updates(&fixture_sse("mcp_servers.sse"))
        .iter()
        .filter_map(|update| match update {
            SessionUpdate::AgentMessageChunk(chunk) => chunk_text(chunk),
            _ => None,
        })
        .collect();

    assert!(
        transcript.contains("deepwiki"),
        "the client-configured server is missing from the agent's own listing: {transcript}"
    );
    assert!(
        transcript.contains("ready"),
        "the forwarded server should be reported ready, not merely named"
    );
}
