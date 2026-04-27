//! Implementation for TeamRepository using MacroDB.
use crate::domain::{
    model::{
        AcceptedTeamInvite, CreateTeamError, InviteUsersToTeamError, PatchTeamRequest,
        RemoveTeamInviteError, RemoveUserFromTeamError, Team, TeamError, TeamInvite,
        TeamInviteDetails, TeamInviteSnapshot, TeamMember, TeamRole, TeamUserTier, TeamWithMembers,
    },
    team_repo::TeamRepository,
};
use macro_user_id::{
    cowlike::CowLike, email::Email, lowercased::Lowercase, user_id::MacroUserIdStr,
};
use sqlx::{PgPool, Row};
use std::str::FromStr;

/// utility fn for queries to create a sqlx err
fn type_err<E: std::fmt::Display>(e: E) -> sqlx::Error {
    sqlx::Error::TypeNotFound {
        type_name: e.to_string(),
    }
}

#[cfg(test)]
mod test;

/// The TeamRepositoryImpl struct is a wrapper around sqlx::PgPool connected to macrodb.
#[derive(Clone)]
pub struct TeamRepositoryImpl {
    /// The underlying sqlx::PgPool connected to macrodb.
    pool: PgPool,
}

impl TeamRepositoryImpl {
    /// Creates a new instance of TeamRepositoryImpl
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl TeamRepositoryImpl {
    /// Bumps the teams seat count by the quantity number (positive or negative)
    #[tracing::instrument(skip(transaction), err)]
    async fn bump_seat_count<'t>(
        transaction: &mut sqlx::Transaction<'t, sqlx::Postgres>,
        team_id: &uuid::Uuid,
        quantity: i32,
    ) -> Result<(), anyhow::Error> {
        sqlx::query!(
            r#"
            UPDATE team
            SET seat_count = seat_count + $2
            WHERE id = $1
        "#,
            team_id,
            quantity
        )
        .execute(transaction.as_mut())
        .await?;

        Ok(())
    }

    /// Gets the owner of a team
    #[tracing::instrument(skip(self), err)]
    async fn get_team_owner(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<MacroUserIdStr<'_>, anyhow::Error> {
        let owner_id = sqlx::query!(
            r#"
            SELECT owner_id
            FROM team
            WHERE id = $1
        "#,
            team_id,
        )
        .map(|row| row.owner_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(MacroUserIdStr::parse_from_str(owner_id.as_str()).map(|id| id.into_owned())?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_team_inner(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
        team_user_tier: &TeamUserTier,
    ) -> Result<Team, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;

        let id = macro_uuid::generate_uuid_v7();

        let team = sqlx::query!(
            r#"
            INSERT INTO team (id, name, owner_id)
            VALUES ($1, $2, $3)
            RETURNING id, name, owner_id
            "#,
            &id,
            team_name,
            user_id.as_ref(),
        )
        .try_map(|row| {
            Ok(Team {
                id: row.id,
                name: row.name,
                owner_id: MacroUserIdStr::parse_from_str(&row.owner_id)
                    .map_err(type_err)?
                    .into_owned(),
            })
        })
        .fetch_one(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO team_user (team_id, user_id, team_role, tier)
            VALUES ($1, $2, 'owner', $3)
            "#,
            &team.id,
            user_id.as_ref(),
            team_user_tier as _,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(team)
    }
}

impl From<sqlx::Error> for TeamError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => Self::TeamDoesNotExist,
            _ => Self::StorageLayerError(e.into()),
        }
    }
}

impl From<sqlx::Error> for CreateTeamError {
    fn from(e: sqlx::Error) -> Self {
        Self::StorageLayerError(e.into())
    }
}

impl From<sqlx::Error> for InviteUsersToTeamError {
    fn from(e: sqlx::Error) -> Self {
        Self::StorageLayerError(e.into())
    }
}

impl From<sqlx::Error> for RemoveUserFromTeamError {
    fn from(e: sqlx::Error) -> Self {
        Self::StorageLayerError(e.into())
    }
}

impl From<sqlx::Error> for RemoveTeamInviteError {
    fn from(e: sqlx::Error) -> Self {
        Self::StorageLayerError(e.into())
    }
}

impl TeamRepository for TeamRepositoryImpl {
    #[tracing::instrument(skip(self), err)]
    async fn get_stripe_customer_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<stripe::CustomerId>, TeamError> {
        let stripe_customer_id = sqlx::query!(
            r#"
            SELECT "stripeCustomerId" as "stripe_customer_id?"
            FROM "User"
            WHERE id = $1
        "#,
            user_id.as_ref()
        )
        .map(|row| row.stripe_customer_id)
        .fetch_one(&self.pool)
        .await?;

        if let Some(stripe_customer_id) = stripe_customer_id {
            let stripe_customer_id =
                stripe::CustomerId::from_str(&stripe_customer_id).map_err(|_| {
                    TeamError::StorageLayerError(anyhow::anyhow!(
                        "unable to parse stripe customer id"
                    ))
                })?;
            Ok(Some(stripe_customer_id))
        } else {
            Ok(None)
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_subscription_id(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Option<stripe::SubscriptionId>, TeamError> {
        let team_subscription_id = sqlx::query!(
            r#"
            SELECT subscription_id
            FROM team
            WHERE id = $1
        "#,
            team_id,
        )
        .map(|row| row.subscription_id)
        .fetch_one(&self.pool)
        .await?;

        let team_subscription_id = if let Some(subscription_id) = team_subscription_id {
            Some(
                stripe::SubscriptionId::from_str(&subscription_id)
                    .map_err(|_| TeamError::InvalidSubscriptionId)?,
            )
        } else {
            None
        };

        Ok(team_subscription_id)
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
        team_user_tier: &TeamUserTier,
    ) -> Result<Team, CreateTeamError> {
        if team_name.is_empty() || team_name.len() > 50 {
            return Err(CreateTeamError::InvalidTeamName(team_name.to_string()));
        }

        self.create_team_inner(user_id, team_name, team_user_tier)
            .await
            .map_err(|e| e.into())
    }

    #[tracing::instrument(skip(self), err)]
    async fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
        emails: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError> {
        // Convert emails to strings and macro_user_ids once
        let email_strings: Vec<String> = emails.iter().map(|e| e.as_ref().to_string()).collect();

        let macro_user_ids: Vec<String> = emails
            .iter()
            .map(|email| format!("macro|{}", email.as_ref()))
            .collect();

        // Generate UUIDs for all emails upfront
        let team_invite_ids: Vec<uuid::Uuid> = emails
            .iter()
            .map(|_| macro_uuid::generate_uuid_v7())
            .collect();

        let mut transaction = self.pool.begin().await?;

        // Single query that filters out both already invited AND already on team
        let invites: Vec<(uuid::Uuid, uuid::Uuid, String)> = sqlx::query!(
        r#"
            INSERT INTO team_invite (id, team_id, email, team_role, invited_by, created_at, last_sent_at)
            SELECT 
                t.id,
                $1::uuid,
                t.email,
                $2,
                $3::text,
                NOW(),
                NOW()
            FROM UNNEST($4::uuid[], $5::text[], $6::text[]) AS t(id, email, user_id)
            WHERE NOT EXISTS (
                SELECT 1 FROM team_invite ti 
                WHERE ti.team_id = $1 AND ti.email = t.email
            )
            AND NOT EXISTS (
                SELECT 1 FROM team_user tu 
                WHERE tu.team_id = $1 AND tu.user_id = t.user_id
            )
            RETURNING id, team_id, email
        "#,
        team_id,
        TeamRole::Member as _,
        invited_by.as_ref(),
        &team_invite_ids[..],
        &email_strings[..],
        &macro_user_ids[..]
    )
    .map(|r| (r.id, r.team_id, r.email))
    .fetch_all(&mut *transaction)
    .await?;

        // Also re-send existing invites whose rate limit window has passed
        let resent_invites: Vec<(uuid::Uuid, uuid::Uuid, String)> = sqlx::query!(
            r#"
            SELECT id, team_id, email
            FROM team_invite
            WHERE team_id = $1
              AND email = ANY($2::text[])
              AND last_sent_at < NOW() - INTERVAL '5 minutes'
            "#,
            team_id,
            &email_strings[..],
        )
        .map(|r| (r.id, r.team_id, r.email))
        .fetch_all(&mut *transaction)
        .await?;

        let to_email = |id: uuid::Uuid, team_id: uuid::Uuid, email: String| {
            Email::parse_from_str(&email)
                .ok()
                .map(|e| e.into_owned().lowercase())
                .map(|email| TeamInvite {
                    team_id,
                    team_invite_id: id,
                    email,
                })
        };

        // Combine new invites and resent invites
        let all_invites: Vec<TeamInvite<'static>> = invites
            .into_iter()
            .chain(resent_invites)
            .filter_map(|(id, team_id, email)| to_email(id, team_id, email))
            .collect();

        transaction.commit().await?;

        Ok(all_invites)
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_invites_sent(&self, invite_ids: &[uuid::Uuid]) -> Result<(), TeamError> {
        sqlx::query!(
            r#"
            UPDATE team_invite
            SET last_sent_at = NOW()
            WHERE id = ANY($1::uuid[])
            "#,
            invite_ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamMember<'static>, RemoveUserFromTeamError> {
        let owner_id = self.get_team_owner(team_id).await?;

        if user_id.as_ref().eq(owner_id.as_ref()) {
            return Err(RemoveUserFromTeamError::CannotRemoveOwner);
        }

        let mut transaction = self.pool.begin().await?;

        let row = sqlx::query(
            r#"
            DELETE FROM team_user
            WHERE team_id = $1 AND user_id = $2
            RETURNING team_role, tier
            "#,
        )
        .bind(team_id)
        .bind(user_id.as_ref())
        .fetch_optional(&mut *transaction)
        .await?;

        let Some(row) = row else {
            return Err(RemoveUserFromTeamError::UserNotInTeam);
        };

        let removed_member = TeamMember {
            team_id: *team_id,
            user_id: user_id.clone().into_owned(),
            role: row.try_get("team_role")?,
            tier: row.try_get("tier")?,
        };

        TeamRepositoryImpl::bump_seat_count(&mut transaction, team_id, -1).await?;

        transaction.commit().await?;

        Ok(removed_member)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_invite_by_id(
        &self,
        team_invite_id: &uuid::Uuid,
    ) -> Result<TeamInvite<'_>, TeamError> {
        let team_invite: (uuid::Uuid, uuid::Uuid, String) = sqlx::query!(
            r#"
            SELECT id, email, team_id
            FROM team_invite
            WHERE id = $1
            "#,
            team_invite_id,
        )
        .map(|row| (row.id, row.team_id, row.email))
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::RowNotFound => TeamError::TeamInviteDoesNotExist,
            _ => e.into(),
        })?;

        let (id, team_id, email) = team_invite;

        let team_invite: TeamInvite = TeamInvite {
            team_id,
            team_invite_id: id,
            email: Email::parse_from_str(&email)
                .map(|e| e.into_owned().lowercase())
                .map_err(|e| anyhow::anyhow!("unable to parse email {}", e))?,
        };

        Ok(team_invite.to_owned())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_team_invite(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query!(
            r#"
            DELETE FROM team_invite
            WHERE id = $1 AND team_id = $2
            "#,
            team_invite_id,
            team_id,
        )
        .execute(&mut *transaction)
        .await?;

        if result.rows_affected() == 0 {
            return Err(RemoveTeamInviteError::TeamInviteDoesNotExist);
        }

        transaction.commit().await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn update_team_subscription(
        &self,
        team_id: &uuid::Uuid,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<(), TeamError> {
        sqlx::query!(
            r#"
            UPDATE team
            SET subscription_id = $2
            WHERE id = $1
            "#,
            team_id,
            subscription_id.to_string(),
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_team(&self, team_id: &uuid::Uuid) -> Result<(), TeamError> {
        sqlx::query!(
            r#"
            DELETE FROM team
            WHERE id = $1
            "#,
            team_id,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_all_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamMember<'_>>, TeamError> {
        let members = sqlx::query!(
            r#"
            SELECT user_id, 
                team_role as "team_role!: TeamRole",
                tier as "tier!: TeamUserTier"
            FROM team_user
            WHERE team_id = $1
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let members: Vec<Result<TeamMember, anyhow::Error>> = members
            .into_iter()
            .map(|row| {
                let user_id =
                    MacroUserIdStr::parse_from_str(&row.user_id).map(|id| id.into_owned());

                if let Ok(user_id) = user_id {
                    Ok(TeamMember {
                        user_id,
                        role: row.team_role,
                        team_id: *team_id,
                        tier: row.tier,
                    })
                } else {
                    Err(anyhow::anyhow!("unable to parse user id"))
                }
            })
            .collect();

        let members = members
            .into_iter()
            .filter_map(|member| member.ok())
            .collect();

        Ok(members)
    }

    #[tracing::instrument(skip(self), err)]
    async fn accept_team_invite(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<AcceptedTeamInvite<'static>, TeamError> {
        let mut transaction = self.pool.begin().await?;

        let user_email = user_id.email_part().lowercase();

        // Get invite data before deleting it so the accept can be rolled back later.
        let invite = sqlx::query(
            r#"
            SELECT id, email, team_role, team_id, invited_by, created_at, last_sent_at, tier
            FROM team_invite
            WHERE id = $1 AND email = $2
            "#,
        )
        .bind(team_invite_id)
        .bind(user_email.as_ref())
        .fetch_one(&mut *transaction)
        .await?;

        let invite_snapshot = TeamInviteSnapshot {
            id: invite.try_get("id")?,
            team_id: invite.try_get("team_id")?,
            email: Email::parse_from_str(invite.try_get::<String, _>("email")?.as_str())
                .map(|e| e.into_owned().lowercase())
                .map_err(|e| TeamError::StorageLayerError(e.into()))?,
            team_role: invite.try_get("team_role")?,
            invited_by: MacroUserIdStr::parse_from_str(
                invite.try_get::<String, _>("invited_by")?.as_str(),
            )
            .map(|id| id.into_owned())
            .map_err(|e| TeamError::StorageLayerError(e.into()))?,
            created_at: chrono::DateTime::from_naive_utc_and_offset(
                invite.try_get("created_at")?,
                chrono::Utc,
            ),
            last_sent_at: chrono::DateTime::from_naive_utc_and_offset(
                invite.try_get("last_sent_at")?,
                chrono::Utc,
            ),
            tier: invite.try_get("tier")?,
        };

        // Assign user to team_user
        let team_member = sqlx::query(
            r#"
            INSERT INTO team_user (team_id, user_id, team_role, tier)
            VALUES ($1, $2, $3, $4)
            RETURNING user_id, team_role, tier, team_id
            "#,
        )
        .bind(invite_snapshot.team_id)
        .bind(user_id.as_ref())
        .bind(invite_snapshot.team_role)
        .bind(invite_snapshot.tier)
        .fetch_one(&mut *transaction)
        .await?;

        // bump seat count
        let team_id: uuid::Uuid = team_member.try_get("team_id")?;
        TeamRepositoryImpl::bump_seat_count(&mut transaction, &team_id, 1).await?;

        // Remove team invite
        sqlx::query(
            r#"
            DELETE FROM team_invite
            WHERE id = $1
            "#,
        )
        .bind(team_invite_id)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        let member = TeamMember {
            user_id: MacroUserIdStr::parse_from_str(
                team_member.try_get::<String, _>("user_id")?.as_str(),
            )
            .map(|id| id.into_owned())
            .map_err(|e| TeamError::StorageLayerError(e.into()))?,
            role: team_member.try_get("team_role")?,
            team_id,
            tier: team_member.try_get("tier")?,
        };

        Ok(AcceptedTeamInvite {
            member,
            invite: invite_snapshot,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn rollback_accept_team_invite(
        &self,
        accepted_invite: &AcceptedTeamInvite<'_>,
    ) -> Result<(), TeamError> {
        let mut transaction = self.pool.begin().await?;

        let deleted = sqlx::query(
            r#"
            DELETE FROM team_user
            WHERE team_id = $1 AND user_id = $2
            "#,
        )
        .bind(accepted_invite.member.team_id)
        .bind(accepted_invite.member.user_id.as_ref())
        .execute(&mut *transaction)
        .await?;

        if deleted.rows_affected() > 0 {
            TeamRepositoryImpl::bump_seat_count(
                &mut transaction,
                &accepted_invite.member.team_id,
                -1,
            )
            .await?;
        }

        sqlx::query(
            r#"
            INSERT INTO team_invite
                (id, team_id, email, team_role, invited_by, created_at, last_sent_at, tier)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(accepted_invite.invite.id)
        .bind(accepted_invite.invite.team_id)
        .bind(accepted_invite.invite.email.as_ref())
        .bind(accepted_invite.invite.team_role)
        .bind(accepted_invite.invite.invited_by.as_ref())
        .bind(accepted_invite.invite.created_at.naive_utc())
        .bind(accepted_invite.invite.last_sent_at.naive_utc())
        .bind(accepted_invite.invite.tier)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn rollback_remove_user_from_team(
        &self,
        removed_member: &TeamMember<'_>,
    ) -> Result<(), TeamError> {
        let mut transaction = self.pool.begin().await?;

        let inserted = sqlx::query(
            r#"
            INSERT INTO team_user (team_id, user_id, team_role, tier)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(removed_member.team_id)
        .bind(removed_member.user_id.as_ref())
        .bind(removed_member.role)
        .bind(removed_member.tier)
        .execute(&mut *transaction)
        .await?;

        if inserted.rows_affected() > 0 {
            TeamRepositoryImpl::bump_seat_count(&mut transaction, &removed_member.team_id, 1)
                .await?;
        }

        transaction.commit().await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn is_user_member_of_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, TeamError> {
        let team_member: Option<()> = sqlx::query!(
            r#"
            SELECT team_id FROM team_user
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
        )
        .map(|_| ())
        .fetch_optional(&self.pool)
        .await?;

        Ok(team_member.is_some())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamMember<'_>>, TeamError> {
        let members = sqlx::query!(
            r#"
            SELECT user_id, 
                team_role as "team_role!: TeamRole",
                tier as "tier!: TeamUserTier"
            FROM team_user
            WHERE team_id = $1
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let members: Vec<Result<TeamMember, anyhow::Error>> = members
            .into_iter()
            .map(|row| {
                let user_id =
                    MacroUserIdStr::parse_from_str(&row.user_id).map(|id| id.into_owned());

                if let Ok(user_id) = user_id {
                    Ok(TeamMember {
                        user_id,
                        role: row.team_role,
                        team_id: *team_id,
                        tier: row.tier,
                    })
                } else {
                    Err(anyhow::anyhow!("unable to parse user id"))
                }
            })
            .collect();

        let members = members
            .into_iter()
            .filter_map(|member| member.ok())
            .collect();

        Ok(members)
    }

    #[tracing::instrument(skip(self), err)]
    async fn bulk_is_member_of_other_team(
        &self,
        ignore_team_ids: non_empty::NonEmpty<&[uuid::Uuid]>,
        users: non_empty::NonEmpty<&[MacroUserIdStr<'_>]>,
    ) -> Result<Vec<MacroUserIdStr<'_>>, TeamError> {
        let result = sqlx::query!(
            r#"
            SELECT user_id
            FROM team_user
            WHERE user_id = ANY($1::text[])
            AND team_id NOT IN (
            SELECT * FROM UNNEST($2::uuid[])
            )
            AND team_role NOT IN ('owner')
            "#,
            &users
                .as_ref()
                .iter()
                .map(|u| u.as_ref().to_string())
                .collect::<Vec<_>>(),
            ignore_team_ids.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;

        let members: Vec<Result<_, _>> = result
            .into_iter()
            .map(|row| MacroUserIdStr::parse_from_str(&row.user_id).map(|id| id.into_owned()))
            .collect();

        let members = members
            .into_iter()
            .filter_map(|member| member.ok())
            .collect();

        Ok(members)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_by_id(&self, team_id: &uuid::Uuid) -> Result<TeamWithMembers, TeamError> {
        let team = sqlx::query!(
            r#"
            SELECT id, name, owner_id
            FROM team
            WHERE id = $1
            "#,
            team_id,
        )
        .try_map(|row| {
            Ok(Team {
                id: row.id,
                name: row.name,
                owner_id: MacroUserIdStr::parse_from_str(&row.owner_id)
                    .map_err(type_err)?
                    .into_owned(),
            })
        })
        .fetch_one(&self.pool)
        .await?;

        let members = sqlx::query!(
            r#"
            SELECT user_id,
                team_role as "team_role!: TeamRole",
                tier as "tier!: TeamUserTier"
            FROM team_user
            WHERE team_id = $1
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let members = members
            .into_iter()
            .filter_map(|row| {
                MacroUserIdStr::parse_from_str(&row.user_id)
                    .map(|id| TeamMember {
                        user_id: id.into_owned(),
                        role: row.team_role,
                        team_id: *team_id,
                        tier: row.tier,
                    })
                    .ok()
            })
            .collect();

        Ok(TeamWithMembers { team, members })
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_teams(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<Team>, TeamError> {
        let teams = sqlx::query!(
            r#"
            SELECT t.id, t.name, t.owner_id
            FROM team t
            JOIN team_user tu ON t.id = tu.team_id
            WHERE tu.user_id = $1
            "#,
            user_id.as_ref(),
        )
        .try_map(|row| {
            Ok(Team {
                id: row.id,
                name: row.name,
                owner_id: MacroUserIdStr::parse_from_str(&row.owner_id)
                    .map_err(type_err)?
                    .into_owned(),
            })
        })
        .fetch_all(&self.pool)
        .await?;

        Ok(teams)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_team_invites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        let email = user_id.email_part().lowercase();

        let invites = sqlx::query!(
            r#"
            SELECT
                id,
                email,
                team_id,
                team_role as "team_role!: TeamRole",
                invited_by,
                created_at as "created_at!: chrono::DateTime<chrono::Utc>",
                last_sent_at as "last_sent_at!: chrono::DateTime<chrono::Utc>"
            FROM team_invite
            WHERE email = $1
            "#,
            email.as_ref(),
        )
        .map(|row| TeamInviteDetails {
            id: row.id,
            email: row.email,
            team_id: row.team_id,
            team_role: row.team_role,
            invited_by: row.invited_by,
            created_at: row.created_at,
            last_sent_at: row.last_sent_at,
        })
        .fetch_all(&self.pool)
        .await?;

        Ok(invites)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_invites(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        let invites = sqlx::query!(
            r#"
            SELECT
                id,
                email,
                team_id,
                team_role as "team_role!: TeamRole",
                invited_by,
                created_at as "created_at!: chrono::DateTime<chrono::Utc>",
                last_sent_at as "last_sent_at!: chrono::DateTime<chrono::Utc>"
            FROM team_invite
            WHERE team_id = $1
            "#,
            team_id,
        )
        .map(|row| TeamInviteDetails {
            id: row.id,
            email: row.email,
            team_id: row.team_id,
            team_role: row.team_role,
            invited_by: row.invited_by,
            created_at: row.created_at,
            last_sent_at: row.last_sent_at,
        })
        .fetch_all(&self.pool)
        .await?;

        Ok(invites)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_name(&self, team_id: &uuid::Uuid) -> Result<String, TeamError> {
        let name = sqlx::query!(
            r#"
            SELECT name
            FROM team
            WHERE id = $1
            "#,
            team_id,
        )
        .map(|row| row.name)
        .fetch_one(&self.pool)
        .await?;

        Ok(name)
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team(
        &self,
        team_id: &uuid::Uuid,
        req: &PatchTeamRequest,
    ) -> Result<(), TeamError> {
        if let Some(name) = req.name.as_ref() {
            sqlx::query!(
                r#"
                UPDATE team
                SET name = $1
                WHERE id = $2
                "#,
                name,
                team_id,
            )
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamRole>, TeamError> {
        let team_role = sqlx::query!(
            r#"
            SELECT team_role as "team_role!: TeamRole"
            FROM team_user
            WHERE team_id = $1 AND user_id = $2
            "#,
            team_id,
            user_id.as_ref(),
        )
        .map(|r| r.team_role)
        .fetch_optional(&self.pool)
        .await?;

        Ok(team_role)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_member(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamMember<'_>, TeamError> {
        let member = sqlx::query!(
            r#"
            SELECT user_id, 
                team_role as "team_role!: TeamRole",
                tier as "tier!: TeamUserTier"
            FROM team_user
            WHERE team_id = $1
            AND user_id = $2
            "#,
            team_id,
            user_id.as_ref(),
        )
        .try_map(|r| {
            Ok(TeamMember {
                user_id: MacroUserIdStr::parse_from_str(&r.user_id)
                    .map_err(type_err)?
                    .into_owned(),
                team_id: *team_id,
                role: r.team_role,
                tier: r.tier,
            })
        })
        .fetch_one(&self.pool)
        .await?;

        Ok(member)
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team_tier(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        team_tier: TeamUserTier,
    ) -> Result<(), TeamError> {
        let result = sqlx::query!(
            r#"
            UPDATE team_user
            SET tier = $3
            WHERE team_id = $1
            AND user_id = $2
            "#,
            team_id,
            user_id.as_ref(),
            team_tier as _,
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(TeamError::TeamMemberNotFound(*team_id));
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team_user_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        team_role: TeamRole,
    ) -> Result<(), TeamError> {
        let result = sqlx::query!(
            r#"
            UPDATE team_user
            SET team_role = $3
            WHERE team_id = $1
            AND user_id = $2
            "#,
            team_id,
            user_id.as_ref(),
            team_role as _,
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(TeamError::TeamMemberNotFound(*team_id));
        }

        Ok(())
    }
}
