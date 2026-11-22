//! Standard inline link transformer, preserving upstream bracket splitting.
use crate::{matcher::*, patterns, util::*, *};
use lexical_model::*;
use lexical_rich_nodes::link::*;
/// Inline link transformer.
#[derive(Debug)]
pub struct Link;
/// Shared inline link transformer.
pub static LINK: Link = Link;
impl TextMatchTransformer for Link {
    fn dependencies(&self) -> &[&'static str] {
        &["link"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*patterns::LINK
    }
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        Some(&*patterns::LINK_IMPORT)
    }
    fn trigger(&self) -> Option<char> {
        Some(')')
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        if cx.state().is::<AutoLinkNode>(node) {
            return Ok(None);
        }
        let Some(link) = cx.state().get::<LinkNode>(node).cloned() else {
            return Ok(None);
        };
        let text = cx.export_children(node)?;
        let title = link.title.filter(|s| !s.is_empty()).map(|s| {
            let mut escaped = String::new();
            for c in s.chars() {
                if matches!(c, '\\' | '"') {
                    escaped.push('\\');
                }
                escaped.push(c);
            }
            escaped
        });
        Ok(Some(if let Some(title) = title {
            format!("[{text}]({} \"{title}\")", link.url)
        } else {
            format!("[{text}]({})", link.url)
        }))
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        m: &Match,
    ) -> Result<Option<NodeKey>> {
        if tx
            .find_matching_parent(node, |st, key| st.is::<LinkNode>(key))
            .is_some()
        {
            return Ok(None);
        }
        let mut text = m.get(1).unwrap_or("").to_owned();
        let url = unescape_text(m.get(2).unwrap_or(""));
        let title = m.get(3).map(unescape_text);
        let open = text.chars().filter(|c| *c == '[').count();
        let close = text.chars().filter(|c| *c == ']').count();
        if open < close {
            return Ok(None);
        }
        let outside = if open > close {
            let mut parts = text.split('[');
            let first = parts.next().unwrap_or("");
            let outside = format!("[{first}");
            text = parts.collect::<Vec<_>>().join("[");
            Some(outside)
        } else {
            None
        };
        let link = create_link_node(
            tx,
            &url,
            LinkAttributes {
                title,
                ..Default::default()
            },
        )?;
        let child = tx.create_text(&text)?;
        let format = tx.text_data(node)?.format;
        tx.text(child)?.set_format(format)?;
        tx.append(link, &[child.key()])?;
        tx.replace(node, link, false)?;
        if let Some(outside) = outside.filter(|s| !s.is_empty()) {
            let text = tx.create_text(&outside)?;
            tx.insert_before(link, text, true)?;
        }
        Ok(Some(child.key()))
    }
}
#[cfg(test)]
mod test;
