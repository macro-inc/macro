//! PostgreSQL implementation of the [`GtmInviteRepo`] port.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{
    models::{InviteConversion, InviteLink, InviteRedemption, InviteToken, ListInviteLinks},
    ports::GtmInviteRepo,
};

/// PostgreSQL-backed invite link repository.
#[derive(Clone)]
pub struct PgGtmInviteRepo {
    /// The postgres pool
    pool: PgPool,
}

impl PgGtmInviteRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// One `gtm_invite_link` row, as stored.
struct InviteLinkRow {
    id: Uuid,
    token: String,
    first_name: String,
    recipient_email: Option<String>,
    note: Option<String>,
    promo_code: String,
    created_by_user_id: String,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
    open_count: i32,
    first_opened_at: Option<DateTime<Utc>>,
    redeemed_by_user_id: Option<String>,
    redeemed_at: Option<DateTime<Utc>>,
    converted_at: Option<DateTime<Utc>>,
    stripe_subscription_id: Option<String>,
}

fn decode_error(message: impl std::fmt::Display) -> sqlx::Error {
    sqlx::Error::Decode(message.to_string().into())
}

fn parse_user_id(raw: &str) -> Result<MacroUserIdStr<'static>, sqlx::Error> {
    MacroUserIdStr::parse_from_str(raw)
        .map(CowLike::into_owned)
        .map_err(|e| decode_error(format!("stored macro user id is invalid: {e:?}")))
}

impl TryFrom<InviteLinkRow> for InviteLink {
    type Error = sqlx::Error;

    fn try_from(row: InviteLinkRow) -> Result<Self, Self::Error> {
        let redemption = match (row.redeemed_by_user_id, row.redeemed_at) {
            (Some(user_id), Some(redeemed_at)) => Some(InviteRedemption {
                user_id: parse_user_id(&user_id)?,
                redeemed_at,
                conversion: row.converted_at.map(|converted_at| InviteConversion {
                    converted_at,
                    stripe_subscription_id: row.stripe_subscription_id,
                }),
            }),
            (None, None) => None,
            _ => return Err(decode_error("redemption columns are inconsistent")),
        };

        Ok(InviteLink {
            id: row.id,
            token: row
                .token
                .parse::<InviteToken>()
                .map_err(|e| decode_error(format!("stored invite token is invalid: {e}")))?,
            first_name: row.first_name,
            recipient_email: row.recipient_email,
            note: row.note,
            promo_code: row
                .promo_code
                .parse()
                .map_err(|e| decode_error(format!("stored promo code is invalid: {e}")))?,
            created_by: parse_user_id(&row.created_by_user_id)?,
            created_at: row.created_at,
            expires_at: row.expires_at,
            revoked_at: row.revoked_at,
            open_count: row.open_count,
            first_opened_at: row.first_opened_at,
            redemption,
        })
    }
}

impl GtmInviteRepo for PgGtmInviteRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, link), fields(link_id = %link.id), err)]
    async fn insert_link(&self, link: &InviteLink) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO gtm_invite_link
                (id, token, first_name, recipient_email, note, promo_code,
                 created_by_user_id, created_at, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            link.id,
            link.token.as_str(),
            link.first_name,
            link.recipient_email.as_deref(),
            link.note.as_deref(),
            link.promo_code.as_str(),
            link.created_by.as_ref(),
            link.created_at,
            link.expires_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self, token), err)]
    async fn get_link_by_token(
        &self,
        token: &InviteToken,
    ) -> Result<Option<InviteLink>, Self::Err> {
        sqlx::query_as!(
            InviteLinkRow,
            r#"
            SELECT id, token, first_name, recipient_email, note, promo_code,
                   created_by_user_id, created_at, expires_at, revoked_at, open_count,
                   first_opened_at, redeemed_by_user_id, redeemed_at, converted_at,
                   stripe_subscription_id
            FROM gtm_invite_link
            WHERE token = $1
            "#,
            token.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(InviteLink::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_link_by_id(&self, id: Uuid) -> Result<Option<InviteLink>, Self::Err> {
        sqlx::query_as!(
            InviteLinkRow,
            r#"
            SELECT id, token, first_name, recipient_email, note, promo_code,
                   created_by_user_id, created_at, expires_at, revoked_at, open_count,
                   first_opened_at, redeemed_by_user_id, redeemed_at, converted_at,
                   stripe_subscription_id
            FROM gtm_invite_link
            WHERE id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(InviteLink::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self, filter), fields(limit = filter.limit), err)]
    async fn list_links(&self, filter: &ListInviteLinks) -> Result<Vec<InviteLink>, Self::Err> {
        let created_by = filter
            .created_by
            .as_ref()
            .map(|creator| -> &str { creator.as_ref() });
        sqlx::query_as!(
            InviteLinkRow,
            r#"
            SELECT id, token, first_name, recipient_email, note, promo_code,
                   created_by_user_id, created_at, expires_at, revoked_at, open_count,
                   first_opened_at, redeemed_by_user_id, redeemed_at, converted_at,
                   stripe_subscription_id
            FROM gtm_invite_link
            WHERE ($1::TEXT IS NULL OR created_by_user_id = $1)
            ORDER BY created_at DESC, id DESC
            LIMIT $2
            "#,
            created_by,
            filter.limit,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(InviteLink::try_from)
        .collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn record_open(&self, id: Uuid, now: DateTime<Utc>) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE gtm_invite_link
            SET open_count = open_count + 1,
                first_opened_at = COALESCE(first_opened_at, $2)
            WHERE id = $1
            "#,
            id,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn revoke_link(&self, id: Uuid, now: DateTime<Utc>) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE gtm_invite_link
            SET revoked_at = $2
            WHERE id = $1
              AND revoked_at IS NULL
              AND redeemed_by_user_id IS NULL
            "#,
            id,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, user_id), fields(user_id = %user_id.as_ref()), err)]
    async fn redeem_link<'a>(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'a>,
        now: DateTime<Utc>,
    ) -> Result<Option<InviteLink>, Self::Err> {
        // Single statement so two accounts racing for one link, or a signup
        // racing a revoke, resolve in the database: only an open link (or the
        // same user's own redemption) matches.
        sqlx::query_as!(
            InviteLinkRow,
            r#"
            UPDATE gtm_invite_link
            SET redeemed_by_user_id = $2,
                redeemed_at = COALESCE(redeemed_at, $3)
            WHERE id = $1
              AND revoked_at IS NULL
              AND ((redeemed_by_user_id IS NULL AND expires_at > $3)
                   OR redeemed_by_user_id = $2)
            RETURNING id, token, first_name, recipient_email, note, promo_code,
                      created_by_user_id, created_at, expires_at, revoked_at, open_count,
                      first_opened_at, redeemed_by_user_id, redeemed_at, converted_at,
                      stripe_subscription_id
            "#,
            id,
            user_id.as_ref(),
            now,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(InviteLink::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self, user_id), fields(user_id = %user_id.as_ref()), err)]
    async fn get_redeemed_link_for_user<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
    ) -> Result<Option<InviteLink>, Self::Err> {
        sqlx::query_as!(
            InviteLinkRow,
            r#"
            SELECT id, token, first_name, recipient_email, note, promo_code,
                   created_by_user_id, created_at, expires_at, revoked_at, open_count,
                   first_opened_at, redeemed_by_user_id, redeemed_at, converted_at,
                   stripe_subscription_id
            FROM gtm_invite_link
            WHERE redeemed_by_user_id = $1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(InviteLink::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self, user_id), fields(user_id = %user_id.as_ref()), err)]
    async fn mark_converted<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
        stripe_subscription_id: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE gtm_invite_link
            SET converted_at = $3,
                stripe_subscription_id = $2
            WHERE redeemed_by_user_id = $1
              AND converted_at IS NULL
            "#,
            user_id.as_ref(),
            stripe_subscription_id,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}
