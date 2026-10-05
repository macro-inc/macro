//! Team libraries (see [`crate::library`]): publishing a file's assets,
//! choosing the libraries a file uses, and copying library assets in
//! (`import`).

use super::{Op, Txn, flags};
use crate::document::NodeIdx;
use crate::error::Result;
use crate::library::{
    AssetKind, LIBRARIES_KEY, Manifest, ManifestAsset, PUBLISHED_KEY, hash, local_assets,
};
use crate::model::{LibraryLink, Props};
use std::sync::Arc;

mod import;

pub use import::{LIBRARY_SESSIONS, LibrarySpec};

/// `entries` with `key` set to `value` (or removed), in their order.
fn with_value(
    entries: Option<&[(Arc<str>, Arc<str>)]>,
    key: &str,
    value: Option<&str>,
) -> Option<Arc<[(Arc<str>, Arc<str>)]>> {
    let mut list: Vec<(Arc<str>, Arc<str>)> = entries.unwrap_or_default().to_vec();
    match (list.iter().position(|(k, _)| k.as_ref() == key), value) {
        (Some(at), Some(v)) => list[at].1 = v.into(),
        (Some(at), None) => {
            list.remove(at);
        }
        (None, Some(v)) => list.push((key.into(), v.into())),
        (None, None) => {}
    }
    (!list.is_empty()).then(|| list.into())
}

impl Txn<'_> {
    pub(super) fn apply_library(&mut self, op: &Op) -> Result<()> {
        match op {
            Op::PublishLibrary { seed, note } => self.publish_library(seed, note.as_deref()),
            Op::SetLibraries { libraries } => {
                let json = serde_json::to_string(libraries).unwrap_or_else(|_| "[]".into());
                let value = (!libraries.is_empty()).then_some(json);
                let root = self.doc.root;
                self.set_macro_value(root, LIBRARIES_KEY, value.as_deref());
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// Sets (or removes) one of Macro's values on node `i`.
    pub(super) fn set_macro_value(&mut self, i: NodeIdx, key: &str, value: Option<&str>) {
        let current = self.doc.props(i).macro_data.clone();
        let next = with_value(current.as_deref(), key, value);
        if next != current {
            self.edit(i, flags::LIBRARY).macro_data = next;
        }
    }

    /// "Publish library": every asset gets a key (once) and its current
    /// version, published; the document node records what was published.
    fn publish_library(&mut self, seed: &str, note: Option<&str>) -> Result<()> {
        let assets = local_assets(self.doc);
        for &(i, _) in &assets {
            if self.doc.props(i).key.is_none()
                && let Some(g) = self.doc.props(i).guid
            {
                self.edit(i, flags::LIBRARY).key = Some(hash::key_for(seed, g).into());
            }
        }
        let mut versions = hash::Versions::default();
        let computed: Vec<(NodeIdx, AssetKind, String)> = assets
            .iter()
            .map(|&(i, kind)| (i, kind, versions.of(self.doc, i)))
            .collect();
        let mut manifest = Manifest {
            assets: Vec::new(),
            note: note
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_owned),
        };
        for (i, kind, version) in computed {
            let publishable = crate::library::is_published_name(self.doc, i);
            let current = self.doc.props(i).library.clone();
            let mut link: LibraryLink = current.as_deref().cloned().unwrap_or_default();
            link.publishable = Some(publishable);
            link.version = Some(version.as_str().into());
            link.published_version = Some(version.as_str().into());
            if current.as_deref() != Some(&link) {
                self.edit(i, flags::LIBRARY).library = Some(Arc::new(link));
            }
            let p: &Props = self.doc.props(i);
            let variant = kind == AssetKind::Component
                && p.parent.is_some()
                && self
                    .doc
                    .node(i)
                    .parent
                    .is_some_and(|s| self.doc.props(s).is_state_group == Some(true));
            if publishable
                && !variant
                && let Some(key) = &p.key
            {
                manifest.assets.push(ManifestAsset {
                    key: key.to_string(),
                    name: p.name().to_owned(),
                    kind,
                });
            }
        }
        let json = serde_json::to_string(&manifest).unwrap_or_default();
        let root = self.doc.root;
        self.set_macro_value(root, PUBLISHED_KEY, Some(&json));
        Ok(())
    }
}

#[cfg(test)]
mod test;
