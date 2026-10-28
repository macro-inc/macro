//! Pinned Unicode reactions with raw-email actor mapping, never live side effects.

use std::{collections::BTreeMap, sync::LazyLock};

use crate::domain::models::{HistoricalReaction, SlackTimestamp};

use super::{export::ExportReaction, users::UserDirectory};

#[cfg(test)]
mod test;

static SHORTCODES: LazyLock<BTreeMap<&'static str, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../data/emoji-shortcodes.json"))
        .expect("checked-in generated shortcode map must be valid JSON")
});

/// Resolve a Slack name, stripping only valid skin-tone suffixes. Unknown/custom
/// names and standalone skin tones have no fallback reaction. Optional surrounding
/// colons are accepted, but arbitrary colon-separated names are not truncated.
pub fn shortcode(name: &str) -> Option<&'static str> {
    let mut name = name;
    if let Some(inner) = name.strip_prefix(':').and_then(|s| s.strip_suffix(':')) {
        name = inner;
    }
    while let Some((base, tone)) = name.rsplit_once("::skin-tone-") {
        if !matches!(tone, "2" | "3" | "4" | "5" | "6") {
            return None;
        }
        name = base;
    }
    SHORTCODES.get(name).map(String::as_str)
}

/// Convert one message's reactions. Actor lists, not Slack's advisory counts, are
/// authoritative. Deduplication happens after both shortcode and email mapping;
/// the earliest supplied/fallback timestamp wins independently of input order.
/// Standard Slack archives have no reaction time, so use the exact message time.
pub fn convert(
    reactions: &[ExportReaction],
    users: &UserDirectory,
    message_time: SlackTimestamp,
) -> Vec<HistoricalReaction> {
    let mut converted: BTreeMap<(String, &str), HistoricalReaction> = BTreeMap::new();
    for reaction in reactions {
        let Some(emoji) = shortcode(&reaction.name) else {
            continue;
        };
        for user in &reaction.users {
            let Some(user_id) = users.participant(user) else {
                continue;
            };
            let created_at = reaction.ts.unwrap_or(message_time);
            let key = (user_id.as_ref().to_owned(), emoji);
            converted
                .entry(key)
                .and_modify(|existing| existing.created_at = existing.created_at.min(created_at))
                .or_insert_with(|| HistoricalReaction {
                    user_id,
                    emoji: emoji.to_owned(),
                    created_at,
                });
        }
    }
    converted.into_values().collect()
}
