//! System skill teaching the AI how to write effective Macro skills.

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "Skill Authoring Guide";

static INSTRUCTIONS: &str = r##"Follow this guide when the user asks for help writing or improving a skill.

Skills are markdown documents containing instructions the AI reads and follows when the skill is referenced in a request. A good skill:

- Opens with one sentence stating when the skill applies, so it can be judged relevant without reading the whole document.
- States concrete steps and rules, not aspirations. "Run `just prepare_db` after editing SQL" beats "keep the query cache up to date".
- Includes worked examples of correct output when format matters.
- Names its inputs: which documents, tools, or context the AI should gather before starting.
- Stays single-purpose. Split unrelated workflows into separate skills so search finds the right one.

Structure the skill with a short intro, then `##` sections in execution order. Keep it under a page; link out to reference documents for background instead of inlining them.
"##;

static INTENT: &str = "The AI writes skills that open with an applicability sentence, give concrete \
     single-purpose instructions in execution order, and stay under a page.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The skill authoring system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "skill-authoring-guide",
    name: "Skill Authoring Guide",
    content: &PROMPT,
};
