//! System skill for catching the user up on messages and activity they missed.

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "Catch Me Up";

static INSTRUCTIONS: &str = r##"Follow this skill when the user asks to catch up on what they missed — unread messages, new activity, or what happened while they were away.

## Gather what they missed

Run these lookups, in parallel where possible:

1. `ListNotifications` with `seen: false` for unseen notifications, and once more with no filters for recent context. Notifications are the primary "what needs my attention" signal.
2. `ListEntities` sorted by `recently_updated` for workspace activity (documents, channels, emails, calls) since the user was last active. If the user gives a window ("since Friday", "this morning"), apply it with `df`/`ef` updatedAt bounds; otherwise default to the last 24 hours.
3. `ListEntities` with `emailPreset: "signal"` for important unread email threads.

For each channel or thread that surfaced, read just enough to summarize accurately: `ReadChannelMessages` / `ReadChannelThread` for channels, `ReadThread` for emails. Do not read items the user has clearly already handled.

## Report

Present a prioritized briefing, most important first:

1. **Needs your response** — direct mentions, questions addressed to the user, and threads blocked on them. Cite who is asking and what they need.
2. **Worth knowing** — decisions made, announcements, and important emails, one line each.
3. **Everything else** — a one-line roll-up per channel ("#design: 12 messages about the icon refresh").

Link every item you mention so the user can jump in. Keep the whole briefing scannable — lead with counts ("3 things need you, 5 worth a look"), never a wall of prose.

End by offering to mark the covered notifications as seen (`MarkNotificationsSeen`); only do so if the user says yes.
"##;

static INTENT: &str = "Catch-up requests produce a prioritized, linked briefing — needs-response first, \
     then notable activity, then per-channel roll-ups — built from unseen notifications and recent \
     workspace activity.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The catch-me-up system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "catch-me-up",
    name: "Catch Me Up",
    content: &PROMPT,
};
