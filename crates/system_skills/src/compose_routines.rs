//! System skill for writing a routine, or changing one, from a conversation.
//!
//! It comes after the routines guide, which already says what a routine is,
//! the events a trigger starts on and how a schedule names weekdays. This
//! module adds how a session finds the items a request names, writes and
//! checks the routine, saves it and answers, then how its steps use items
//! and message the owner, then `routine_program::CODE_STEPS`. The skill
//! ([`PROMPT`]) says that for code, then briefly for the routine tools;
//! [`CODE`] leaves out the routine-tools part, for code mode, and [`DIRECT`]
//! is the routine-tools part alone, for hosts without code, without the
//! code-step contract `CreateRoutine`'s description carries.

use prompt::{ComposedPrompt, StaticPrompt};

use crate::SystemSkill;

static TITLE: &str = "Compose Routines";

static INSTRUCTIONS: &str = include_str!("compose_routines/instructions.md");

static INTENT: &str = "A request for a routine, or a change to one, becomes a checked routine in as few \
     programs as possible: the items it names found by name with the SDK or asked about, triggers \
     that fit the work, code steps that act and decide and at most one Ask AI step, saved switched \
     on and reported in a sentence or two with its link.";

static SESSION: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

static DIRECT_INSTRUCTIONS: &str = include_str!("compose_routines/without_code.md");

static WITHOUT_CODE: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Without code",
    DIRECT_INSTRUCTIONS,
    "A session that can't run programs saves the routine with the routine tools.",
);

static STEPS_INSTRUCTIONS: &str = include_str!("compose_routines/steps.md");

static STEPS: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Steps and the items they use",
    STEPS_INSTRUCTIONS,
    "Code steps unless the work needs AI with tools, the owner told by an Ask AI step, and items \
     named in knobs and by name and id elsewhere.",
);

static CODE_STEPS: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Code steps",
    routine_program::CODE_STEPS,
    "How to write a code step, the same text CreateRoutine and the drafter read.",
);

static WRITING: ComposedPrompt = STEPS.compose(&CODE_STEPS);

static SESSION_WITHOUT_CODE: ComposedPrompt = SESSION.compose(&WITHOUT_CODE);

/// The skill as code mode carries it after the routines guide: how a
/// code-mode session finds, checks, saves and reports a routine, then how its
/// steps are written, without the routine-tools part it has no tools for.
pub static CODE: ComposedPrompt = SESSION.compose(&WRITING);

/// The skill's instructions as a composable prompt section: how a code-mode
/// session finds, checks, saves and reports a routine, what a session without
/// code does instead, then how its steps are written.
pub static PROMPT: ComposedPrompt = SESSION_WITHOUT_CODE.compose(&WRITING);

/// The compose-routines system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "compose-routines",
    name: "Compose Routines",
    content: &PROMPT,
};

static DIRECT_INTENT: &str = "A request for a routine, or a change to one, is saved with the routine \
     tools in one call when nothing is unsettled, and reported in a sentence or two.";

static DIRECT_SESSION: StaticPrompt<'static> =
    StaticPrompt::borrowed(TITLE, DIRECT_INSTRUCTIONS, DIRECT_INTENT);

/// The skill as hosts that save routines with the routine tools carry it
/// after the routines guide: its without-code part, then how steps use items
/// and tell the owner, short of the code-step contract `CreateRoutine`'s
/// description carries.
pub static DIRECT: ComposedPrompt = DIRECT_SESSION.compose(&STEPS);
