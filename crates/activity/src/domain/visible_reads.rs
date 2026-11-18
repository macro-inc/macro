//! Current project and CRM visibility for personal activity surfaces.
//!
//! A task move may remove it from a project the actor has never been able to
//! view. The project keeps that activity, but the actor's personal feed must
//! not disclose its identifier. This wrapper applies the same policy after
//! access is revoked and keeps raw cursors stable when rows are filtered.

use super::ports::ActivityAudienceExpander;
use crate::domain::ports::{ActivityFeedPage, ActivityRange, ActivityReads, EntityActivityMap};
use crate::{ActivityOverview, ActivityRecord, ActivityWindow, EntityType};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::HashSet, num::NonZeroU32};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A failed underlying read or current-access lookup.
#[derive(Debug, thiserror::Error)]
pub enum VisibleActivityError {
    /// The supplied viewer is not a valid user principal.
    #[error("invalid activity viewer")]
    InvalidViewer,
    /// The activity repository could not complete its read.
    #[error("activity read failed")]
    Read(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// Current entity permissions could not be resolved.
    #[error("activity access lookup failed")]
    Access(#[source] Box<dyn std::error::Error + Send + Sync>),
}

/// Whether a retained activity row requires a fresh entity permission check.
pub fn requires_current_visibility(kind: EntityType) -> bool {
    matches!(
        kind,
        EntityType::Initiative
            | EntityType::CrmCompany
            | EntityType::CrmContact
            | EntityType::CrmPipeline
    )
}

/// Activity reads with current project and CRM record visibility.
pub struct VisibleActivityReads<R, A> {
    reads: R,
    access: A,
}

impl<R, A> VisibleActivityReads<R, A> {
    /// Compose using the owning activity reader and access service.
    pub fn new(reads: R, access: A) -> Self {
        Self { reads, access }
    }
}

impl<R, A: ActivityAudienceExpander> VisibleActivityReads<R, A> {
    async fn visible_keys(
        &self,
        viewer: &MacroUserIdStr<'_>,
        keys: Vec<(EntityType, String)>,
    ) -> Result<HashSet<(EntityType, String)>, VisibleActivityError> {
        let keys: Vec<_> = keys
            .into_iter()
            .filter(|(kind, _)| requires_current_visibility(*kind))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        self.access
            .visible_entities(viewer, &keys)
            .await
            .map_err(|error| VisibleActivityError::Access(Box::new(error)))
    }

    async fn filter(
        &self,
        subject: &str,
        records: Vec<ActivityRecord>,
        needs_check: fn(EntityType) -> bool,
    ) -> Result<Vec<ActivityRecord>, VisibleActivityError> {
        let viewer = MacroUserIdStr::parse_from_str(subject)
            .map_err(|_| VisibleActivityError::InvalidViewer)?;
        let visible = self
            .visible_keys(
                &viewer,
                records
                    .iter()
                    .filter(|record| needs_check(record.entity_type))
                    .map(|record| (record.entity_type, record.entity_id.clone()))
                    .collect(),
            )
            .await?;
        Ok(records
            .into_iter()
            .filter(|record| {
                !needs_check(record.entity_type)
                    || visible.contains(&(record.entity_type, record.entity_id.clone()))
            })
            .collect())
    }
}

impl<R: ActivityReads + Send + Sync, A: ActivityAudienceExpander> ActivityReads
    for VisibleActivityReads<R, A>
{
    type Err = VisibleActivityError;

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
            .map_err(|error| VisibleActivityError::Read(Box::new(error)))?;
        Ok(ActivityFeedPage {
            records: self
                .filter(subject_id, page.records, requires_current_visibility)
                .await?,
            next: page.next,
        })
    }

    async fn teammate_feed(
        &self,
        viewer_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        // Recheck through primary-backed entity access: the activity reader may
        // use a replica, and old CRM grants must not survive member revocation.
        let page = self
            .reads
            .teammate_feed(viewer_id, cursor, limit)
            .await
            .map_err(|error| VisibleActivityError::Read(Box::new(error)))?;
        Ok(ActivityFeedPage {
            records: self
                .filter(viewer_id, page.records, |kind| {
                    matches!(
                        kind,
                        EntityType::CrmCompany | EntityType::CrmContact | EntityType::CrmPipeline
                    )
                })
                .await?,
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
            .map_err(|error| VisibleActivityError::Read(Box::new(error)))?;
        Ok(ActivityRange {
            records: self
                .filter(subject_id, range.records, requires_current_visibility)
                .await?,
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
            .map_err(|error| VisibleActivityError::Read(Box::new(error)))?;
        let viewer = MacroUserIdStr::parse_from_str(subject_id)
            .map_err(|_| VisibleActivityError::InvalidViewer)?;
        let visible = self
            .visible_keys(
                &viewer,
                overview
                    .top_entities
                    .iter()
                    .map(|rank| (rank.entity_type, rank.entity_id.clone()))
                    .collect(),
            )
            .await?;
        let entities = overview
            .top_entities
            .iter()
            .filter(|rank| {
                !requires_current_visibility(rank.entity_type)
                    || visible.contains(&(rank.entity_type, rank.entity_id.clone()))
            })
            .cloned()
            .collect();
        // Daily totals count the user's own actions, including those whose target
        // can no longer be opened. Entity references always require current access.
        ActivityOverview::new(overview.window.clone(), overview.days.clone(), entities)
            .map_err(|error| VisibleActivityError::Read(Box::new(error)))
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
            .map_err(|error| VisibleActivityError::Read(Box::new(error)))
    }
}
