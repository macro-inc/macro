//! Slack reaction names and the Unicode emoji Macro stores, from the
//! generated table in `data/emoji-shortcodes.json` (see `data/README.md`).

use std::{collections::BTreeMap, sync::LazyLock};

#[cfg(test)]
mod test;

static SHORTCODES: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../data/emoji-shortcodes.json"))
        .expect("checked-in generated shortcode map must be valid JSON")
});

/// One Slack name per emoji: the shortest alias, then the first in order.
static NAMES: LazyLock<BTreeMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut names: BTreeMap<&'static str, &'static str> = BTreeMap::new();
    for (name, emoji) in SHORTCODES.iter() {
        let (name, emoji) = (name.as_str(), emoji.as_str());
        names
            .entry(emoji)
            .and_modify(|chosen| {
                if name.len() < chosen.len() {
                    *chosen = name;
                }
            })
            .or_insert(name);
    }
    names
});

/// The Unicode emoji for a Slack name, stripping only valid skin-tone
/// suffixes. Unknown and workspace-custom names, and standalone skin tones,
/// have none. Optional surrounding colons are accepted, but arbitrary
/// colon-separated names are not truncated.
pub fn unicode(name: &str) -> Option<&'static str> {
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

/// The Slack name for a Unicode emoji from the table, if it has one.
pub fn name(emoji: &str) -> Option<&'static str> {
    NAMES.get(emoji).copied()
}
