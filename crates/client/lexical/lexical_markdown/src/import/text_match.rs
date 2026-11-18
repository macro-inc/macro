//! Ordered inline structural matching and splitting.
use crate::{matcher::*, *};
use lexical_model::*;
pub(crate) struct FoundMatch {
    pub start: usize,
    pub end: usize,
    pub index: usize,
    pub m: Match,
}
pub(crate) fn find(tx: &Transaction<'_>, node: NodeKey, t: &Transformers) -> Option<FoundMatch> {
    let text = tx.text_content(node);
    let mut found: Option<FoundMatch> = None;
    for (index, transformer) in t.text_match.iter().enumerate() {
        if !transformer.has_replace() {
            continue;
        }
        let Some(m) = transformer.import_reg_exp().and_then(|r| r.exec(&text)) else {
            continue;
        };
        let start = m.index.get() as usize;
        let end = match transformer.get_end_index(tx, node, &m) {
            EndIndex::Default => m.end().get() as usize,
            EndIndex::At(end) => end.get() as usize,
            EndIndex::Reject => continue,
        };
        if found
            .as_ref()
            .is_none_or(|f| start < f.start && (end > f.end || end <= f.start))
        {
            found = Some(FoundMatch {
                start,
                end,
                index,
                m,
            });
        }
    }
    found
}
pub(crate) fn apply(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    f: FoundMatch,
    t: &Transformers,
) -> Result<super::text::Parts> {
    let mut parts = super::text::split(tx, node, f.start, f.end)?;
    if let Some(key) = parts.transformed {
        parts.transformed = t.text_match[f.index].replace(tx, key, &f.m)?;
    }
    Ok(parts)
}
