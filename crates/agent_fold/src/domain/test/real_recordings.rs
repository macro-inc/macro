//! The fold against real, sanitized recordings, not just hand-shaped fixtures.
//!
//! [`fold.rs`](super::fold) and [`machine.rs`](super::machine) pin behavior
//! against [`TURN`], which is hand-shaped to exercise one of everything in a
//! small space. That is precise but it is not evidence the fold survives
//! contact with a real harness: real traffic streams chunks unevenly,
//! interleaves tool calls, and - as `resumed_no_prompt` exists to prove -
//! sometimes has no prompt in it at all. These fixtures are real ACP traffic
//! (sanitized; see `scripts/sanitize_recording.py`), committed so that
//! evidence lives in CI rather than only on whoever's machine happened to
//! record a session.

use super::util::{
    LONG_MULTI_RESUME, REAL_MULTI_TURN, REAL_SINGLE_TURN, RESUMED_AND_CONTINUED, RESUMED_NO_PROMPT,
    capturing_warnings, parse_log,
};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::model::{Author, FoldedMessage};
use crate::domain::ports::FoldMachine;

/// Every real fixture, alongside how many of its messages are expected to be
/// unauthored by a user - the count `resumed_no_prompt` exists to make
/// nonzero. Folding must not warn on any of them: a warning here means the
/// fold no longer understands a shape a real harness actually sent.
const REAL_FIXTURES: &[(&str, &str)] = &[
    ("real_single_turn", REAL_SINGLE_TURN),
    ("real_multi_turn", REAL_MULTI_TURN),
    ("resumed_and_continued", RESUMED_AND_CONTINUED),
    ("resumed_no_prompt", RESUMED_NO_PROMPT),
    ("long_multi_resume", LONG_MULTI_RESUME),
];

#[test]
fn every_real_fixture_folds_without_warnings() {
    for (name, recording) in REAL_FIXTURES {
        let (messages, warnings) = capturing_warnings(|| fold(parse_log(recording)));
        assert_eq!(warnings, vec![], "{name} folded with a warning");
        assert!(!messages.is_empty(), "{name} folded to nothing");
        for message in &messages {
            assert!(
                !message.parts.is_empty(),
                "{name} folded an empty message: {message:?}"
            );
        }
    }
}

/// The regression pin: a log that opens with `session/load` and carries no
/// `session/prompt` still derives the agent's side. Before
/// `begin_turn_without_prompt`, every frame in a log shaped like this had no
/// open turn to belong to, and the fold silently derived nothing - see that
/// function's docs.
#[test]
fn resumed_no_prompt_still_derives_the_agents_reply() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(RESUMED_NO_PROMPT)));

    assert_eq!(warnings, vec![], "a clean recording should not warn");
    assert!(
        !messages.is_empty(),
        "a log with real agent content folded to nothing - the regression is back"
    );
    assert!(
        messages
            .iter()
            .any(|message| message.author == Author::Agent),
        "no agent message was derived from a log that is nothing but agent content: {messages:#?}"
    );
    assert!(
        !messages
            .iter()
            .any(|message| message.author.kind() == crate::domain::model::AuthorKind::User),
        "this recording carries no session/prompt, so it should derive no user message"
    );
}

/// A resumed session that goes on to take fresh prompts in the same log: the
/// turn that resumed with no prompt of its own, and the turns that follow it
/// with real prompts, must both derive correctly in one fold. Neither the
/// pure-resume nor the pure-fresh-session fixtures cover this mix.
#[test]
fn resumed_and_continued_derives_both_the_resumed_and_the_fresh_turns() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(RESUMED_AND_CONTINUED)));

    assert_eq!(warnings, vec![]);
    let user_messages = messages
        .iter()
        .filter(|message| message.author.kind() == crate::domain::model::AuthorKind::User)
        .count();
    let agent_messages = messages
        .iter()
        .filter(|message| message.author == Author::Agent)
        .count();
    assert!(
        agent_messages > user_messages,
        "the resumed turn has an agent side but no prompt of its own, so agent \
         messages ({agent_messages}) should outnumber user messages ({user_messages})"
    );
}

/// The property the incremental rework rests on ([`super::machine`] pins it
/// against `TURN`), reproduced against real traffic: pushing a real
/// recording frame by frame through [`FoldMachineImpl`] must derive exactly
/// what folding it in one go derives. Real logs are what actually flows
/// through the streaming path in production, so this is where that
/// equivalence matters most.
#[test]
fn streaming_a_real_recording_matches_folding_it() {
    for (name, recording) in REAL_FIXTURES {
        let log = parse_log(recording);
        let (batch, _) = capturing_warnings(|| fold(log.clone()));

        let (streamed, warnings) = capturing_warnings(|| {
            let mut machine = FoldMachineImpl::new();
            for entry in log {
                let _ = machine.push(entry);
            }
            machine.into_messages()
        });

        assert_eq!(warnings, vec![], "{name} warned while streaming");
        assert_eq!(
            streamed, batch,
            "{name}: streaming frame by frame diverged from folding in one go"
        );
    }
}

/// What only `long_multi_resume` can prove: turn numbering stays unique
/// across three separate `session/load` boundaries in one fold, not just
/// one. `TurnId` is a single counter for the whole fold
/// ([`State::turns_opened`](crate::domain::fold::State)) rather than
/// anything that resets per resume, but a log with only one resume - like
/// `resumed_no_prompt` - cannot tell that apart from a counter that happens
/// to reset correctly the one time it is asked to. Three resumes in one log
/// can: a reset-per-resume bug would collide the second and third resumed
/// turn onto ids the first one already used.
#[test]
fn three_resumes_in_one_log_derive_distinct_message_ids() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(LONG_MULTI_RESUME)));

    assert_eq!(warnings, vec![]);
    assert!(
        messages.len() > 100,
        "106 prompts should derive well over 100 messages, got {}",
        messages.len()
    );

    let ids: std::collections::HashSet<_> = messages.iter().map(FoldedMessage::id).collect();
    assert_eq!(
        ids.len(),
        messages.len(),
        "every message should have a distinct (turn, author) key - a collision \
         means turn numbering reset somewhere across the three resumes"
    );
}

/// What each small-to-medium real fixture actually folds to, pinned whole
/// rather than checked field by field.
///
/// The tests above assert specific invariants (no warnings, distinct ids,
/// streaming parity) that stay meaningful as fixtures are added; this is the
/// other kind of coverage, for when the shape of a real recording's output
/// itself needs to be pinned - which grows with every new fixture, so it is
/// `insta` rather than another hand-written `assert_eq!` block.
/// `long_multi_resume` sits out: at 106 turns its snapshot would be enormous
/// and the tests above already cover what it uniquely proves.
#[test]
fn real_fixtures_fold_to_their_pinned_snapshot() {
    for (name, recording) in REAL_FIXTURES {
        if *name == "long_multi_resume" {
            continue;
        }
        let (messages, warnings) = capturing_warnings(|| fold(parse_log(recording)));
        assert_eq!(warnings, vec![], "{name} folded with a warning");
        insta::assert_debug_snapshot!(*name, messages);
    }
}
