//! RegExp-subclass URL matching with the shared linkify-it implementation.
use lexical_markdown::{Result, matcher::*};
use lexical_model::Utf16Offset;
use lexical_rich_nodes::utils::linkify::LinkifyIt;
use std::sync::LazyLock;
#[derive(Debug)]
pub(super) struct AutoLinkMatcher {
    linkifier: LinkifyIt,
    escaped: bool,
}
static COMMON_TLD_LINKIFIER: LazyLock<LinkifyIt> = LazyLock::new(|| {
    let mut linkifier = LinkifyIt::default();
    let tlds = [
        "app", "biz", "ca", "co", "com", "dev", "edu", "gov", "info", "io", "me", "net", "org",
        "shop", "site", "store", "tv", "uk", "us", "xyz",
    ]
    .map(str::to_owned);
    linkifier
        .tlds(&tlds, false)
        .expect("source common TLD expressions");
    linkifier
});
impl AutoLinkMatcher {
    pub(super) fn new(escaped: bool) -> Result<Self> {
        Ok(Self {
            linkifier: COMMON_TLD_LINKIFIER.clone(),
            escaped,
        })
    }
}
impl Matcher for AutoLinkMatcher {
    fn exec(&self, source: &str) -> Option<Match> {
        let units: Vec<u16> = source.encode_utf16().collect();
        if self.escaped {
            if !units.contains(&92) {
                return None;
            }
            let mut offsets = Vec::new();
            let mut decoded = Vec::new();
            let mut i = 0;
            while i < units.len() {
                offsets.push(i);
                if units.get(i) == Some(&92)
                    && units
                        .get(i + 1)
                        .is_some_and(|u| matches!(*u, 33..=47 | 58..=64 | 91..=96 | 123..=126))
                {
                    i += 1;
                }
                decoded.push(*units.get(i)?);
                i += 1;
            }
            offsets.push(units.len());
            let decoded = String::from_utf16(&decoded).ok()?;
            for link in self.linkifier.matches(&decoded) {
                if !matches!(link.schema.as_str(), "" | "http:" | "https:" | "mailto:") {
                    continue;
                }
                let start = *offsets.get(link.index)?;
                let end = *offsets.get(link.last_index)?;
                let raw = String::from_utf16(units.get(start..end)?).ok()?;
                if raw == link.text {
                    continue;
                }
                return Match::new(
                    Utf16Offset(start as u32),
                    source,
                    vec![Some(raw), Some(link.text)],
                )
                .ok();
            }
            return None;
        }
        for link in self.linkifier.matches(source) {
            if !matches!(link.schema.as_str(), "" | "http:" | "https:" | "mailto:") {
                continue;
            }
            if link.raw.contains('\\')
                || units.get(link.last_index) == Some(&92)
                || link.index.checked_sub(1).and_then(|i| units.get(i)) == Some(&92)
            {
                continue;
            }
            let bracketed = link.index > 0
                && units.get(link.index - 1) == Some(&60)
                && units.get(link.last_index) == Some(&62);
            let start = link.index - usize::from(bracketed);
            let end = link.last_index + usize::from(bracketed);
            let raw = String::from_utf16(units.get(start..end)?).ok()?;
            let url = if link.schema.is_empty() {
                format!("https://{}", link.raw)
            } else {
                link.url
            };
            return Match::new(
                Utf16Offset(start as u32),
                source,
                vec![Some(raw), Some(url), Some(link.text)],
            )
            .ok();
        }
        None
    }
}
