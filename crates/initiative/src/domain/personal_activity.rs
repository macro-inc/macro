//! Current project visibility for personal activity surfaces.
//!
//! A task move may remove it from a project the actor has never been able to
//! view. The project keeps that activity, but the actor's personal feed must
//! not disclose its identifier. This wrapper applies the same policy after
//! access is revoked and keeps raw cursors stable when rows are filtered.

use super::models::InitiativeError;
use activity::domain::ports::{ActivityFeedPage, ActivityRange, ActivityReads, EntityActivityMap};
use activity::{ActivityOverview, ActivityRecord, ActivityWindow, EntityType};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{AccessError, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::HashMap, num::NonZeroU32, sync::Arc};
use uuid::Uuid;

/// Activity reads decorated with project-owned visibility policy.
pub struct ProjectVisibleActivityReads<R, A> {
    reads: R,
    access: Arc<A>,
}

impl<R, A> ProjectVisibleActivityReads<R, A> {
    /// Compose using the owning activity reader and access service.
    pub fn new(reads: R, access: Arc<A>) -> Self {
        Self { reads, access }
    }
}

impl<R, A: EntityAccessService> ProjectVisibleActivityReads<R, A> {
    async fn visible(
        &self,
        viewer: &MacroUserIdStr<'_>,
        entity_type: EntityType,
        entity_id: &str,
        cache: &mut HashMap<String, bool>,
    ) -> Result<bool, InitiativeError> {
        if entity_type != EntityType::Initiative {
            return Ok(true);
        }
        if let Some(visible) = cache.get(entity_id) {
            return Ok(*visible);
        }
        let allowed = match self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                viewer,
                None,
                entity_id,
                EntityType::Initiative,
            )
            .await
        {
            Ok(_) => true,
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_)
                | AccessError::BadRequest(_),
            ) => false,
            Err(error) => return Err(error.into()),
        };
        cache.insert(entity_id.to_owned(), allowed);
        Ok(allowed)
    }

    async fn filter(
        &self,
        subject: &str,
        records: Vec<ActivityRecord>,
    ) -> Result<Vec<ActivityRecord>, InitiativeError> {
        let viewer =
            MacroUserIdStr::parse_from_str(subject).map_err(|_| InitiativeError::Unauthorized)?;
        let mut cache = HashMap::new();
        let mut visible = Vec::with_capacity(records.len());
        for record in records {
            if self
                .visible(&viewer, record.entity_type, &record.entity_id, &mut cache)
                .await?
            {
                visible.push(record);
            }
        }
        Ok(visible)
    }
}

impl<R: ActivityReads + Send + Sync, A: EntityAccessService> ActivityReads
    for ProjectVisibleActivityReads<R, A>
{
    type Err = InitiativeError;

    async fn subject_feed(
        &self,
        subject_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        let page = self
            .reads
            .subject_feed(subject_id, cursor, limit)
            .await
            .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?;
        Ok(ActivityFeedPage {
            records: self.filter(subject_id, page.records).await?,
            next: page.next,
        })
    }

    async fn subject_activity_range(
        &self,
        subject_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        limit: NonZeroU32,
    ) -> Result<ActivityRange, Self::Err> {
        let range = self
            .reads
            .subject_activity_range(subject_id, from, to, limit)
            .await
            .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?;
        Ok(ActivityRange {
            records: self.filter(subject_id, range.records).await?,
            truncated: range.truncated,
        })
    }

    async fn subject_overview(
        &self,
        subject_id: &str,
        window: ActivityWindow,
    ) -> Result<ActivityOverview, Self::Err> {
        let overview = self
            .reads
            .subject_overview(subject_id, window)
            .await
            .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?;
        let viewer = MacroUserIdStr::parse_from_str(subject_id)
            .map_err(|_| InitiativeError::Unauthorized)?;
        let mut cache = HashMap::new();
        let mut entities = Vec::new();
        for rank in &overview.top_entities {
            if self
                .visible(&viewer, rank.entity_type, &rank.entity_id, &mut cache)
                .await?
            {
                entities.push(rank.clone());
            }
        }
        // Daily totals count the user's own actions, including those whose target
        // can no longer be opened. Entity references always require current access.
        ActivityOverview::new(overview.window.clone(), overview.days.clone(), entities)
            .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))
    }

    async fn entity_activity(
        &self,
        keys: &[(EntityType, String)],
        per_entity_limit: u32,
    ) -> Result<EntityActivityMap, Self::Err> {
        // Entity edges are reached through already-authorized entity reads.
        self.reads
            .entity_activity(keys, per_entity_limit)
            .await
            .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))
    }
}
