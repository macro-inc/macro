//! The fold against real, sanitized recordings, not just hand-shaped fixtures.
//!
//! [`fold.rs`](super::fold) and [`machine.rs`](super::machine) pin behavior
//! against [`TURN`](super::util::TURN), which is hand-shaped to exercise one
//! of everything in a small space. That is precise but it is not evidence the
//! fold survives contact with a real harness: real traffic streams chunks
//! unevenly, interleaves tool calls, and - as `resumed_no_prompt` exists to
//! prove - sometimes has no prompt in it at all. These fixtures are real ACP
//! traffic (sanitized; see `scripts/sanitize_recording.py`), committed so
//! that evidence lives in CI rather than only on whoever's machine happened
//! to record a session.
//!
//! The sweep tests discover their inputs with [`insta::glob!`] over
//! `fixtures/real/`, so adding a fixture means dropping a sanitized `.jsonl`
//! there - no registration anywhere. What each fixture uniquely proves is
//! documented in `fixtures/real/README.md`; the tests below that pin a
//! specific fixture's shape name it by `include_str!`.

use super::util::{capturing_warnings, parse_log};
use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::model::{Author, FoldedMessage, MessagePart, PlanEntryStatus};
use crate::domain::ports::FoldMachine;
use crate::testing::fixtures::{
    LONG_MULTI_RESUME, PLAN_TODO, RESUMED_AND_CONTINUED, RESUMED_NO_PROMPT,
};

/// Run `body` on every real fixture. Folding must not warn on any of them: a
/// warning here means the fold no longer understands a shape a real harness
/// actually sent.
fn for_each_real_fixture(body: impl Fn(&str, &str)) {
    insta::glob!("../../../fixtures/real", "*.jsonl", |path| {
        let recording = std::fs::read_to_string(path).expect("fixture is readable");
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .expect("fixture has a utf-8 name");
        body(name, &recording);
    });
}

#[test]
fn every_real_fixture_folds_without_warnings() {
    for_each_real_fixture(|name, recording| {
        let (messages, warnings) = capturing_warnings(|| fold(parse_log(recording)));
        assert_eq!(warnings, vec![], "{name} folded with a warning");
        assert!(!messages.is_empty(), "{name} folded to nothing");
        for message in &messages {
            assert!(
                !message.parts.is_empty(),
                "{name} folded an empty message: {message:?}"
            );
        }
    });
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
            .filter(|message| message.author.kind() == crate::domain::model::AuthorKind::User)
            .flat_map(|message| message.parts.iter())
            .any(|part| matches!(part, crate::domain::model::MessagePart::Text { .. })),
        "this recording carries no session/prompt, so it should derive no user text"
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
    for_each_real_fixture(|name, recording| {
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
    });
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

/// A turn's plan folds to one part holding the list as it last stood, not a
/// trail of revisions: `plan_todo` carries eleven `plan` frames - the list
/// growing to three items and then completing one by one, each state
/// re-emitted unchanged at least once - and all of them must land in a
/// single part showing every item completed.
#[test]
fn plan_updates_replace_one_part_in_place() {
    let (messages, warnings) = capturing_warnings(|| fold(parse_log(PLAN_TODO)));

    assert_eq!(warnings, vec![], "plan frames should fold, not warn");
    let plans: Vec<_> = messages
        .iter()
        .flat_map(|message| message.parts.iter())
        .filter_map(|part| match part {
            MessagePart::Plan { entries } => Some(entries),
            _ => None,
        })
        .collect();
    let [plan] = plans.as_slice() else {
        panic!("eleven plan frames should fold to exactly one part, got {plans:#?}");
    };
    assert_eq!(
        plan.iter()
            .map(|entry| (entry.content.as_str(), entry.status))
            .collect::<Vec<_>>(),
        vec![
            ("a", PlanEntryStatus::Completed),
            ("b", PlanEntryStatus::Completed),
            ("c", PlanEntryStatus::Completed),
        ],
        "the part should hold the list as it last stood"
    );
}

/// The harness re-emits the plan unchanged between real changes: every one
/// of `plan_todo`'s six distinct plan states arrives twice, back to back. A
/// re-emit that changes nothing must report nothing, so the streaming path
/// does not fan a no-op out to every follower.
#[test]
fn identical_plan_re_emits_report_unchanged() {
    // Which log entries are plan frames, read off the raw lines - parse_log
    // maps non-empty lines to entries one to one.
    let is_plan: Vec<bool> = PLAN_TODO
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.contains(r#""sessionUpdate":"plan""#))
        .collect();
    let log = parse_log(PLAN_TODO);
    assert_eq!(is_plan.len(), log.len());
    assert_eq!(
        is_plan.iter().filter(|plan| **plan).count(),
        12,
        "the recording carries six states, each emitted twice"
    );

    let mut machine = FoldMachineImpl::new();
    let mut changed = 0;
    let mut unchanged = 0;
    for (entry, is_plan) in log.into_iter().zip(is_plan) {
        let events = machine.push(entry);
        if is_plan {
            if events.is_empty() {
                unchanged += 1;
            } else {
                changed += 1;
            }
        }
    }

    assert_eq!(changed, 6, "each distinct plan state reports one change");
    assert_eq!(unchanged, 6, "each verbatim re-emit reports nothing");
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
    for_each_real_fixture(|name, recording| {
        if name == "long_multi_resume" {
            return;
        }
        let (messages, warnings) = capturing_warnings(|| fold(parse_log(recording)));
        assert_eq!(warnings, vec![], "{name} folded with a warning");
        insta::assert_debug_snapshot!(messages);
    });
}

/// The metadata each real fixture derives, pinned whole like the messages.
#[test]
fn real_fixtures_derive_their_pinned_metadata() {
    for_each_real_fixture(|_, recording| {
        let mut machine = FoldMachineImpl::new();
        for entry in parse_log(recording) {
            let _ = machine.push(entry);
        }
        insta::assert_debug_snapshot!(machine.metadata());
    });
}
