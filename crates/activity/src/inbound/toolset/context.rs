//! Context and collection factory for activity AI tools.

use std::sync::Arc;

use ai_toolset::AsyncToolCollection;

use super::ReadActivity;
use crate::domain::ports::ActivityReads;

/// Service context for activity AI tools.
pub struct ActivityToolContext<R>
where
    R: ActivityReads,
{
    /// Activity read port used to query the caller's activity.
    pub reads: Arc<R>,
}

impl<R> Clone for ActivityToolContext<R>
where
    R: ActivityReads,
{
    fn clone(&self) -> Self {
        Self {
            reads: Arc::clone(&self.reads),
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
            reads: Arc::new(reads),
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
