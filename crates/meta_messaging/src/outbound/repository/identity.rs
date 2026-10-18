//! Connection-scoped BSUID aliases; phones are conversation attributes.
use super::*;
use crate::domain::events::{IdentityUpdate, IncomingMessage};
use sqlx::{Postgres, Transaction};

async fn find(
    tx: &mut Transaction<'_, Postgres>,
    connection: Uuid,
    identifier: &str,
) -> PortResult<Option<String>> {
    sqlx::query_scalar!("SELECT customer_id FROM meta_messaging_customer_alias WHERE connection_id=$1 AND identifier=$2", connection, identifier)
        .fetch_optional(&mut **tx).await.map_err(failure)
}

async fn alias(
    tx: &mut Transaction<'_, Postgres>,
    connection: Uuid,
    identifier: &str,
    customer: &str,
) -> PortResult<()> {
    sqlx::query!("INSERT INTO meta_messaging_customer_alias(connection_id,identifier,customer_id) VALUES ($1,$2,$3) ON CONFLICT (connection_id,identifier) DO UPDATE SET customer_id=EXCLUDED.customer_id",connection,identifier,customer)
        .execute(&mut **tx).await.map_err(failure)?;
    Ok(())
}

async fn persisted_customer(
    tx: &mut Transaction<'_, Postgres>,
    connection: Uuid,
    raw: &ProviderId,
    message: &ProviderId,
) -> PortResult<Option<ProviderId>> {
    let Some(stored) = sqlx::query_scalar!("SELECT COALESCE(sender_customer_id,customer_id) AS \"customer_id!\" FROM meta_messaging_message WHERE connection_id=$1 AND provider_message_id=$2",connection,message.as_str())
        .fetch_optional(&mut **tx).await.map_err(failure)? else { return Ok(None); };
    if raw.is_whatsapp_bsuid() {
        let supplied = find(tx, connection, raw.as_str())
            .await?
            .unwrap_or_else(|| raw.as_str().to_owned());
        let owner = find(tx, connection, &stored)
            .await?
            .unwrap_or_else(|| stored.clone());
        if supplied != owner {
            return Err(MessagingError::IdentityConflict.into());
        }
    }
    Ok(Some(stored.try_into()?))
}

async fn rekey_participants(
    tx: &mut Transaction<'_, Postgres>,
    connection: Uuid,
    old: &str,
    current: &str,
) -> PortResult<()> {
    if old == current {
        return Ok(());
    }
    // Already-authored messages retain their sender UUID. Future facts use
    // the previous person's stable group author after the verified rekey.
    sqlx::query!(r#"UPDATE meta_messaging_group_participant older SET
            active=CASE WHEN newer.membership_at>older.membership_at THEN newer.active ELSE older.active END,
            membership_at=GREATEST(older.membership_at,newer.membership_at),
            display_name=CASE WHEN newer.profile_at>older.profile_at THEN COALESCE(newer.display_name,older.display_name) ELSE older.display_name END,
            username=CASE WHEN newer.profile_at>older.profile_at THEN COALESCE(newer.username,older.username) ELSE older.username END,
            phone=CASE WHEN newer.profile_at>older.profile_at THEN COALESCE(newer.phone,older.phone) ELSE older.phone END,
            profile_at=GREATEST(older.profile_at,newer.profile_at)
            FROM meta_messaging_group_participant newer,meta_messaging_conversation c WHERE c.connection_id=$1 AND c.kind='group'
            AND older.channel_id=c.channel_id AND newer.channel_id=older.channel_id AND older.customer_id=$2 AND newer.customer_id=$3"#,connection,old,current).execute(&mut **tx).await.map_err(failure)?;
    sqlx::query!("DELETE FROM meta_messaging_group_participant newer USING meta_messaging_group_participant older,meta_messaging_conversation c WHERE c.connection_id=$1 AND c.kind='group' AND older.channel_id=c.channel_id AND newer.channel_id=older.channel_id AND older.customer_id=$2 AND newer.customer_id=$3",connection,old,current).execute(&mut **tx).await.map_err(failure)?;
    sqlx::query!("UPDATE meta_messaging_group_participant p SET customer_id=$3 FROM meta_messaging_conversation c WHERE p.channel_id=c.channel_id AND c.connection_id=$1 AND c.kind='group' AND p.customer_id=$2",connection,old,current).execute(&mut **tx).await.map_err(failure)?;
    Ok(())
}

async fn rekey(
    tx: &mut Transaction<'_, Postgres>,
    connection: Uuid,
    old: &str,
    current: &str,
) -> PortResult<()> {
    if old == current {
        return Ok(());
    }
    let occupied=sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='direct' AND customer_id=$2) AS \"occupied!\"",connection,current)
        .fetch_one(&mut **tx).await.map_err(failure)?;
    if occupied {
        tracing::warn!(connection_id=%connection, "identity update retained separate conversations");
    } else {
        sqlx::query!("UPDATE meta_messaging_conversation SET customer_id=$3 WHERE connection_id=$1 AND kind='direct' AND customer_id=$2",connection,old,current)
            .execute(&mut **tx).await.map_err(failure)?;
    }
    rekey_participants(tx, connection, old, current).await?;
    let incompatible=sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM meta_messaging_revision a JOIN meta_messaging_revision b ON b.connection_id=a.connection_id AND b.provider_message_id=a.provider_message_id WHERE a.connection_id=$1 AND a.customer_id=$2 AND b.customer_id=$3 AND a.direction<>b.direction AND NOT EXISTS(SELECT 1 FROM meta_messaging_message m WHERE m.connection_id=a.connection_id AND m.customer_id=$2 AND m.provider_message_id=a.provider_message_id))",connection,old,current)
        .fetch_one(&mut **tx).await.map_err(failure)?.unwrap_or(false);
    if incompatible {
        return Err(MessagingError::IdentityConflict.into());
    }
    sqlx::query!(r#"INSERT INTO meta_messaging_revision(connection_id,customer_id,provider_message_id,direction,edit_number,content,edited_at,deleted_at)
        SELECT connection_id,$3,provider_message_id,direction,edit_number,content,edited_at,deleted_at
        FROM meta_messaging_revision r WHERE connection_id=$1 AND customer_id=$2
          AND NOT EXISTS(SELECT 1 FROM meta_messaging_message m WHERE m.connection_id=r.connection_id AND m.customer_id=$2 AND m.provider_message_id=r.provider_message_id)
        ON CONFLICT (connection_id,customer_id,provider_message_id) DO UPDATE SET
          content=CASE WHEN EXCLUDED.edit_number>meta_messaging_revision.edit_number THEN EXCLUDED.content ELSE meta_messaging_revision.content END,
          edited_at=CASE WHEN EXCLUDED.edit_number>meta_messaging_revision.edit_number THEN EXCLUDED.edited_at ELSE meta_messaging_revision.edited_at END,
          edit_number=GREATEST(EXCLUDED.edit_number,meta_messaging_revision.edit_number),
          deleted_at=COALESCE(meta_messaging_revision.deleted_at,EXCLUDED.deleted_at)
        WHERE meta_messaging_revision.direction=EXCLUDED.direction"#,connection,old,current).execute(&mut **tx).await.map_err(failure)?;
    sqlx::query!(
        "DELETE FROM meta_messaging_revision r WHERE connection_id=$1 AND customer_id=$2 AND NOT EXISTS(SELECT 1 FROM meta_messaging_message m WHERE m.connection_id=r.connection_id AND m.customer_id=$2 AND m.provider_message_id=r.provider_message_id)",
        connection,
        old
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

impl PgMessagingRepository {
    /// Resolve provider IDs before native channel/message materialization.
    pub async fn resolve_message_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        message: &IncomingMessage,
    ) -> PortResult<IncomingMessage> {
        if c.provider != Provider::Whatsapp {
            return Ok(message.clone());
        }
        Self::lock_identity_in(tx, c).await?;
        let mut message = message.clone();
        if let Some(existing) =
            persisted_customer(tx, c.id, &message.customer_id, &message.message_id).await?
        {
            message.customer_id = if message.group_id.is_some() {
                find(tx, c.id, existing.as_str())
                    .await?
                    .map(ProviderId::try_from)
                    .transpose()?
                    .unwrap_or(existing)
            } else {
                existing
            };
            message.customer_phone = None;
            return Ok(message);
        }
        let current = Self::observe_identity_in(
            tx,
            c,
            &message.customer_id,
            message.customer_phone.as_ref(),
            message.timestamp,
        )
        .await?;
        if current != message.customer_id {
            message.customer_phone = None;
        }
        if !current.is_whatsapp_bsuid() {
            message.customer_phone = Some(current.clone());
        }
        message.customer_id = current;
        Ok(message)
    }

    /// Resolve a verified association without creating a native channel.
    pub async fn observe_identity_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        raw: &ProviderId,
        phone: Option<&ProviderId>,
        at: DateTime<Utc>,
    ) -> PortResult<ProviderId> {
        let customer = Self::resolve_identifier_in(tx, c, raw, None).await?;
        if customer.is_whatsapp_bsuid()
            && customer == *raw
            && let Some(phone) = phone
        {
            let legacy = sqlx::query_scalar!("SELECT customer_id FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='direct' AND customer_id=$2 AND customer_phone=$2",c.id,phone.as_str())
                .fetch_optional(&mut **tx).await.map_err(failure)?;
            let group_legacy=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM meta_messaging_group_participant p JOIN meta_messaging_conversation c ON c.channel_id=p.channel_id
                WHERE c.connection_id=$1 AND c.kind='group' AND p.customer_id=$2 AND (p.phone=$2 OR p.phone IS NULL) AND p.profile_at<=$3) AS "legacy!""#,c.id,phone.as_str(),at).fetch_one(&mut **tx).await.map_err(failure)?;
            if let Some(legacy) = legacy.as_ref() {
                rekey(tx, c.id, legacy, customer.as_str()).await?;
            } else if group_legacy {
                rekey_participants(tx, c.id, phone.as_str(), customer.as_str()).await?;
            }
            if legacy.is_some() || group_legacy {
                sqlx::query!("DELETE FROM meta_messaging_customer_alias WHERE connection_id=$1 AND identifier=$2",c.id,phone.as_str())
                    .execute(&mut **tx).await.map_err(failure)?;
            }
            Self::observe_phone_in(tx, c.id, customer.as_str(), Some(phone.as_str()), at).await?;
        }
        Ok(customer)
    }

    pub(super) async fn observe_phone_in(
        tx: &mut Transaction<'_, Postgres>,
        connection: Uuid,
        customer: &str,
        phone: Option<&str>,
        at: DateTime<Utc>,
    ) -> PortResult<()> {
        let changed = sqlx::query!(r#"UPDATE meta_messaging_conversation c SET customer_phone=$3,customer_phone_at=$4
            WHERE connection_id=$1 AND kind='direct' AND customer_id=$2 AND (customer_phone_at IS NULL OR customer_phone_at<=$4)
            AND NOT EXISTS (SELECT 1 FROM meta_messaging_conversation other WHERE other.connection_id=$1 AND other.kind='direct'
                AND other.customer_id<>$2 AND other.customer_phone=$3 AND other.customer_phone_at>$4)"#,connection,customer,phone,at)
            .execute(&mut **tx).await.map_err(failure)?;
        if changed.rows_affected() > 0 && phone.is_some() {
            sqlx::query!("UPDATE meta_messaging_conversation SET customer_phone=NULL,customer_phone_at=$4 WHERE connection_id=$1 AND kind='direct' AND customer_id<>$2 AND customer_phone=$3",connection,customer,phone,at)
                .execute(&mut **tx).await.map_err(failure)?;
        }
        Ok(())
    }

    /// Retain the old BSUID as an alias, without merging native histories.
    pub async fn update_identity_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        update: &IdentityUpdate,
    ) -> PortResult<()> {
        Self::lock_identity_in(tx, c).await?;
        let previous = Self::observe_identity_in(
            tx,
            c,
            &update.previous,
            update.previous_phone.as_ref(),
            update.timestamp,
        )
        .await?;
        let current = find(tx, c.id, update.current.as_str())
            .await?
            .unwrap_or_else(|| update.current.as_str().to_owned());
        rekey(tx, c.id, previous.as_str(), &current).await?;

        sqlx::query!("UPDATE meta_messaging_customer_alias SET customer_id=$3 WHERE connection_id=$1 AND customer_id=$2",c.id,previous.as_str(),current)
            .execute(&mut **tx).await.map_err(failure)?;
        if update.previous.is_whatsapp_bsuid() {
            alias(tx, c.id, update.previous.as_str(), &current).await?;
        } else {
            sqlx::query!("DELETE FROM meta_messaging_customer_alias WHERE connection_id=$1 AND identifier=$2",c.id,update.previous.as_str())
                .execute(&mut **tx).await.map_err(failure)?;
        }
        alias(tx, c.id, update.current.as_str(), &current).await?;
        Self::observe_phone_in(
            tx,
            c.id,
            &current,
            update.phone.as_ref().map(ProviderId::as_str),
            update.timestamp,
        )
        .await
    }

    /// Resolve current/previous BSUIDs or an unambiguous legacy phone identity.
    pub async fn resolve_identifier_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        identifier: &ProviderId,
        message: Option<&ProviderId>,
    ) -> PortResult<ProviderId> {
        if c.provider != Provider::Whatsapp {
            return Ok(identifier.clone());
        }
        Self::lock_identity_in(tx, c).await?;
        if let Some(message) = message
            && let Some(customer) = persisted_customer(tx, c.id, identifier, message).await?
        {
            return Ok(customer);
        }
        if !identifier.is_whatsapp_bsuid() {
            let ambiguous = sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='direct'
                AND ((customer_phone=$2 AND customer_id<>$2) OR (customer_id=$2 AND customer_phone IS DISTINCT FROM $2)))
                OR EXISTS(SELECT 1 FROM meta_messaging_group_participant p JOIN meta_messaging_conversation c ON c.channel_id=p.channel_id WHERE c.connection_id=$1 AND c.kind='group' AND p.phone=$2 AND p.customer_id<>$2) AS "ambiguous!""#,c.id,identifier.as_str())
                .fetch_one(&mut **tx).await.map_err(failure)?;
            if ambiguous {
                tracing::warn!(connection_id=%c.id, "ambiguous phone-only fact dropped");
                return Err(MessagingError::IdentityConflict.into());
            }
        }
        if let Some(customer) = find(tx, c.id, identifier.as_str()).await? {
            return Ok(customer.try_into()?);
        }
        alias(tx, c.id, identifier.as_str(), identifier.as_str()).await?;
        Ok(identifier.clone())
    }

    pub(super) async fn lock_identity_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
    ) -> PortResult<()> {
        let row=sqlx::query!("SELECT connected_at,status FROM meta_messaging_connection WHERE id=$1 AND team_id=$2 FOR UPDATE",c.id,c.team_id)
            .fetch_optional(&mut **tx).await.map_err(failure)?.ok_or(MessagingError::NotFound)?;
        if row.connected_at != c.connected_at {
            return Err(MessagingError::Conflict.into());
        }
        if matches!(row.status.as_str(), "disconnected" | "revoked") {
            return Err(MessagingError::Disconnected.into());
        }
        Ok(())
    }
}
