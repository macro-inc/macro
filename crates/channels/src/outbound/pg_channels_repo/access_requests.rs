//! Requests to join a channel and the membership an approval grants.

use super::{ChannelInfoRow, PgChannelsRepo, add_participant, touch_channel_updated_at};
use crate::domain::{
    access_requests::{
        ChannelAccessDecision, ChannelAccessRequest, ChannelAccessRequestRepo,
        ChannelAccessRequestStatus, ResolvedChannelAccessRequest,
    },
    models::{ChannelInfo, ChannelType, ParticipantRole},
};
use anyhow::Context;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

struct StoredRequest {
    id: Uuid,
    channel_id: Uuid,
    requester_id: String,
    status: String,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    resolved_by: Option<String>,
}

impl TryFrom<StoredRequest> for ChannelAccessRequest {
    type Error = anyhow::Error;

    fn try_from(row: StoredRequest) -> anyhow::Result<Self> {
        let status = match row.status.as_str() {
            "pending" => ChannelAccessRequestStatus::Pending,
            "approved" => ChannelAccessRequestStatus::Approved,
            "denied" => ChannelAccessRequestStatus::Denied,
            "cancelled" => ChannelAccessRequestStatus::Cancelled,
            other => anyhow::bail!("unknown channel access request status {other}"),
        };
        Ok(Self {
            id: row.id,
            channel_id: row.channel_id,
            requester_id: MacroUserIdStr::try_from(row.requester_id)?,
            status,
            created_at: row.created_at,
            resolved_at: row.resolved_at,
            resolved_by: row.resolved_by.map(MacroUserIdStr::try_from).transpose()?,
        })
    }
}

impl ChannelAccessRequestRepo for PgChannelsRepo {
    async fn find_channel_info(&self, channel_id: Uuid) -> anyhow::Result<Option<ChannelInfo>> {
        let row = sqlx::query_as!(
            ChannelInfoRow,
            r#"
            SELECT id, name, channel_type AS "channel_type: ChannelType", org_id, team_id
            FROM comms_channels
            WHERE id = $1
            "#,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to load channel")?;
        Ok(row.map(|row| ChannelInfo {
            id: row.id,
            name: row.name,
            channel_type: row.channel_type,
            org_id: row.org_id,
            team_id: row.team_id,
        }))
    }

    async fn latest_access_request(
        &self,
        channel_id: Uuid,
        requester: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<ChannelAccessRequest>> {
        sqlx::query_as!(
            StoredRequest,
            r#"
            SELECT id, channel_id, requester_id, status, created_at, resolved_at, resolved_by
            FROM comms_channel_access_request
            WHERE channel_id = $1 AND requester_id = $2
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            "#,
            channel_id,
            requester.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to load latest channel access request")?
        .map(TryInto::try_into)
        .transpose()
    }

    async fn get_access_request(
        &self,
        channel_id: Uuid,
        request_id: Uuid,
    ) -> anyhow::Result<Option<ChannelAccessRequest>> {
        sqlx::query_as!(
            StoredRequest,
            r#"
            SELECT id, channel_id, requester_id, status, created_at, resolved_at, resolved_by
            FROM comms_channel_access_request
            WHERE channel_id = $1 AND id = $2
            "#,
            channel_id,
            request_id,
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to load channel access request")?
        .map(TryInto::try_into)
        .transpose()
    }

    async fn create_access_request(
        &self,
        request: &ChannelAccessRequest,
    ) -> anyhow::Result<(ChannelAccessRequest, bool)> {
        let inserted = sqlx::query_as!(
            StoredRequest,
            r#"
            INSERT INTO comms_channel_access_request (id, channel_id, requester_id, status, created_at)
            VALUES ($1, $2, $3, 'pending', $4)
            ON CONFLICT (channel_id, requester_id) WHERE status = 'pending' DO NOTHING
            RETURNING id, channel_id, requester_id, status, created_at, resolved_at, resolved_by
            "#,
            request.id,
            request.channel_id,
            request.requester_id.as_ref(),
            request.created_at,
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to create channel access request")?;
        if let Some(inserted) = inserted {
            return Ok((inserted.try_into()?, true));
        }
        // A concurrent submission won; converge on its pending attempt.
        let pending = sqlx::query_as!(
            StoredRequest,
            r#"
            SELECT id, channel_id, requester_id, status, created_at, resolved_at, resolved_by
            FROM comms_channel_access_request
            WHERE channel_id = $1 AND requester_id = $2 AND status = 'pending'
            "#,
            request.channel_id,
            request.requester_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .context("unable to load pending channel access request")?;
        Ok((pending.try_into()?, false))
    }

    async fn cancel_access_request(
        &self,
        channel_id: Uuid,
        requester: &MacroUserIdStr<'static>,
        at: DateTime<Utc>,
    ) -> anyhow::Result<Option<ChannelAccessRequest>> {
        sqlx::query_as!(
            StoredRequest,
            r#"
            UPDATE comms_channel_access_request
            SET status = 'cancelled', resolved_at = $3
            WHERE channel_id = $1 AND requester_id = $2 AND status = 'pending'
            RETURNING id, channel_id, requester_id, status, created_at, resolved_at, resolved_by
            "#,
            channel_id,
            requester.as_ref(),
            at,
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to cancel channel access request")?
        .map(TryInto::try_into)
        .transpose()
    }

    async fn resolve_access_request(
        &self,
        channel_id: Uuid,
        request_id: Uuid,
        resolver: &MacroUserIdStr<'static>,
        decision: ChannelAccessDecision,
        at: DateTime<Utc>,
    ) -> anyhow::Result<Option<ResolvedChannelAccessRequest>> {
        let status = match decision {
            ChannelAccessDecision::Approve => "approved",
            ChannelAccessDecision::Deny => "denied",
        };
        let mut tx = self.pool.begin().await?;
        let Some(row) = sqlx::query_as!(
            StoredRequest,
            r#"
            UPDATE comms_channel_access_request
            SET status = $4, resolved_at = $5, resolved_by = $3
            WHERE channel_id = $1 AND id = $2 AND status = 'pending'
            RETURNING id, channel_id, requester_id, status, created_at, resolved_at, resolved_by
            "#,
            channel_id,
            request_id,
            resolver.as_ref(),
            status,
            at,
        )
        .fetch_optional(&mut *tx)
        .await
        .context("unable to resolve channel access request")?
        else {
            return Ok(None);
        };
        let request = ChannelAccessRequest::try_from(row)?;
        let joined = match decision {
            ChannelAccessDecision::Approve => {
                add_participant(
                    &mut *tx,
                    channel_id,
                    request.requester_id.as_ref(),
                    ParticipantRole::Member,
                )
                .await?
            }
            ChannelAccessDecision::Deny => false,
        };
        if joined {
            touch_channel_updated_at(&mut *tx, channel_id).await?;
        }
        tx.commit().await?;
        Ok(Some(ResolvedChannelAccessRequest { request, joined }))
    }
}
