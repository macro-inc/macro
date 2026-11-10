//! [`SubteamRepository`] over MacroDB.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::subteam::{
    CreateSubteamOutcome, NestOutcome, NewSubteam, SaveMemberOutcome, Subteam, SubteamColor,
    SubteamJoinPolicy, SubteamMember, SubteamPatch, SubteamRepository, SubteamRole,
};

#[cfg(test)]
mod test;

/// The constraint that keeps team members on the workspace.
const MEMBER_ON_WORKSPACE_CONSTRAINT: &str = "subteam_member_user_id_team_id_fkey";

/// The Postgres repository for a workspace's teams.
#[derive(Clone)]
pub struct PgSubteamRepository {
    pool: PgPool,
}

impl PgSubteamRepository {
    /// Creates the repository over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct SubteamRow {
    id: uuid::Uuid,
    parent_id: Option<uuid::Uuid>,
    name: String,
    description: String,
    color: SubteamColor,
    join_policy: SubteamJoinPolicy,
    created_at: chrono::DateTime<chrono::Utc>,
}

struct MemberRow {
    subteam_id: uuid::Uuid,
    user_id: String,
    role: SubteamRole,
}

/// Joins teams with their members, keeping the order of both.
fn assemble(subteams: Vec<SubteamRow>, members: Vec<MemberRow>) -> anyhow::Result<Vec<Subteam>> {
    let mut members_by_subteam: HashMap<uuid::Uuid, Vec<SubteamMember>> = HashMap::new();
    for member in members {
        members_by_subteam
            .entry(member.subteam_id)
            .or_default()
            .push(SubteamMember {
                user_id: MacroUserIdStr::try_from(member.user_id)?,
                role: member.role,
            });
    }

    let subteams = subteams
        .into_iter()
        .map(|row| Subteam {
            members: members_by_subteam.remove(&row.id).unwrap_or_default(),
            id: row.id,
            parent_id: row.parent_id,
            name: row.name,
            description: row.description,
            color: row.color,
            join_policy: row.join_policy,
            created_at: row.created_at,
        })
        .collect();

    Ok(subteams)
}

/// Serializes a workspace's nesting changes until `transaction` ends. Each
/// nesting write checks other rows (the parent is top level, the team has no
/// teams of its own), which a concurrent write can change before it commits.
async fn lock_nesting(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    team_id: uuid::Uuid,
) -> anyhow::Result<()> {
    let key = format!("subteam-nesting:{team_id}");
    sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
        .execute(transaction.as_mut())
        .await?;

    Ok(())
}

/// Whether `error` is a member's foreign key to the workspace failing.
fn is_not_workspace_member(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database_error| database_error.constraint())
        == Some(MEMBER_ON_WORKSPACE_CONSTRAINT)
}

impl PgSubteamRepository {
    async fn fetch(
        &self,
        team_id: uuid::Uuid,
        subteam_id: Option<uuid::Uuid>,
    ) -> anyhow::Result<Vec<Subteam>> {
        let subteams = sqlx::query_as!(
            SubteamRow,
            r#"
            SELECT
                id,
                parent_id,
                name,
                description,
                color AS "color: SubteamColor",
                join_policy AS "join_policy: SubteamJoinPolicy",
                created_at
            FROM subteam
            WHERE team_id = $1 AND ($2::uuid IS NULL OR id = $2)
            ORDER BY parent_id IS NOT NULL, lower(name), id
            "#,
            team_id,
            subteam_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let members = sqlx::query_as!(
            MemberRow,
            r#"
            SELECT
                subteam_id,
                user_id,
                role AS "role: SubteamRole"
            FROM subteam_member
            WHERE team_id = $1 AND ($2::uuid IS NULL OR subteam_id = $2)
            ORDER BY role DESC, created_at, user_id
            "#,
            team_id,
            subteam_id,
        )
        .fetch_all(&self.pool)
        .await?;

        assemble(subteams, members)
    }
}

impl SubteamRepository for PgSubteamRepository {
    #[tracing::instrument(skip(self), err)]
    async fn list_subteams(&self, team_id: uuid::Uuid) -> anyhow::Result<Vec<Subteam>> {
        self.fetch(team_id, None).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
    ) -> anyhow::Result<Option<Subteam>> {
        Ok(self.fetch(team_id, Some(subteam_id)).await?.pop())
    }

    #[tracing::instrument(skip(self, subteam, member_ids), err)]
    async fn create_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam: &NewSubteam,
        manager_id: &MacroUserIdStr<'_>,
        member_ids: &[MacroUserIdStr<'static>],
    ) -> anyhow::Result<CreateSubteamOutcome> {
        let subteam_id = uuid::Uuid::now_v7();
        let mut transaction = self.pool.begin().await?;
        if subteam.parent_id.is_some() {
            lock_nesting(&mut transaction, team_id).await?;
        }

        // The parent must be a top-level team in the same workspace.
        let inserted = sqlx::query!(
            r#"
            INSERT INTO subteam (id, team_id, parent_id, name, description, color, join_policy)
            SELECT $1, $2, $3, $4, $5, $6, $7
            WHERE $3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM subteam parent
                WHERE parent.id = $3 AND parent.team_id = $2 AND parent.parent_id IS NULL
            )
            "#,
            subteam_id,
            team_id,
            subteam.parent_id,
            subteam.name.as_str(),
            subteam.description.as_str(),
            subteam.color as SubteamColor,
            subteam.join_policy as SubteamJoinPolicy,
        )
        .execute(transaction.as_mut())
        .await?;

        if inserted.rows_affected() == 0 {
            return Ok(CreateSubteamOutcome::InvalidParent);
        }

        let mut user_ids: Vec<&str> = vec![manager_id.as_ref()];
        let mut roles = vec![SubteamRole::Manager];
        for member_id in member_ids {
            user_ids.push(member_id.as_ref());
            roles.push(SubteamRole::Member);
        }

        let members = sqlx::query!(
            r#"
            INSERT INTO subteam_member (subteam_id, team_id, user_id, role)
            SELECT $1, $2, member.user_id, member.role
            FROM UNNEST($3::text[], $4::subteam_role[]) AS member(user_id, role)
            ON CONFLICT (subteam_id, user_id) DO NOTHING
            "#,
            subteam_id,
            team_id,
            &user_ids as &[&str],
            &roles as &[SubteamRole],
        )
        .execute(transaction.as_mut())
        .await;

        match members {
            Ok(_) => {}
            Err(error) if is_not_workspace_member(&error) => {
                return Ok(CreateSubteamOutcome::NotWorkspaceMember);
            }
            Err(error) => return Err(error.into()),
        }

        transaction.commit().await?;

        let created = self
            .get_subteam(team_id, subteam_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("created team {subteam_id} is missing"))?;

        Ok(CreateSubteamOutcome::Created(created))
    }

    #[tracing::instrument(skip(self, patch), err)]
    async fn update_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        patch: &SubteamPatch,
    ) -> anyhow::Result<Option<Subteam>> {
        let updated = sqlx::query!(
            r#"
            UPDATE subteam
            SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                color = COALESCE($5, color),
                join_policy = COALESCE($6, join_policy)
            WHERE team_id = $1 AND id = $2
            "#,
            team_id,
            subteam_id,
            patch.name.as_ref().map(|name| name.as_str()),
            patch
                .description
                .as_ref()
                .map(|description| description.as_str()),
            patch.color as Option<SubteamColor>,
            patch.join_policy as Option<SubteamJoinPolicy>,
        )
        .execute(&self.pool)
        .await?;

        if updated.rows_affected() == 0 {
            return Ok(None);
        }

        self.get_subteam(team_id, subteam_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn nest_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        parent_id: Option<uuid::Uuid>,
    ) -> anyhow::Result<NestOutcome> {
        let mut transaction = self.pool.begin().await?;
        lock_nesting(&mut transaction, team_id).await?;

        let nested = sqlx::query!(
            r#"
            UPDATE subteam
            SET parent_id = $3
            WHERE team_id = $1 AND id = $2 AND (
                $3::uuid IS NULL OR (
                    $3 <> $2
                    AND EXISTS (
                        SELECT 1 FROM subteam parent
                        WHERE parent.id = $3 AND parent.team_id = $1 AND parent.parent_id IS NULL
                    )
                    AND NOT EXISTS (SELECT 1 FROM subteam child WHERE child.parent_id = $2)
                )
            )
            "#,
            team_id,
            subteam_id,
            parent_id,
        )
        .execute(transaction.as_mut())
        .await?;
        transaction.commit().await?;

        if nested.rows_affected() > 0 {
            return Ok(NestOutcome::Nested);
        }

        let exists = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM subteam WHERE team_id = $1 AND id = $2) AS "exists!""#,
            team_id,
            subteam_id,
        )
        .fetch_one(&self.pool)
        .await?;

        if exists {
            Ok(NestOutcome::InvalidParent)
        } else {
            Ok(NestOutcome::SubteamNotFound)
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
    ) -> anyhow::Result<bool> {
        let deleted = sqlx::query!(
            "DELETE FROM subteam WHERE team_id = $1 AND id = $2",
            team_id,
            subteam_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(deleted.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn save_subteam_member(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        role: SubteamRole,
    ) -> anyhow::Result<SaveMemberOutcome> {
        let saved = sqlx::query!(
            r#"
            INSERT INTO subteam_member (subteam_id, team_id, user_id, role)
            SELECT id, team_id, $3, $4
            FROM subteam
            WHERE team_id = $1 AND id = $2
            ON CONFLICT (subteam_id, user_id) DO UPDATE SET role = EXCLUDED.role
            "#,
            team_id,
            subteam_id,
            user_id.as_ref(),
            role as SubteamRole,
        )
        .execute(&self.pool)
        .await;

        match saved {
            Ok(result) if result.rows_affected() == 0 => Ok(SaveMemberOutcome::SubteamNotFound),
            Ok(_) => Ok(SaveMemberOutcome::Saved),
            Err(error) if is_not_workspace_member(&error) => {
                Ok(SaveMemberOutcome::NotWorkspaceMember)
            }
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_subteam_member(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            "DELETE FROM subteam_member WHERE team_id = $1 AND subteam_id = $2 AND user_id = $3",
            team_id,
            subteam_id,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
