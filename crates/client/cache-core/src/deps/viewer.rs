//! Viewer fields own independent argument-qualified query entry points. Track
//! their top-level storage keys, not each embedded page member. Other entities
//! deliberately keep record-level invalidation.

use crate::page_retention::SOUP_PAGE_OWNER;
use crate::value::{EntityKey, Record};
use std::collections::{BTreeMap, BTreeSet};

/// Dependency sink shared by response normalization and cache reads.
/// Record-only callers retain the existing conservative behavior.
pub trait DependencyTracker {
    /// Record existence/content used by the query, including missing records.
    fn record(&mut self, key: &EntityKey<'static>);
    /// A selected storage field on its concrete owning type (aliases resolved).
    fn field(&mut self, key: &EntityKey<'static>, concrete: &str, field: &str);
}

impl DependencyTracker for BTreeSet<EntityKey<'static>> {
    fn record(&mut self, key: &EntityKey<'static>) {
        self.insert(key.clone());
    }

    fn field(&mut self, _: &EntityKey<'static>, _: &str, _: &str) {}
}

pub(crate) type ViewerFields = BTreeMap<EntityKey<'static>, BTreeSet<String>>;

#[derive(Debug, Default)]
pub(crate) struct QueryDependencies {
    pub records: BTreeSet<EntityKey<'static>>,
    pub viewer_fields: ViewerFields,
}

impl DependencyTracker for QueryDependencies {
    fn record(&mut self, key: &EntityKey<'static>) {
        self.records.insert(key.clone());
    }

    fn field(&mut self, key: &EntityKey<'static>, concrete: &str, field: &str) {
        if concrete == SOUP_PAGE_OWNER {
            self.viewer_fields
                .entry(key.clone())
                .or_default()
                .insert(field.to_owned());
        }
    }
}

/// Capture potential field changes before a merge without cloning page payloads.
/// Retention can also remove fields, so remember the original keys.
pub(crate) struct ViewerFieldUpdate {
    previous_keys: BTreeSet<String>,
    changed: BTreeSet<String>,
}

impl ViewerFieldUpdate {
    pub fn capture(before: &Record, update: &Record) -> Option<Self> {
        (before.typename() == Some(SOUP_PAGE_OWNER)).then(|| Self {
            previous_keys: before.fields.keys().cloned().collect(),
            changed: update
                .fields
                .iter()
                .filter(|(field, value)| before.fields.get(*field) != Some(*value))
                .map(|(field, _)| field.clone())
                .collect(),
        })
    }

    pub fn finish(mut self, after: &Record) -> Option<BTreeSet<String>> {
        if after.typename() != Some(SOUP_PAGE_OWNER) {
            return None;
        }
        self.changed.extend(
            self.previous_keys
                .into_iter()
                .filter(|field| !after.fields.contains_key(field)),
        );
        Some(self.changed)
    }
}

/// Optimistic overlays already provide full before/after views. Creation,
/// deletion and type changes return no proof and invalidate the whole record.
pub(crate) fn changed_viewer_fields(
    before: Option<&Record>,
    after: Option<&Record>,
) -> Option<BTreeSet<String>> {
    let (before, after) = (before?, after?);
    if before.typename() != Some(SOUP_PAGE_OWNER) || after.typename() != Some(SOUP_PAGE_OWNER) {
        return None;
    }
    Some(
        before
            .fields
            .keys()
            .chain(after.fields.keys())
            .filter(|field| before.fields.get(*field) != after.fields.get(*field))
            .cloned()
            .collect(),
    )
}

#[cfg(test)]
mod test;
