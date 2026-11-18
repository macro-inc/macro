//! Hashtag text nodes and the upstream legacy JavaScript pattern.
use crate::text::entity::{EntityMatch, GetMatch, TextEntity};
use lexical_model::*;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, LazyLock};

/// Upstream `HashtagNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HashtagNode {}
impl NodeType for HashtagNode {
    const TYPE: &'static str = "hashtag";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for HashtagNode {
    text_node_base!();
    fn can_insert_text_before(&self, _node: TextView<'_>) -> bool {
        false
    }
    fn is_text_entity(&self, _node: TextView<'_>) -> bool {
        true
    }
}
impl TextEntity for HashtagNode {
    fn get_match(text: &str) -> Option<EntityMatch> {
        get_hashtag_match(text)
    }
    fn create(
        tx: &mut Transaction<'_>,
        from: NodeKey,
    ) -> std::result::Result<NodeKey, lexical_model::Error> {
        let text = tx.text_content(from).into_owned();
        let node = tx.create(Self {})?;
        tx.text(node)?.set_text_content(&text)?;
        Ok(node.key())
    }
}
/// Create an unattached hashtag with the supplied text.
pub fn create_hashtag_node(tx: &mut Transaction<'_>, text: &str) -> crate::Result<Id<HashtagNode>> {
    let node = tx.create(HashtagNode {})?;
    tx.text(node)?.set_text_content(text)?;
    Ok(node)
}
/// Test hashtag ancestry.
pub fn is_hashtag_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<HashtagNode>(key)
}
// The generated literal is validated at startup and by the matcher conformance tests.
static REGEX: LazyLock<regress::Regex> = LazyLock::new(|| {
    regress::Regex::with_flags(include_str!("hashtag/pattern.txt"), "i")
        .expect("validated upstream hashtag regex")
});
/// Find the first hashtag using JavaScript non-Unicode case folding and UTF-16 offsets.
pub fn get_hashtag_match(text: &str) -> Option<EntityMatch> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let matched = REGEX.find_from_ucs2(&units, 0).next()?;
    let boundary = matched.group(1)?;
    let body = matched.group(3)?;
    let start = u32::try_from(boundary.end).ok()?;
    let end = start
        .checked_add(u32::try_from(body.len()).ok()?)?
        .checked_add(1)?;
    Some(EntityMatch {
        start: Utf16Offset(start),
        end: Utf16Offset(end),
    })
}
/// A per-editor matcher, permitting host-specific hashtag syntax.
#[derive(Clone)]
pub struct HashtagConfig {
    /// Return the first match in UTF-16 code units.
    pub get_hashtag_match: GetMatch,
}
impl Default for HashtagConfig {
    fn default() -> Self {
        Self {
            get_hashtag_match: Arc::new(get_hashtag_match),
        }
    }
}
fn hashtag_text_transform(
    tx: &mut Transaction<'_>,
    node: Id<Text>,
) -> std::result::Result<(), lexical_model::Error> {
    let matcher = tx.extension::<HashtagConfig>()?.get_hashtag_match.clone();
    crate::text::entity::transform_text::<HashtagNode>(tx, node, |text| matcher(text))
}
fn hashtag_reverse_transform(
    tx: &mut Transaction<'_>,
    node: Id<HashtagNode>,
) -> std::result::Result<(), lexical_model::Error> {
    let matcher = tx.extension::<HashtagConfig>()?.get_hashtag_match.clone();
    crate::text::entity::transform_reverse::<HashtagNode>(tx, node, |text| matcher(text))
}
/// Register the hashtag type, matcher state and forward/reverse transforms.
pub fn register_hashtag(builder: EditorBuilder, config: HashtagConfig) -> EditorBuilder {
    builder
        .node::<HashtagNode>()
        .extension_state(config)
        .transform::<Text>(hashtag_text_transform)
        .transform::<HashtagNode>(hashtag_reverse_transform)
}
#[cfg(test)]
mod test;
