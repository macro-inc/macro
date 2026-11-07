//! Saved-view policy and persistence ports. Configurations belong to their consumers.
use crate::View;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    future::Future,
};
use uuid::Uuid;

/// Requested sharing change, separate from an omitted update.
#[derive(Debug, Clone, Copy)]
pub enum ShareChange {
    /// Keep the existing share.
    Unchanged,
    /// Remove sharing.
    Private,
    /// Share with the given team.
    Team(Uuid),
}

/// A replacement update; `None` means preserve the field.
#[derive(Debug)]
pub struct Update {
    /// Replacement name.
    pub name: Option<String>,
    /// Replacement configuration.
    pub config: Option<Value>,
    /// Sharing change.
    pub share: ShareChange,
}

/// Validated field changes and requested sharing for a conditional write.
#[derive(Debug)]
pub struct ViewChanges<'a> {
    /// Replacement name; omission preserves the stored name.
    pub name: Option<&'a str>,
    /// Replacement configuration; omission preserves the stored configuration.
    pub config: Option<&'a Value>,
    /// Resolved team association, or no team for a private definition.
    pub shared_team_id: Option<Uuid>,
}

/// Visibility and pagination position ordered by creation time then ID.
#[derive(Debug, Clone, Copy)]
pub struct Cursor {
    /// Creation time of the last seen view.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// ID of the last seen view.
    pub id: Uuid,
}

/// Storage for view definitions. Conditional writes enforce authorization atomically.
pub trait ViewRepository: Send + Sync {
    /// Repository failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Load a definition from primary storage.
    fn get(&self, id: Uuid) -> impl Future<Output = Result<Option<View>, Self::Err>> + Send;
    /// List legacy personal views without a kind filter.
    fn legacy_list(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<Vec<View>, Self::Err>> + Send;
    /// Insert once; return the original live record, or None for a deleted ID.
    fn create(&self, view: &View) -> impl Future<Output = Result<Option<View>, Self::Err>> + Send;
    /// Read owned and team-shared views for the service to check against current membership.
    fn list_views_for_access_check(
        &self,
        viewer: &str,
        team_ids: &[Uuid],
        kind: Option<&str>,
        after: Option<Cursor>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<View>, Self::Err>> + Send;
    /// Replace fields only when the owner and revision match.
    fn update(
        &self,
        id: Uuid,
        owner: &str,
        revision: i64,
        changes: ViewChanges<'_>,
    ) -> impl Future<Output = Result<Option<View>, Self::Err>> + Send;
    /// Retire the ID and clear content only when the owner and revision match.
    fn delete(
        &self,
        id: Uuid,
        owner: &str,
        revision: i64,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Legacy REST PATCH shallow-merges JSON and increments the revision.
    fn legacy_patch(
        &self,
        id: Uuid,
        owner: &str,
        name: Option<&str>,
        config: Option<&Value>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Legacy REST delete, scoped to the authenticated owner.
    fn legacy_delete(
        &self,
        id: Uuid,
        owner: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Authoritative Teams-owned membership evidence, always read from primary storage.
pub trait MembershipPort: Send + Sync {
    /// Membership failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// All current teams for the viewer.
    fn viewer_teams(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
    /// All current members of a team, including its owner.
    fn team_members(
        &self,
        team: Uuid,
    ) -> impl Future<Output = Result<HashSet<String>, Self::Err>> + Send;
}

/// Caller-meaningful saved-view failures.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// No authorized record has this ID.
    #[error("saved view not found")]
    NotFound,
    /// Legacy REST preserves its distinct response for another owner’s definition.
    #[error("You are not authorized to access this")]
    NotOwner,
    /// A stale revision was submitted.
    #[error("saved view revision conflict")]
    Conflict,
    /// An input exceeded its validated bounds.
    #[error("invalid saved view input")]
    Invalid,
    /// A share targets a team the owner does not belong to.
    #[error("not a current team member")]
    NotMember,
    /// A storage or membership read failed.
    #[error("saved view internal error")]
    Internal(rootcause::Report),
}

/// Cursor page of effectively visible definitions.
#[derive(Debug)]
pub struct Page {
    /// Visible definitions.
    pub views: Vec<View>,
    /// Last scanned view, only set when more visible views remain.
    pub next: Option<Cursor>,
}

/// Owns authorization, visibility, write policy and pagination.
pub struct SavedViewService<R, M> {
    repo: R,
    membership: M,
}

impl<R: ViewRepository, M: MembershipPort> SavedViewService<R, M> {
    /// Construct the saved-view service from its ports.
    pub fn new(repo: R, membership: M) -> Self {
        Self { repo, membership }
    }

    fn validate(name: &str, config: &Value) -> Result<(), Error> {
        if name.trim().is_empty()
            || name.chars().count() > 120
            || !config.is_object()
            || serde_json::to_vec(config)
                .map_err(|_| Error::Invalid)?
                .len()
                > 32_768
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }

    async fn effective(
        &self,
        viewer: &str,
        views: Vec<View>,
        viewer_teams: &HashSet<Uuid>,
    ) -> Result<Vec<View>, Error> {
        let teams: HashSet<_> = views
            .iter()
            .filter_map(|view| view.shared_team_id)
            .filter(|team| viewer_teams.contains(team))
            .collect();
        let mut team_members = HashMap::new();
        for team in teams {
            let members = self
                .membership
                .team_members(team)
                .await
                .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
            team_members.insert(team, members);
        }
        Ok(views
            .into_iter()
            .filter_map(|mut v| {
                let shared = v.shared_team_id.filter(|team| {
                    team_members.get(team).is_some_and(|members| {
                        members.contains(viewer) && members.contains(&v.user_id)
                    })
                });
                if v.user_id != viewer && shared.is_none() {
                    return None;
                }
                v.shared_team_id = shared;
                Some(v)
            })
            .collect())
    }

    /// Read an authorized definition; an inactive share is private even for the owner.
    #[tracing::instrument(name = "saved_view.get", skip_all, fields(view_id = %id), err)]
    pub async fn get(&self, viewer: &str, id: Uuid) -> Result<View, Error> {
        let view = self
            .repo
            .get(id)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .ok_or(Error::NotFound)?;
        let teams = self
            .membership
            .viewer_teams(viewer)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
        self.effective(viewer, vec![view], &teams.into_iter().collect())
            .await?
            .pop()
            .ok_or(Error::NotFound)
    }

    /// List a bounded page after applying effective visibility.
    #[tracing::instrument(name = "saved_view.list", skip_all, fields(limit, kind), err)]
    pub async fn list(
        &self,
        viewer: &str,
        kind: Option<&str>,
        after: Option<Cursor>,
        limit: u32,
    ) -> Result<Page, Error> {
        if !(1..=50).contains(&limit) || kind.is_some_and(|s| s.is_empty() || s.len() > 64) {
            return Err(Error::Invalid);
        }
        let teams = self
            .membership
            .viewer_teams(viewer)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
        let team_set: HashSet<_> = teams.iter().copied().collect();
        let mut cursor = after;
        let mut visible = Vec::new();
        loop {
            let batch = self
                .repo
                .list_views_for_access_check(viewer, &teams, kind, cursor, 100)
                .await
                .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
            let count = batch.len();
            // Keep raw sharing evidence until the page is complete. Membership can
            // change between batches, so recheck previously collected views too.
            let mut effective = self
                .effective(
                    viewer,
                    visible.iter().chain(&batch).cloned().collect(),
                    &team_set,
                )
                .await?;
            let visible_ids: HashSet<_> = effective.iter().map(|v| v.id).collect();
            visible.retain(|v: &View| visible_ids.contains(&v.id));
            for v in batch {
                let previous = cursor;
                cursor = Some(Cursor {
                    created_at: v.created_at,
                    id: v.id,
                });
                if visible_ids.contains(&v.id) {
                    visible.push(v);
                    if visible.len() > limit as usize {
                        effective.truncate(limit as usize);
                        return Ok(Page {
                            views: effective,
                            next: previous,
                        });
                    }
                }
            }
            if count < 100 {
                return Ok(Page {
                    views: effective,
                    next: None,
                });
            }
        }
    }

    /// Create once; the ID is client-generated so a retry cannot duplicate a definition.
    #[tracing::instrument(name = "saved_view.create", skip_all, fields(view_id = %id), err)]
    pub async fn create(
        &self,
        viewer: &str,
        id: Uuid,
        name: String,
        config: Value,
        team: Option<Uuid>,
    ) -> Result<View, Error> {
        if let Some(existing) = self
            .repo
            .get(id)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
        {
            if existing.user_id != viewer {
                return Err(Error::NotFound);
            }
            return self.get(viewer, id).await;
        }
        Self::validate(&name, &config)?;
        if let Some(team) = team {
            let members = self
                .membership
                .team_members(team)
                .await
                .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
            if !members.contains(viewer) {
                return Err(Error::NotMember);
            }
        }
        let mut view = View::new(viewer.to_owned(), name, config);
        view.id = id;
        view.shared_team_id = team;
        let created = self
            .repo
            .create(&view)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .ok_or(Error::NotFound)?;
        if created.user_id != viewer {
            return Err(Error::NotFound);
        }
        self.get(viewer, id).await
    }

    /// Replace selected fields using a revision-guarded owner-only write.
    #[tracing::instrument(name = "saved_view.update", skip_all, fields(view_id = %id, revision), err)]
    pub async fn update(
        &self,
        viewer: &str,
        id: Uuid,
        revision: i64,
        change: Update,
    ) -> Result<View, Error> {
        let current = self
            .repo
            .get(id)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .ok_or(Error::NotFound)?;
        if current.user_id != viewer {
            return Err(Error::NotFound);
        }
        if current.revision != revision {
            return Err(Error::Conflict);
        }
        Self::validate(
            change.name.as_deref().unwrap_or(&current.name),
            change.config.as_ref().unwrap_or(&current.config),
        )?;
        let team = match change.share {
            ShareChange::Unchanged => current.shared_team_id,
            ShareChange::Private => None,
            ShareChange::Team(team) => {
                let members = self
                    .membership
                    .team_members(team)
                    .await
                    .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
                if !members.contains(viewer) {
                    return Err(Error::NotMember);
                }
                Some(team)
            }
        };
        let saved = self
            .repo
            .update(
                id,
                viewer,
                revision,
                ViewChanges {
                    name: change.name.as_deref(),
                    config: change.config.as_ref(),
                    shared_team_id: team,
                },
            )
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .ok_or(Error::Conflict)?;
        self.get(viewer, saved.id).await
    }

    /// Delete an owned definition, harmless on a repeated deletion.
    #[tracing::instrument(name = "saved_view.delete", skip_all, fields(view_id = %id, revision), err)]
    pub async fn delete(&self, viewer: &str, id: Uuid, revision: i64) -> Result<Uuid, Error> {
        if !self
            .repo
            .delete(id, viewer, revision)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
        {
            let current = self
                .repo
                .get(id)
                .await
                .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?;
            if let Some(v) = current {
                if v.user_id != viewer {
                    return Err(Error::NotFound);
                }
                return Err(Error::Conflict);
            }
        }
        Ok(id)
    }

    /// Legacy REST creation accepts existing CRM configurations unchanged.
    pub async fn legacy_create(
        &self,
        viewer: &str,
        name: String,
        config: Value,
    ) -> Result<View, Error> {
        let view = View::new(viewer.to_owned(), name, config);
        self.repo
            .create(&view)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .ok_or(Error::NotFound)
    }

    /// Legacy REST listing includes only the caller's private definitions.
    pub async fn legacy_list(&self, viewer: &str) -> Result<Vec<View>, Error> {
        self.repo
            .legacy_list(viewer)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))
    }

    async fn require_legacy_owner(&self, viewer: &str, id: Uuid) -> Result<(), Error> {
        let view = self
            .repo
            .get(id)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .ok_or(Error::NotFound)?;
        if view.user_id != viewer {
            return Err(Error::NotOwner);
        }
        Ok(())
    }

    /// Legacy REST PATCH, preserving its shallow JSON merge.
    #[tracing::instrument(name = "saved_view.legacy_patch", skip_all, fields(view_id = %id), err)]
    pub async fn legacy_patch(
        &self,
        viewer: &str,
        id: Uuid,
        name: Option<&str>,
        config: Option<&Value>,
    ) -> Result<(), Error> {
        self.require_legacy_owner(viewer, id).await?;
        self.repo
            .legacy_patch(id, viewer, name, config)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .then_some(())
            .ok_or(Error::NotFound)
    }

    /// Legacy REST deletion with an atomic owner predicate.
    #[tracing::instrument(name = "saved_view.legacy_delete", skip_all, fields(view_id = %id), err)]
    pub async fn legacy_delete(&self, viewer: &str, id: Uuid) -> Result<(), Error> {
        self.require_legacy_owner(viewer, id).await?;
        self.repo
            .legacy_delete(id, viewer)
            .await
            .map_err(|e| Error::Internal(rootcause::Report::new(e).into_dynamic()))?
            .then_some(())
            .ok_or(Error::NotFound)
    }
}

/// Object-safe service facade for GraphQL request context injection.
/// `async_trait` is needed because the composed GraphQL schema holds a trait object.
#[async_trait::async_trait]
pub trait SavedViewApi: Send + Sync {
    /// Read one authorized view.
    async fn get(&self, viewer: &str, id: Uuid) -> Result<View, Error>;
    /// Read a bounded visible page.
    async fn list(
        &self,
        viewer: &str,
        kind: Option<&str>,
        after: Option<Cursor>,
        limit: u32,
    ) -> Result<Page, Error>;
    /// Create or replay a view.
    async fn create(
        &self,
        viewer: &str,
        id: Uuid,
        name: String,
        config: Value,
        team: Option<Uuid>,
    ) -> Result<View, Error>;
    /// Update with an expected revision.
    async fn update(
        &self,
        viewer: &str,
        id: Uuid,
        revision: i64,
        change: Update,
    ) -> Result<View, Error>;
    /// Delete with an expected revision.
    async fn delete(&self, viewer: &str, id: Uuid, revision: i64) -> Result<Uuid, Error>;
}

#[async_trait::async_trait]
impl<R: ViewRepository, M: MembershipPort> SavedViewApi for SavedViewService<R, M> {
    async fn get(&self, viewer: &str, id: Uuid) -> Result<View, Error> {
        SavedViewService::get(self, viewer, id).await
    }
    async fn list(
        &self,
        viewer: &str,
        kind: Option<&str>,
        after: Option<Cursor>,
        limit: u32,
    ) -> Result<Page, Error> {
        SavedViewService::list(self, viewer, kind, after, limit).await
    }
    async fn create(
        &self,
        viewer: &str,
        id: Uuid,
        name: String,
        config: Value,
        team: Option<Uuid>,
    ) -> Result<View, Error> {
        SavedViewService::create(self, viewer, id, name, config, team).await
    }
    async fn update(
        &self,
        viewer: &str,
        id: Uuid,
        revision: i64,
        change: Update,
    ) -> Result<View, Error> {
        SavedViewService::update(self, viewer, id, revision, change).await
    }
    async fn delete(&self, viewer: &str, id: Uuid, revision: i64) -> Result<Uuid, Error> {
        SavedViewService::delete(self, viewer, id, revision).await
    }
}
