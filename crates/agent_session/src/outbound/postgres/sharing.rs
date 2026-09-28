//! Session sharing stored alongside canonical entity-access grants.

use super::PgAgentSessionRepo;
use crate::domain::{
    error::{AgentSessionError, Result},
    model::AgentSessionId,
    sharing::SessionSharingRepo,
};
use anyhow::Context;
use entity_access_db_utils::update_entity_access_channel_share_permissions;
use model_entity::EntityType;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
    channel_share_permission::ChannelSharePermission,
    team_share::{AuthorizedTeamShareCommand, TeamShareFacts},
};
use share_permission_db_utils::team_share::{self, TeamShareError};

#[cfg(test)]
mod test;

fn team_error(error: rootcause::Report<TeamShareError>) -> AgentSessionError {
    match error.current_context() {
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            AgentSessionError::SharingChanged
        }
        _ => AgentSessionError::Unknown(anyhow::anyhow!("{error:?}")),
    }
}

impl SessionSharingRepo for PgAgentSessionRepo {
    #[tracing::instrument(skip(self), err)]
    async fn permissions(&self, id: AgentSessionId) -> Result<SharePermissionV2> {
        let row = sqlx::query!(
            r#"SELECT s.owner_id, s.share_permission_id,
                sp."linkShare" AS "link_share: LinkShare",
                sp."linkShareAccessLevel" AS "link_level: AccessLevel",
                sp.team_share_access_level AS "team_level: AccessLevel"
            FROM agent_session s
            LEFT JOIN "SharePermission" sp ON sp.id = s.share_permission_id
            WHERE s.id = $1"#,
            id.as_uuid(),
        )
        .fetch_one(&self.pool)
        .await
        .context("read agent session sharing settings")?;
        let channels = sqlx::query!(
            r#"SELECT source_id AS channel_id, access_level AS "access_level: AccessLevel"
            FROM entity_access
            WHERE entity_id = $1 AND entity_type = 'agent_session' AND source_type = 'channel'
                AND granted_from_project_id IS NULL
            ORDER BY source_id"#,
            id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .context("read agent session channel access")?;
        Ok(SharePermissionV2 {
            id: row.share_permission_id.unwrap_or_else(|| id.to_string()),
            owner: row.owner_id,
            link_share: row.link_share,
            link_share_access_level: row.link_level,
            team_share_access_level: row.team_level,
            channel_share_permissions: Some(
                channels
                    .into_iter()
                    .map(|row| ChannelSharePermission {
                        channel_id: row.channel_id,
                        access_level: row.access_level,
                    })
                    .collect(),
            ),
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn team_share_facts(&self, id: AgentSessionId) -> Result<TeamShareFacts> {
        let mut tx = self
            .pool
            .begin()
            .await
            .context("begin session sharing facts read")?;
        let entity = EntityType::AgentSession.with_entity_string(id.to_string());
        let facts = team_share::load_facts(&mut tx, &entity)
            .await
            .map_err(team_error)?;
        tx.commit()
            .await
            .context("complete session sharing facts read")?;
        Ok(facts)
    }

    #[tracing::instrument(skip(self, request, team_share), err)]
    async fn update_permissions(
        &self,
        id: AgentSessionId,
        request: UpdateSharePermissionRequestV2,
        team_share: Option<AuthorizedTeamShareCommand>,
    ) -> Result<SharePermissionV2> {
        let mut tx = self
            .pool
            .begin()
            .await
            .context("begin session sharing update")?;
        team_share::acquire_guard(&mut tx)
            .await
            .context("lock sharing topology")?;
        let row = sqlx::query!(
            "SELECT share_permission_id FROM agent_session WHERE id = $1 FOR UPDATE",
            id.as_uuid(),
        )
        .fetch_one(tx.as_mut())
        .await
        .context("lock agent session sharing settings")?;
        let permission_id = match row.share_permission_id {
            Some(id) => id,
            None => {
                let permission_id = macro_uuid::generate_uuid_v7().to_string();
                sqlx::query!(
                    r#"INSERT INTO "SharePermission" (id, "createdAt", "updatedAt") VALUES ($1, NOW(), NOW())"#,
                    permission_id,
                )
                .execute(tx.as_mut())
                .await
                .context("create session sharing settings")?;
                sqlx::query!(
                    "UPDATE agent_session SET share_permission_id = $2 WHERE id = $1",
                    id.as_uuid(),
                    permission_id,
                )
                .execute(tx.as_mut())
                .await
                .context("attach session sharing settings")?;
                permission_id
            }
        };
        let update_scope = request.link_share.is_some();
        let scope = request.link_share.flatten().map(|scope| scope.to_string());
        let update_level = request.link_share_access_level.is_some();
        let level = request.link_share_access_level.flatten();
        sqlx::query!(
            r#"UPDATE "SharePermission" SET
                "linkShare" = CASE WHEN $2 THEN $3 ELSE "linkShare" END,
                "linkShareAccessLevel" = CASE
                    WHEN $2 AND $3 IS NULL THEN NULL
                    WHEN $2 THEN COALESCE($5::"AccessLevel", 'view')
                    WHEN $4 AND "linkShare" IS NOT NULL THEN COALESCE($5::"AccessLevel", 'view')
                    WHEN $4 THEN NULL
                    ELSE "linkShareAccessLevel"
                END,
                "updatedAt" = NOW()
            WHERE id = $1"#,
            permission_id,
            update_scope,
            scope,
            update_level,
            level as Option<AccessLevel>,
        )
        .execute(tx.as_mut())
        .await
        .context("update session link sharing")?;
        if let Some(channels) = request.channel_share_permissions {
            update_entity_access_channel_share_permissions(
                &mut tx,
                &id.as_uuid(),
                EntityType::AgentSession,
                &channels,
            )
            .await
            .context("update session channel access")?;
        }
        if let Some(command) = team_share {
            team_share::apply(&mut tx, &command)
                .await
                .map_err(team_error)?;
        }
        tx.commit().await.context("commit session sharing update")?;
        self.permissions(id).await
    }
}
