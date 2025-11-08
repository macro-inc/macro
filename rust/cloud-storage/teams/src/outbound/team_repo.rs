//! Implementation for TeamRepository using MacroDB.

#[cfg(test)]
mod test;

use std::str::FromStr;

use macro_user_id::{cowlike::CowLike, email::Email, lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;

use crate::domain::{
    model::{
        CreateTeamError, InviteUsersToTeamError, RemoveTeamInviteError, RemoveUserFromTeamError,
        Team, TeamError, TeamInvite, TeamMember, TeamRole,
    },
    team_repo::TeamRepository,
};

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
    /// Gets the owner of a team
    async fn get_team_owner(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<MacroUserId<Lowercase<'_>>, anyhow::Error> {
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

        Ok(MacroUserId::parse_from_str(owner_id.as_str()).map(|id| id.into_owned().lowercase())?)
    }

    async fn create_team_inner(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_name: &str,
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
        .map(|row| Team::new(row.id, row.name, row.owner_id))
        .fetch_one(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO team_user (team_id, user_id, team_role)
            VALUES ($1, $2, 'owner')
            "#,
            &team.id,
            user_id.as_ref(),
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
    async fn get_stripe_customer_id(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
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

    async fn create_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_name: &str,
    ) -> Result<Team, CreateTeamError> {
        if team_name.is_empty() || team_name.len() > 50 {
            return Err(CreateTeamError::InvalidTeamName(team_name.to_string()));
        }

        self.create_team_inner(user_id, team_name)
            .await
            .map_err(|e| e.into())
    }

    async fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserId<Lowercase<'_>>,
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

        // Convert returned emails back to Email type
        let created_emails: Vec<TeamInvite<'static>> = invites
            .into_iter()
            .filter_map(|(id, team_id, email)| {
                let email = Email::parse_from_str(&email)
                    .ok()
                    .map(|e| e.into_owned().lowercase());

                email.map(|email| TeamInvite {
                    team_id,
                    team_invite_id: id,
                    email,
                })
            })
            .collect();

        // Update the team seat count
        sqlx::query!(
            r#"
            UPDATE team
            SET seat_count = seat_count + $2
            WHERE id = $1
        "#,
            team_id,
            created_emails.len() as i64,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(created_emails)
    }

    async fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<(), RemoveUserFromTeamError> {
        let owner_id = self.get_team_owner(team_id).await?;

        if user_id.as_ref().eq(owner_id.as_ref()) {
            return Err(RemoveUserFromTeamError::CannotRemoveOwner);
        }

        let mut transaction = self.pool.begin().await?;

        let removed = sqlx::query!(
            r#"
            DELETE FROM team_user
            WHERE team_id = $1 AND user_id = $2
        "#,
            team_id,
            user_id.as_ref(),
        )
        .execute(&mut *transaction)
        .await?;

        if removed.rows_affected() == 0 {
            return Err(RemoveUserFromTeamError::UserNotInTeam);
        }

        // Update the team seat count
        sqlx::query!(
            r#"
            UPDATE team
            SET seat_count = seat_count - 1
            WHERE id = $1
            "#,
            team_id,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(())
    }

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

    async fn delete_team_invite(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query!(
            r#"
            DELETE FROM team_invite
            WHERE id = $1
            "#,
            team_invite_id,
        )
        .execute(&mut *transaction)
        .await?;

        if result.rows_affected() == 0 {
            return Err(RemoveTeamInviteError::TeamInviteDoesNotExist);
        }

        // Update the team seat count
        sqlx::query!(
            r#"
            UPDATE team
            SET seat_count = seat_count - 1
            WHERE id = $1
            "#,
            team_id,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(())
    }

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

    async fn get_all_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamMember<'_>>, TeamError> {
        let members = sqlx::query!(
            r#"
            SELECT user_id, 
                team_role as "team_role!: TeamRole"
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
                    MacroUserId::parse_from_str(&row.user_id).map(|id| id.into_owned().lowercase());

                if let Ok(user_id) = user_id {
                    Ok(TeamMember {
                        user_id,
                        role: row.team_role,
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

    async fn accept_team_invite(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<TeamMember<'static>, TeamError> {
        let mut transaction = self.pool.begin().await?;

        let user_email = user_id.email_part().lowercase();

        // Get user role from team invite
        let invite = sqlx::query!(
            r#"
            SELECT team_role as "team_role!: TeamRole", team_id
            FROM team_invite
            WHERE id = $1 AND email = $2
            "#,
            team_invite_id,
            user_email.as_ref(),
        )
        .fetch_one(&mut *transaction)
        .await?;

        // Assign user to team_user
        let team_member = sqlx::query!(
            r#"
            INSERT INTO team_user (team_id, user_id, team_role)
            VALUES ($1, $2, $3)
            RETURNING user_id, team_role as "role!: TeamRole"
            "#,
            &invite.team_id,
            user_id.as_ref(),
            invite.team_role as _,
        )
        .fetch_one(&mut *transaction)
        .await?;

        // Remove team invite
        sqlx::query!(
            r#"
            DELETE FROM team_invite
            WHERE id = $1
            "#,
            team_invite_id,
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        let team_member: TeamMember = TeamMember {
            user_id: user_id.clone().into_owned(),
            role: team_member.role,
        };

        Ok(team_member)
    }

    async fn is_user_member_of_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<bool, TeamError> {
        let team_member: Option<()> = sqlx::query!(
            r#"
            SELECT team_id FROM team_user
            WHERE user_id = $1 AND team_role NOT IN ('owner')
            "#,
            user_id.as_ref(),
        )
        .map(|_| ())
        .fetch_optional(&self.pool)
        .await?;

        Ok(team_member.is_some())
    }

    async fn get_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamMember<'_>>, TeamError> {
        let members = sqlx::query!(
            r#"
            SELECT user_id, 
                team_role as "team_role!: TeamRole"
            FROM team_user
            WHERE team_id = $1 AND team_role NOT IN ('owner')
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        let members: Vec<Result<TeamMember, anyhow::Error>> = members
            .into_iter()
            .map(|row| {
                let user_id =
                    MacroUserId::parse_from_str(&row.user_id).map(|id| id.into_owned().lowercase());

                if let Ok(user_id) = user_id {
                    Ok(TeamMember {
                        user_id,
                        role: row.team_role,
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

    async fn bulk_is_member_of_other_team(
        &self,
        ignore_team_ids: non_empty::NonEmpty<&[uuid::Uuid]>,
        users: non_empty::NonEmpty<&[MacroUserId<Lowercase<'_>>]>,
    ) -> Result<Vec<MacroUserId<Lowercase<'_>>>, TeamError> {
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

        let members: Vec<Result<MacroUserId<Lowercase<'_>>, _>> = result
            .into_iter()
            .map(|row| {
                MacroUserId::parse_from_str(&row.user_id).map(|id| id.into_owned().lowercase())
            })
            .collect();

        let members = members
            .into_iter()
            .filter_map(|member| member.ok())
            .collect();

        Ok(members)
    }
}
