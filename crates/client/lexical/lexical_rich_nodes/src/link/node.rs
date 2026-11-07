//! Link payloads, serialization and insertion hooks.
use super::*;
use serde::{Deserialize, Deserializer, Serialize};
/// Optional anchor attributes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LinkAttributes {
    /// Relationship tokens.
    pub rel: Option<String>,
    /// Target browsing context.
    pub target: Option<String>,
    /// Anchor title.
    pub title: Option<String>,
}
/// Automatic-link attributes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AutoLinkAttributes {
    /// Anchor attributes.
    pub link: LinkAttributes,
    /// Whether automatic linking was explicitly disabled for this span.
    pub is_unlinked: Option<bool>,
}
fn empty_as_none<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Option<String>, D::Error> {
    Ok(Option::<String>::deserialize(d)?.filter(|s| !s.is_empty()))
}
fn null_as_false<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
}
/// Upstream inline LinkNode; field order matches exported JSON.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LinkNode {
    /// Relationship tokens, null when absent.
    #[serde(default, deserialize_with = "empty_as_none")]
    pub rel: Option<String>,
    /// Browsing context, null when absent.
    #[serde(default, deserialize_with = "empty_as_none")]
    pub target: Option<String>,
    /// Title, null when absent.
    #[serde(default, deserialize_with = "empty_as_none")]
    pub title: Option<String>,
    /// Stored URL, before HTML sanitization.
    pub url: String,
}
impl NodeType for LinkNode {
    const TYPE: &'static str = "link";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for LinkNode {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_insert_text_before(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_insert_text_after(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _: SelectionSlot,
        restore: bool,
    ) -> Result<Option<NodeKey>> {
        let copy = tx.copy_node(this, false)?;
        tx.insert_after(this, copy, restore)?;
        Ok(Some(copy))
    }
    fn extract_with_child(
        &self,
        node: ElementView<'_>,
        _: NodeKey,
        selection: Option<&Selection>,
        _: CopyDestination,
    ) -> bool {
        selection.and_then(Selection::as_range).is_some_and(|r| {
            node.state.is_parent_of(node.key, r.anchor.key())
                && node.state.is_parent_of(node.key, r.focus.key())
                && r.text_content(node.state).is_ok_and(|t| !t.is_empty())
        })
    }
}
/// Upstream AutoLinkNode, inheriting inline link hooks.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AutoLinkNode {
    /// Base link payload.
    #[serde(flatten)]
    pub link: LinkNode,
    /// Explicitly unlinked span.
    #[serde(rename = "isUnlinked", default, deserialize_with = "null_as_false")]
    pub is_unlinked: bool,
}
impl NodeType for AutoLinkNode {
    const TYPE: &'static str = "autolink";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for AutoLinkNode {
    type Parent = LinkNode;
    fn as_parent(&self) -> &LinkNode {
        &self.link
    }
    fn as_parent_mut(&mut self) -> Option<&mut LinkNode> {
        Some(&mut self.link)
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _: SelectionSlot,
        restore: bool,
    ) -> Result<Option<NodeKey>> {
        let payload = tx
            .get::<Self>(this)
            .ok_or(Error::NodeTypeMismatch(this.key()))?
            .clone();
        let copy = tx.create(payload)?;
        tx.insert_after(this, copy, restore)?;
        Ok(Some(copy.key()))
    }
}
/// Create a link through registered replacements.
pub fn create_link_node(
    tx: &mut Transaction<'_>,
    url: &str,
    attrs: LinkAttributes,
) -> Result<Id<LinkNode>> {
    tx.create(LinkNode {
        url: url.into(),
        rel: attrs.rel,
        target: attrs.target,
        title: attrs.title,
    })
}
/// Link ancestry, including AutoLinkNode and application subclasses.
pub fn is_link_node(st: &impl Read, key: NodeKey) -> bool {
    st.is::<LinkNode>(key)
}
/// Create an automatic-link payload.
pub fn create_auto_link_node(
    tx: &mut Transaction<'_>,
    url: &str,
    attrs: AutoLinkAttributes,
) -> Result<Id<AutoLinkNode>> {
    tx.create(AutoLinkNode {
        link: LinkNode {
            url: url.into(),
            rel: attrs.link.rel,
            target: attrs.link.target,
            title: attrs.link.title,
        },
        is_unlinked: attrs.is_unlinked.unwrap_or(false),
    })
}
/// Automatic-link ancestry.
pub fn is_auto_link_node(st: &impl Read, key: NodeKey) -> bool {
    st.is::<AutoLinkNode>(key)
}
/// URI starts with the literal mailto prefix.
pub fn is_email_uri(link: &LinkNode) -> bool {
    link.url.starts_with("mailto:")
}
/// URI starts with a literal http or https prefix.
pub fn is_web_site_uri(link: &LinkNode) -> bool {
    link.url.starts_with("https://") || link.url.starts_with("http://")
}
/// Only same-type ordinary links with identical attributes merge.
pub fn should_merge_adjacent_link(st: &impl Read, a: Id<LinkNode>, b: Id<LinkNode>) -> bool {
    !st.is::<AutoLinkNode>(a)
        && st.type_name(a).ok() == st.type_name(b).ok()
        && st.get::<LinkNode>(a) == st.get::<LinkNode>(b)
}
/// Add the upstream default protocol while preserving explicit schemes and relative paths.
pub fn format_url(url: &str) -> String {
    let scheme = url.split_once(':').is_some_and(|(s, _)| {
        let mut chars = s.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
    });
    if scheme || url.starts_with(['/', '#', '.']) {
        url.into()
    } else if url.contains('@') {
        format!("mailto:{url}")
    } else {
        let phone = url.strip_prefix('+').unwrap_or(url);
        if phone.chars().count() >= 5
            && phone.chars().all(|c| {
                c.is_ascii_digit()
                    || crate::utils::is_js_whitespace(c)
                    || matches!(c, '(' | ')' | '-')
            })
        {
            format!("tel:{url}")
        } else {
            format!("https://{url}")
        }
    }
}
/// Format a URL and reject parsed schemes outside the HTML allowlist.
pub fn sanitize_url(url: &str) -> String {
    let formatted = format_url(url);
    if url::Url::parse(&formatted)
        .is_ok_and(|u| !matches!(u.scheme(), "http" | "https" | "mailto" | "sms" | "tel"))
    {
        "about:blank".into()
    } else {
        formatted
    }
}

#[cfg(test)]
mod test;
