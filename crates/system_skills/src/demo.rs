//! Demo system skill with obviously observable behavior, for verifying the
//! system skill plumbing end-to-end (menu, search, listing, and ReadContent).

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "Demo Skill";

static INSTRUCTIONS: &str = r##"Follow this skill when the user references the Demo Skill. It exists to make skill-following visible, so its rules are deliberately conspicuous.

- Start your reply with the exact line: `Demo skill active.`
- Answer the user's request in exactly three bullet points.
- End with a one-line summary prefixed with `Summary:`.

Apply these rules only to the reply that invoked the skill, not to the rest of the conversation.
"##;

static INTENT: &str = "Replies that invoke the demo skill start with \"Demo skill active.\", answer in exactly \
     three bullets, and end with a \"Summary:\" line.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The demo system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "demo",
    name: "Demo Skill",
    content: &PROMPT,
};
