//! Prompts for the Slack onboarding gather fallback.
//!
//! Gather sessions stage candidates through the `CreateImportEntity` tool —
//! there is no structured output to parse; the tool IS the output channel.
//! Only Slack reaches an agent, when its typed workspace reads fail during
//! onboarding: Linear and Notion discovery read their APIs directly, and no
//! model reads or converts imported content.

/// System prompt for a Slack gather session.
pub fn gather_system() -> String {
    let (what, foreign_id_rule, metadata_hint, search_strategy) = (
        "the Slack channels the user is most active in",
        "the Slack channel id (e.g. `C0123456789`); fall back to the channel name",
        "name (without the leading #), channel_id, purpose, participants (name + email when \
             available)",
        "Slack-specific discovery strategy:\n\
             - FIRST call `Search channels` with an explicitly empty search string: \
             `{\"query\": \"\"}`. For this Slack MCP tool, an empty query lists all channels the \
             connected user can see. Do not substitute `active`, `recent`, `all`, or `*`.\n\
             - Follow the result's pagination cursor when one is present until you have enough \
             candidates or there are no more pages.\n\
             - Prefer channels whose names, topics, or purposes indicate substantive work. You \
             may use one broad `Search messages & files` call afterward to rank the enumerated \
             channels by recent activity, but do not use message search as a prerequisite for \
             discovering that a channel exists.\n\
             - Participant details are optional. Do not drop a channel merely because member \
             names or emails are unavailable.",
    );
    format!(
        "You are discovering {what} so they can be imported into Macro, the user's new \
         workspace.\n\
         \n\
         Use the connected tools to find 8-15 strong candidates: recently active, substantive, \
         and clearly relevant to the user's own work. Prefer one or two broad searches/list \
         calls over many narrow ones. Pass only parameters the tool's schema supports; if a call \
         fails validation, fix the arguments and retry once.\n\
         {search_strategy}\n\
         \n\
         For EACH candidate, call `CreateImportEntity` once with:\n\
         - `foreign_id`: {foreign_id_rule}\n\
         - `metadata`: {metadata_hint}\n\
         \n\
         The tool response tells you when an item was already imported by the user or a \
         teammate, or previously declined — do not re-stage those, just move on.\n\
         \n\
         When you are done staging, reply with one short plain-text sentence summarizing what \
         you staged. Do not output JSON."
    )
}

/// User message opening a Slack gather session.
pub fn gather_prompt() -> &'static str {
    "Find the Slack channels I'm most active in and stage them for import."
}
