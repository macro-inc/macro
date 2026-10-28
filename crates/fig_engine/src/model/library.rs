//! Team libraries: what a component, component set, style, or variable
//! carries about being published (in its library file) or coming from a
//! library (in a file that uses it), in Figma's fields.

use super::Guid;
use std::sync::Arc;

/// The plugin id Macro's own `pluginData` entries are stored under.
pub const MACRO_PLUGIN: &str = "macro";

/// Macro's values on a node (`pluginData` under [`MACRO_PLUGIN`]): key and
/// value, in order.
pub type MacroData = Arc<[(Arc<str>, Arc<str>)]>;

/// An asset's library details. In a library file a published asset is
/// `publishable` and has a `version` and the `published_version` it last
/// had when published; a copy of a library asset in another file names its
/// `source` library and its id there (`publish_id`), and keeps the version
/// it was copied at.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LibraryLink {
    /// `isSymbolPublishable` on components, `isPublishable` on the rest.
    pub publishable: Option<bool>,
    /// `sharedSymbolVersion` on components, `version` on the rest.
    pub version: Option<Arc<str>>,
    /// `publishedVersion`: the version the last publish shared.
    pub published_version: Option<Arc<str>>,
    /// `sourceLibraryKey`: the library a copy comes from.
    pub source: Option<Arc<str>>,
    /// `publishID`: the asset's id in its library.
    pub publish_id: Option<Guid>,
}

impl LibraryLink {
    pub fn is_empty(&self) -> bool {
        *self == LibraryLink::default()
    }
}
