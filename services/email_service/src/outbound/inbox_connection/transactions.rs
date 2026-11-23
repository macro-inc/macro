use super::*;
use email::domain::mailbox::initialization::InitializationError;

pub struct PgConnectionTransactions(pub sqlx::PgPool);

/// A lock timeout means the inbox was busy, and connecting again succeeds.
fn database<E: Into<anyhow::Error>>(context: &'static str) -> impl FnOnce(E) -> ConnectionError {
    move |error| {
        let error = error.into().context(context);
        if crate::outbound::link_lock::caused_by_lock_timeout(&error) {
            ConnectionError::MailboxInitialization(InitializationError::Contended)
        } else {
            ConnectionError::DatabaseError(error)
        }
    }
}

impl ConnectionTransactions for PgConnectionTransactions {
    async fn delegate(
        &self,
        actor: &str,
        email: &str,
        child: &str,
        link: Uuid,
    ) -> Result<(), ConnectionError> {
        let mut tx = crate::outbound::link_lock::begin(&self.0)
            .await
            .map_err(database("Failed to begin graph delegation transaction"))?;
        crate::outbound::mailbox_init::lock_gmail_connection(&mut tx, actor, email)
            .await
            .map_err(ConnectionError::MailboxInitialization)?;
        macro_db_client::macro_user_links::insert_edge(&mut *tx, actor, child, link)
            .await
            .map_err(database("Failed to insert macro_user_links edge"))?;
        tx.commit()
            .await
            .map_err(database("Failed to commit graph delegation transaction"))?;
        Ok(())
    }

    async fn bootstrap(
        &self,
        actor: &str,
        email: &str,
        child: &str,
        provisional: Link,
        cursor: &str,
    ) -> Result<Link, ConnectionError> {
        let mut tx = crate::outbound::link_lock::begin(&self.0)
            .await
            .map_err(database("Failed to begin self-link bootstrap transaction"))?;
        crate::outbound::mailbox_init::lock_gmail_connection(&mut tx, actor, email)
            .await
            .map_err(ConnectionError::MailboxInitialization)?;
        let link = enable_gmail_sync_for(tx.as_mut(), provisional, cursor).await?;
        macro_db_client::macro_user_links::insert_edge(&mut *tx, actor, child, link.id)
            .await
            .map_err(database("Failed to insert macro_user_links edge"))?;
        tx.commit()
            .await
            .map_err(database("Failed to commit self-link bootstrap transaction"))?;
        email::outbound::mailbox_pg::parked_work_recovery::resume_link(&self.0, link.id).await;
        Ok(link)
    }

    async fn create(
        &self,
        actor: &str,
        provisional: Link,
        cursor: &str,
    ) -> Result<Link, ConnectionError> {
        let mut tx = crate::outbound::link_lock::begin(&self.0)
            .await
            .map_err(database("Failed to begin link transaction"))?;
        crate::outbound::mailbox_init::lock_gmail_connection(
            &mut tx,
            actor,
            provisional.email_address.0.as_ref(),
        )
        .await
        .map_err(ConnectionError::MailboxInitialization)?;
        let link = enable_gmail_sync_for(tx.as_mut(), provisional, cursor).await?;
        tx.commit()
            .await
            .map_err(database("Failed to commit link transaction"))?;
        email::outbound::mailbox_pg::parked_work_recovery::resume_link(&self.0, link.id).await;
        Ok(link)
    }

    async fn promote(
        &self,
        actor: &str,
        email: &str,
        existing: &Link,
    ) -> Result<SharedInboxPromotion, ConnectionError> {
        let mut tx = crate::outbound::link_lock::begin(&self.0)
            .await
            .map_err(database(
                "Failed to begin shared-inbox promotion transaction",
            ))?;
        crate::outbound::mailbox_init::lock_gmail_connection(&mut tx, actor, email)
            .await
            .map_err(ConnectionError::MailboxInitialization)?;
        // Recheck under the link's row lock, which removal also takes, that it
        // is not on its way out, and lock its owner's account so it cannot be
        // deleted before the access edge the promotion writes for it.
        let being_removed = sqlx::query_scalar!(
            r#"SELECT (disconnect_requested_at IS NOT NULL OR deleting_at IS NOT NULL) AS "being_removed!"
            FROM email_links WHERE id = $1 FOR UPDATE"#,
            existing.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(database("Failed to lock the link before shared-inbox promotion"))?
        .unwrap_or(true);
        let organization = sqlx::query_scalar!(
            r#"SELECT "organizationId" FROM "User" WHERE id = $1 FOR KEY SHARE"#,
            existing.macro_id.as_ref()
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(database(
            "Failed to fetch organization for shared-inbox owner",
        ))?;
        let Some(organization) = organization.filter(|_| !being_removed) else {
            return Err(ConnectionError::MailboxInitialization(
                InitializationError::InboxBeingRemoved,
            ));
        };
        let promoted = macro_db_client::shared_inbox::promote_link_to_shared(
            &mut tx,
            existing.id,
            existing.macro_id.as_ref(),
            actor,
            email,
            organization,
        )
        .await
        .map_err(database("Failed to promote link to shared inbox"))?;
        tx.commit().await.map_err(database(
            "Failed to commit shared-inbox promotion transaction",
        ))?;
        Ok(SharedInboxPromotion {
            mailbox_fusion_id: promoted.mailbox_fusion_id,
            link_id: promoted.link_id,
        })
    }
}

/// Persists a provisionally registered link and its initial provider cursor atomically.
#[tracing::instrument(skip(conn), err)]
async fn enable_gmail_sync_for(
    conn: &mut sqlx::PgConnection,
    link: Link,
    history_id: &str,
) -> Result<Link, ConnectionError> {
    let link = email_db_client::links::insert::upsert_link(&mut *conn, link)
        .await
        .map_err(database("Failed to upsert link"))?;
    email::outbound::mailbox_pg::parked_work_recovery::unpark_link_page(&mut *conn, link.id, 64)
        .await
        .map_err(database("Failed to unpark inbox projection"))?;

    email_db_client::histories::upsert_gmail_history(&mut *conn, link.id, history_id)
        .await
        .map_err(database("Failed to upsert gmail history"))?;

    Ok(link)
}
