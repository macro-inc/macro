//! Lazily loaded compact text-search catalogs, partitioned by profile/bucket.

use super::{SearchDocument, SearchProfile, project_search_documents};
use crate::value::{EntityKey, Record};
use std::collections::HashMap;

type Catalog = HashMap<EntityKey<'static>, SearchDocument>;

#[derive(Default)]
pub(crate) struct SearchCatalogs {
    profiles: HashMap<SearchProfile, HashMap<String, Catalog>>,
}

impl SearchCatalogs {
    pub fn get(&self, profile: SearchProfile, bucket: &str) -> Option<&Catalog> {
        self.profiles.get(&profile)?.get(bucket)
    }

    pub fn insert(
        &mut self,
        profile: SearchProfile,
        bucket: String,
        documents: Vec<SearchDocument>,
    ) {
        self.profiles.entry(profile).or_default().insert(
            bucket,
            documents
                .into_iter()
                .map(|document| (document.record_key.clone(), document))
                .collect(),
        );
    }

    pub fn clear(&mut self) {
        self.profiles.clear();
    }

    pub fn remove(&mut self, key: &EntityKey<'static>) {
        for buckets in self.profiles.values_mut() {
            for catalog in buckets.values_mut() {
                catalog.remove(key);
            }
        }
    }

    pub fn update(&mut self, entries: &[(EntityKey<'static>, Record)]) {
        if self.profiles.is_empty() {
            return;
        }
        for (key, record) in entries {
            // Remove from old buckets first, including subtype/channel-type moves.
            self.remove(key);
            for document in project_search_documents(key, record) {
                if let Some(catalog) = self
                    .profiles
                    .get_mut(&document.profile)
                    .and_then(|buckets| buckets.get_mut(&document.bucket))
                {
                    catalog.insert(key.clone(), document);
                }
            }
        }
    }
}
