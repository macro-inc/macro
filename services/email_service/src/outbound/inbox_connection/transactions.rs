use super::*;
use anyhow::Context;

pub struct PgConnectionTransactions(pub sqlx::PgPool);

impl ConnectionTransactions for PgConnectionTransactions {
    async fn delegate(
        &self,
        actor: &str,
        email: &str,
        child: &str,
        link: Uuid,
    ) -> Result<(), ConnectionError> {
        let mut tx = self
            .0
            .begin()
            .await
            .context("Failed to begin graph delegation transaction")?;
        crate::outbound::mailbox_init::lock_gmail_connection(&mut tx, actor, email)
            .await
            .map_err(ConnectionError::MailboxInitialization)?;
        macro_db_client::macro_user_links::insert_edge(&mut *tx, actor, child, link)
            .await
            .context("Failed to insert macro_user_links edge")?;
        tx.commit()
            .await
            .context("Failed to commit graph delegation transaction")?;
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
        let mut tx = self
            .0
            .begin()
            .await
            .context("Failed to begin self-link bootstrap transaction")?;
        crate::outbound::mailbox_init::lock_gmail_connection(&mut tx, actor, email)
            .await
            .map_err(ConnectionError::MailboxInitialization)?;
        let link = enable_gmail_sync_for(tx.as_mut(), provisional, cursor).await?;
        macro_db_client::macro_user_links::insert_edge(&mut *tx, actor, child, link.id)
            .await
            .context("Failed to insert macro_user_links edge")?;
        tx.commit()
            .await
            .context("Failed to commit self-link bootstrap transaction")?;
        Ok(link)
    }

    async fn create(
        &self,
        actor: &str,
        provisional: Link,
        cursor: &str,
    ) -> Result<Link, ConnectionError> {
        let mut tx = self
            .0
            .begin()
            .await
            .context("Failed to begin link transaction")?;
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
            .context("Failed to commit link transaction")?;
        Ok(link)
    }

    async fn promote(
        &self,
        actor: &str,
        email: &str,
        existing: &Link,
        organization: Option<i32>,
    ) -> Result<SharedInboxPromotion, ConnectionError> {
        let mut tx = self
            .0
            .begin()
            .await
            .context("Failed to begin shared-inbox promotion transaction")?;
        crate::outbound::mailbox_init::lock_gmail_connection(&mut tx, actor, email)
            .await
            .map_err(ConnectionError::MailboxInitialization)?;
        let promoted = macro_db_client::shared_inbox::promote_link_to_shared(
            &mut tx,
            existing.id,
            existing.macro_id.as_ref(),
            actor,
            email,
            organization,
        )
        .await
        .context("Failed to promote link to shared inbox")?;
        tx.commit()
            .await
            .context("Failed to commit shared-inbox promotion transaction")?;
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
        .context("Failed to upsert link")?;

    email_db_client::histories::upsert_gmail_history(&mut *conn, link.id, history_id)
        .await
        .context("Failed to upsert gmail history")?;

    Ok(link)
}
