//! Activity read use cases.

#[cfg(test)]
mod test;

use std::{
    collections::{HashMap, HashSet},
    num::NonZeroU32,
    sync::Arc,
};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::{
    models::{Action, RecordedAction},
    ports::{ActivityMetadataResolver, ActivityPropertyMetadata, ActivityRange, ActivityReads},
};

/// A bounded activity read plus display metadata for referenced properties.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedActivityRange {
    /// The underlying activity result.
    pub activity: ActivityRange,
    /// Visible property metadata keyed by property definition id.
    pub properties: HashMap<String, ActivityPropertyMetadata>,
}

/// No-op resolver used by activity consumers that do not provide presentation
/// metadata, including isolated domain and inbound tests.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopActivityMetadataResolver;

#[async_trait::async_trait]
impl ActivityMetadataResolver for NoopActivityMetadataResolver {
    async fn resolve_properties(
        &self,
        _viewer: &MacroUserIdStr<'_>,
        _property_ids: &[String],
    ) -> HashMap<String, ActivityPropertyMetadata> {
        HashMap::new()
    }
}

/// Orchestrates activity reads and best-effort display metadata resolution.
pub struct ActivityReadService<R>
where
    R: ActivityReads,
{
    reads: Arc<R>,
    metadata: Arc<dyn ActivityMetadataResolver>,
}

impl<R> Clone for ActivityReadService<R>
where
    R: ActivityReads,
{
    fn clone(&self) -> Self {
        Self {
            reads: Arc::clone(&self.reads),
            metadata: Arc::clone(&self.metadata),
        }
    }
}

impl<R> ActivityReadService<R>
where
    R: ActivityReads,
{
    /// Create a read service without optional display metadata resolution.
    pub fn new(reads: R) -> Self {
        Self {
            reads: Arc::new(reads),
            metadata: Arc::new(NoopActivityMetadataResolver),
        }
    }

    /// Attach the viewer-scoped metadata resolver used by presentation reads.
    pub fn with_metadata_resolver(self, metadata: impl ActivityMetadataResolver) -> Self {
        Self {
            reads: self.reads,
            metadata: Arc::new(metadata),
        }
    }

    /// Read the caller's bounded activity and resolve distinct properties in
    /// one viewer-scoped metadata request.
    pub async fn subject_activity_range(
        &self,
        subject_id: &MacroUserIdStr<'_>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        limit: NonZeroU32,
    ) -> Result<ResolvedActivityRange, R::Err> {
        let activity = self
            .reads
            .subject_activity_range(subject_id.as_ref(), from, to, limit)
            .await?;

        let property_ids: Vec<String> = activity
            .records
            .iter()
            .filter_map(|record| match &record.action {
                RecordedAction::Known(Action::PropertyChanged(change)) => {
                    Some(change.property.clone())
                }
                _ => None,
            })
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let properties = self
            .metadata
            .resolve_properties(subject_id, &property_ids)
            .await;

        Ok(ResolvedActivityRange {
            activity,
            properties,
        })
    }
}
