//! PostgreSQL implementation of [`InitiativeRepo`].

mod create;
mod list;
mod members;
mod share;
mod tasks;

#[cfg(test)]
mod test;

use std::str::FromStr;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use models_permissions::share_permission::team_share::TeamShareCreation;
use models_permissions::share_permission::{LinkShare, SharePermissionV2, TeamLinkShareDefault};
use rootcause::prelude::*;
use share_permission_db_utils::team_share::TeamShareError;
use sqlx::postgres::PgDatabaseError;
use sqlx::{Executor, PgPool, Postgres};

use crate::domain::events::{AssignedTasks, TaskMembershipChange};
use crate::domain::models::{
    CreateInitiativeRepoArgs, DescriptionDocumentId, InitiativeBasic, InitiativeDetail,
    InitiativeError, InitiativeId, InitiativeList, LockstepTeamShareFacts,
    UpdateInitiativeRepoArgs,
};
use crate::domain::ports::InitiativeRepo;

const DETAIL_ACCESS_WITHOUT_ACTOR: AccessLevel = AccessLevel::View;

/// Postgres' generated name for the `UNIQUE` on `initiative.description_document_id`.
const DESCRIPTION_DOCUMENT_UNIQUE: &str = "initiative_description_document_id_key";

/// PostgreSQL `InitiativeRepo`. One pool. One transaction per mutation.
#[derive(Clone)]
pub struct PgInitiativeRepo {
    pool: PgPool,
}

impl PgInitiativeRepo {
    /// Wire at the composition root. Not constructed from inbound or domain.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl InitiativeRepo for PgInitiativeRepo {
    type Err = InitiativeError;

    #[tracing::instrument(err, skip(self, args, share_permission))]
    async fn create(
        &self,
        args: CreateInitiativeRepoArgs,
        share_permission: SharePermissionV2,
        team_share: TeamShareCreation,
    ) -> Result<InitiativeDetail, Self::Err> {
        create::create(&self.pool, args, share_permission, team_share).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_basic(&self, id: InitiativeId) -> Result<Option<InitiativeBasic>, Self::Err> {
        load_record(&self.pool, id)
            .await
            .map_err(AdapterError::Sqlx)
            .map_err(map_sqlx)?
            .map(InitiativeRecord::into_basic)
            .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_detail(&self, id: InitiativeId) -> Result<Option<InitiativeDetail>, Self::Err> {
        load_record(&self.pool, id)
            .await
            .map_err(AdapterError::Sqlx)
            .map_err(map_sqlx)?
            .map(InitiativeRecord::into_detail)
            .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn list_accessible(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<InitiativeList, Self::Err> {
        list::list_accessible(&self.pool, user_id).await
    }

    async fn task_memberships(
        &self,
        task_ids: Vec<String>,
    ) -> Result<std::collections::HashMap<String, InitiativeId>, Self::Err> {
        let rows = sqlx::query!(
            "SELECT task_id, initiative_id FROM task_initiative WHERE task_id = ANY($1)",
            &task_ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(classify_sqlx)?;
        Ok(rows
            .into_iter()
            .map(|row| (row.task_id, InitiativeId::from_uuid(row.initiative_id)))
            .collect())
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn update(&self, args: UpdateInitiativeRepoArgs) -> Result<InitiativeDetail, Self::Err> {
        create::update(&self.pool, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_share_facts(
        &self,
        id: InitiativeId,
    ) -> Result<LockstepTeamShareFacts, Self::Err> {
        share::get_lockstep_team_share_facts(&self.pool, id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_default_link_share(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Option<TeamLinkShareDefault>, Self::Err> {
        share::get_team_default_link_share(&self.pool, user_id).await
    }

    #[tracing::instrument(err, skip(self, task_ids))]
    async fn assign_tasks(
        &self,
        id: InitiativeId,
        task_ids: Vec<String>,
    ) -> Result<AssignedTasks, Self::Err> {
        tasks::assign_tasks(&self.pool, id, task_ids).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn unassign_task(
        &self,
        id: InitiativeId,
        task_id: &str,
    ) -> Result<Option<TaskMembershipChange>, Self::Err> {
        tasks::unassign_task(&self.pool, id, task_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn clear_task(&self, task_id: &str) -> Result<Option<TaskMembershipChange>, Self::Err> {
        tasks::clear_task(&self.pool, task_id).await
    }

    #[tracing::instrument(err, skip_all)]
    async fn grant_assignees(
        &self,
        id: InitiativeId,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Self::Err> {
        members::grant_assignees(&self.pool, id, &user_ids).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(&self, id: InitiativeId) -> Result<DescriptionDocumentId, Self::Err> {
        create::delete(&self.pool, id).await
    }
}

/// Both entities every grant write targets. Built once per mutation so no path
/// can grant on the initiative and forget the document.
#[derive(Debug, Clone, Copy)]
struct GrantTargets {
    initiative: uuid::Uuid,
    description: uuid::Uuid,
}

impl GrantTargets {
    fn new(initiative: InitiativeId, description: DescriptionDocumentId) -> Self {
        Self {
            initiative: initiative.as_uuid(),
            description: description.as_uuid(),
        }
    }

    fn initiative_id(&self) -> uuid::Uuid {
        self.initiative
    }

    fn description_id(&self) -> uuid::Uuid {
        self.description
    }

    fn initiative_entity(&self) -> Entity<'static> {
        EntityType::Initiative.with_entity_string(self.initiative.to_string())
    }

    fn description_entity(&self) -> Entity<'static> {
        EntityType::Document.with_entity_string(self.description.to_string())
    }

    fn each(&self) -> [(uuid::Uuid, EntityType); 2] {
        [
            (self.initiative, EntityType::Initiative),
            (self.description, EntityType::Document),
        ]
    }
}

struct InitiativeRecord {
    id: uuid::Uuid,
    name: String,
    description_document_id: String,
    owner_user_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    share_permission_id: String,
    member_ids: Vec<String>,
    task_ids: Vec<String>,
    link_share: Option<String>,
    link_share_access_level: Option<AccessLevel>,
    team_share_access_level: Option<AccessLevel>,
    channel_share_permissions: serde_json::Value,
}

impl InitiativeRecord {
    fn into_basic(self) -> Result<InitiativeBasic, InitiativeError> {
        Ok(InitiativeBasic {
            id: InitiativeId::from_uuid(self.id),
            name: self.name,
            owner_id: parse_owner(&self.owner_user_id)?,
        })
    }

    fn into_detail(self) -> Result<InitiativeDetail, InitiativeError> {
        let share_permission = share_permission_from_record(&self)?;
        let owner_id = parse_owner(&self.owner_user_id)?;
        Ok(InitiativeDetail {
            id: InitiativeId::from_uuid(self.id),
            name: self.name,
            description_document_id: parse_description_document_id(
                self.id,
                &self.description_document_id,
            )?,
            owner_id,
            member_ids: parse_members(self.member_ids)?,
            task_ids: self.task_ids,
            share_permission,
            user_access_level: DETAIL_ACCESS_WITHOUT_ACTOR,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn parse_description_document_id(
    initiative: uuid::Uuid,
    raw: &str,
) -> Result<DescriptionDocumentId, InitiativeError> {
    DescriptionDocumentId::from_str(raw).map_err(|error| {
        InitiativeError::Internal(report!(
            "initiative {initiative} has a non-UUID description document id {raw:?}: {error}"
        ))
    })
}

fn parse_owner(raw: &str) -> Result<MacroUserIdStr<'static>, InitiativeError> {
    MacroUserIdStr::parse_from_str(raw)
        .map(|id| id.into_owned())
        .map_err(|error| map_sqlx(AdapterError::Sqlx(sqlx::Error::Decode(Box::new(error)))))
}

fn parse_members(raw: Vec<String>) -> Result<Vec<MacroUserIdStr<'static>>, InitiativeError> {
    raw.into_iter()
        .filter(|id| !id.is_empty())
        .map(|id| parse_owner(&id))
        .collect()
}

fn share_permission_from_record(
    record: &InitiativeRecord,
) -> Result<SharePermissionV2, InitiativeError> {
    let channel_share_permissions = serde_json::from_value::<Vec<ChannelSharePermission>>(
        record.channel_share_permissions.clone(),
    )
    .map_err(|error| map_sqlx(AdapterError::Sqlx(sqlx::Error::Decode(Box::new(error)))))?;
    let channel_share_permissions =
        Some(channel_share_permissions).filter(|permissions| !permissions.is_empty());
    let link_share = record
        .link_share
        .as_deref()
        .map(|value| {
            LinkShare::from_str(value)
                .map_err(|error| map_sqlx(AdapterError::Sqlx(sqlx::Error::Decode(Box::new(error)))))
        })
        .transpose()?;
    Ok(SharePermissionV2 {
        id: record.share_permission_id.clone(),
        link_share,
        link_share_access_level: record.link_share_access_level,
        team_share_access_level: record.team_share_access_level,
        owner: record.owner_user_id.clone(),
        channel_share_permissions,
    })
}

enum AdapterError {
    Sqlx(sqlx::Error),
    TeamShareCreate(rootcause::Report<TeamShareError>),
    TeamShare(rootcause::Report<TeamShareError>),
}

fn map_sqlx(error: AdapterError) -> InitiativeError {
    match error {
        AdapterError::Sqlx(sqlx_error) => classify_sqlx(sqlx_error),
        AdapterError::TeamShareCreate(error) => match error.current_context() {
            TeamShareError::InvalidState => InitiativeError::BadRequest(
                "initiative owner does not belong to a team".to_string(),
            ),
            other => classify_team_share(*other, error),
        },
        AdapterError::TeamShare(error) => {
            let kind = *error.current_context();
            classify_team_share(kind, error)
        }
    }
}

fn classify_sqlx(error: sqlx::Error) -> InitiativeError {
    if let Some(db) = error.as_database_error() {
        if db.is_unique_violation() {
            // A second initiative on the same document is a bug in this path, not a caller error.
            if db.constraint() == Some(DESCRIPTION_DOCUMENT_UNIQUE) {
                return InitiativeError::Internal(report!(
                    "description document already linked to another initiative: {error}"
                ));
            }
            return InitiativeError::Conflict("initiative already exists".to_string());
        }
        if is_initiative_member_fk(db) {
            return InitiativeError::BadRequest("unknown member".to_string());
        }
    }
    InitiativeError::Internal(error.into())
}

fn is_initiative_member_fk(db: &dyn sqlx::error::DatabaseError) -> bool {
    if db.code().as_deref() != Some("23503") {
        return false;
    }
    db.try_downcast_ref::<PgDatabaseError>().is_some_and(|pg| {
        pg.table() == Some("initiative_member")
            || pg
                .constraint()
                .is_some_and(|constraint| constraint.contains("initiative_member"))
    })
}

fn classify_team_share(
    kind: TeamShareError,
    error: rootcause::Report<TeamShareError>,
) -> InitiativeError {
    match kind {
        TeamShareError::NotFound => InitiativeError::NotFound,
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            InitiativeError::Conflict(error.to_string())
        }
        _ => InitiativeError::Internal(error.into()),
    }
}

async fn load_record(
    executor: impl Executor<'_, Database = Postgres>,
    id: InitiativeId,
) -> Result<Option<InitiativeRecord>, sqlx::Error> {
    let id = id.as_uuid();
    let row = sqlx::query!(
        r#"
        SELECT
            i.id,
            i.name,
            i.description_document_id,
            i.owner_user_id,
            i.created_at,
            i.updated_at,
            i.share_permission_id,
            COALESCE(
                array_agg(DISTINCT m.user_id) FILTER (WHERE m.user_id IS NOT NULL),
                '{}'::text[]
            ) AS "member_ids!",
            COALESCE(
                array_agg(DISTINCT t.task_id) FILTER (WHERE t.task_id IS NOT NULL),
                '{}'::text[]
            ) AS "task_ids!",
            sp."linkShare" AS "link_share?",
            sp."linkShareAccessLevel" AS "link_share_access_level?: AccessLevel",
            sp.team_share_access_level AS "team_share_access_level?: AccessLevel",
            COALESCE(
                (
                    SELECT json_agg(json_build_object(
                        'channel_id', channel."channel_id",
                        'access_level', channel."access_level"
                    ))
                    FROM "ChannelSharePermission" channel
                    WHERE channel."share_permission_id" = i.share_permission_id
                ),
                '[]'::json
            ) AS "channel_share_permissions!"
        FROM initiative i
        JOIN "SharePermission" sp ON sp.id = i.share_permission_id
        LEFT JOIN initiative_member m ON m.initiative_id = i.id
        LEFT JOIN task_initiative t ON t.initiative_id = i.id
        WHERE i.id = $1
        GROUP BY
            i.id,
            i.name,
            i.description_document_id,
            i.owner_user_id,
            i.created_at,
            i.updated_at,
            i.share_permission_id,
            sp."linkShare",
            sp."linkShareAccessLevel",
            sp.team_share_access_level
        "#,
        id,
    )
    .fetch_optional(executor)
    .await?;

    Ok(row.map(|row| InitiativeRecord {
        id: row.id,
        name: row.name,
        description_document_id: row.description_document_id,
        owner_user_id: row.owner_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        share_permission_id: row.share_permission_id,
        member_ids: row.member_ids,
        task_ids: row.task_ids,
        link_share: row.link_share,
        link_share_access_level: row.link_share_access_level,
        team_share_access_level: row.team_share_access_level,
        channel_share_permissions: row.channel_share_permissions,
    }))
}

async fn require_detail(
    executor: impl Executor<'_, Database = Postgres>,
    id: InitiativeId,
) -> Result<InitiativeDetail, InitiativeError> {
    load_record(executor, id)
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?
        .ok_or_else(|| {
            InitiativeError::Internal(report!("initiative missing after successful write"))
        })?
        .into_detail()
}
