//! Ordered update tags shared by transactions and commits.
use crate::collections::IndexSet;
use std::sync::Arc;
/// Semantic update tag, with upstream string spellings.
#[derive(Clone, PartialEq, Eq, Hash, Debug, strum::Display, strum::EnumString)]
#[strum(serialize_all = "kebab-case")]
pub enum UpdateTag {
    /// Collaboration update.
    Collaboration,
    /// Focus update.
    Focus,
    /// History restoration.
    Historic,
    /// Merge into the current history entry.
    HistoryMerge,
    /// Start a new history entry.
    HistoryPush,
    /// Clipboard insertion.
    Paste,
    /// Suppress collaboration broadcast.
    SkipCollab,
    /// Suppress DOM selection synchronization.
    SkipDomSelection,
    /// Suppress scrolling the selection into view.
    SkipScrollIntoView,
    /// Suppress selection focus.
    SkipSelectionFocus,
    /// Begin composition.
    CompositionStart,
    /// End composition.
    CompositionEnd,
    /// Application-defined tag.
    #[strum(default)]
    Custom(Arc<str>),
}
/// Deduplicated tags in insertion order.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct TagSet(IndexSet<UpdateTag>);
impl TagSet {
    /// Insert a tag, returning whether it was new.
    pub fn insert(&mut self, tag: UpdateTag) -> bool {
        self.0.insert(tag)
    }
    /// Test membership.
    pub fn contains(&self, tag: &UpdateTag) -> bool {
        self.0.contains(tag)
    }
    /// Iterate in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = &UpdateTag> {
        self.0.iter()
    }
    /// Collect tags, preserving their first occurrence.
    pub fn from_tags(tags: impl IntoIterator<Item = UpdateTag>) -> Self {
        Self(tags.into_iter().collect())
    }
}
