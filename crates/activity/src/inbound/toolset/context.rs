use std::sync::Arc;

use ai_toolset::AsyncToolCollection;

use super::ReadActivity;
use crate::domain::{ports::ActivityReads, service::ActivityReadService};

/// Service context for activity AI tools.
pub struct ActivityToolContext<R>
where
    R: ActivityReads,
{
    /// Domain service used to query activity and resolve display metadata.
    pub service: Arc<ActivityReadService<R>>,
}

impl<R> Clone for ActivityToolContext<R>
where
    R: ActivityReads,
{
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

impl<R> ActivityToolContext<R>
where
    R: ActivityReads,
{
    /// Create an activity tool context over `reads`.
    pub fn new(reads: R) -> Self {
        Self {
            service: Arc::new(ActivityReadService::new(reads)),
        }
    }

    /// Attach the viewer-scoped display metadata resolver.
    pub fn with_metadata_resolver(
        self,
        metadata: impl crate::domain::ports::ActivityMetadataResolver,
    ) -> Self {
        let service = Arc::try_unwrap(self.service)
            .unwrap_or_else(|service| (*service).clone())
            .with_metadata_resolver(metadata);
        Self {
            service: Arc::new(service),
        }
    }
}

/// Create the activity AI toolset.
pub fn activity_toolset<R>() -> AsyncToolCollection<ActivityToolContext<R>>
where
    R: ActivityReads + Send + Sync + 'static,
{
    AsyncToolCollection::new().add_tool::<ReadActivity, ActivityToolContext<R>>()
}
