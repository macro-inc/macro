//! Recursive precedence between inline formats and structural matches.
use crate::{util::*, *};
use lexical_model::*;
pub(crate) struct Parts {
    pub before: Option<NodeKey>,
    pub after: Option<NodeKey>,
    pub transformed: Option<NodeKey>,
}
pub(crate) fn split(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    start: usize,
    end: usize,
) -> Result<Parts> {
    if end < start || end > tx.text_content_size(node).get() as usize {
        return Err(crate::Error::InvalidArgument(
            "text transformer range is outside its node",
        ));
    }
    let offsets = if start == 0 {
        vec![Utf16Offset(end as u32)]
    } else {
        vec![Utf16Offset(start as u32), Utf16Offset(end as u32)]
    };
    let parts = tx.text(node)?.split_text(&offsets)?;
    let index = usize::from(start != 0);
    Ok(Parts {
        before: if start == 0 {
            None
        } else {
            parts.first().copied()
        },
        transformed: parts.get(index).copied(),
        after: parts.get(index + 1).copied(),
    })
}
/// Whether inline markdown may be interpreted in this node.
pub fn can_contain_transformable_markdown(st: StateRef<'_>, node: NodeKey) -> bool {
    st.is_text(node)
        && st
            .text_data(node)
            .is_ok_and(|d| !d.format.contains(TextFormat::CODE))
}
/// Apply outermost matches recursively, then the upstream two-pass escape scan.
pub fn import_text_transformers(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    t: &Transformers,
) -> Result<()> {
    let f = super::text_format::find(tx, node, t)?;
    let m = super::text_match::find(tx, node, t);
    let use_format = match (&f, &m) {
        (Some(f), Some(m)) => f.start <= m.start && f.end >= m.end || m.start > f.end,
        (Some(_), None) => true,
        _ => false,
    };
    let parts = if use_format {
        f.map(|f| super::text_format::apply(tx, node, f, t))
            .transpose()?
    } else {
        m.map(|m| super::text_match::apply(tx, node, m, t))
            .transpose()?
    };
    if let Some(parts) = parts {
        for key in [parts.after, parts.before, parts.transformed]
            .into_iter()
            .flatten()
        {
            if can_contain_transformable_markdown(tx.view(), key) {
                import_text_transformers(tx, key, t)?;
            }
        }
    }
    if tx.is_text(node) {
        let text = unescape_text(&tx.text_content(node));
        tx.text(node)?.set_text_content(&text)?;
    }
    Ok(())
}
