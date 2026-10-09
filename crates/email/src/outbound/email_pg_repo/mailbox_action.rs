use crate::domain::models::mailbox_action::*;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

pub(super) async fn messages(
    pool: &PgPool,
    link_id: Uuid,
    thread_id: Uuid,
) -> Result<Vec<MailboxActionMessage>, sqlx::Error> {
    sqlx::query_as!(MailboxActionMessage, r#"
        SELECT m.id,m.provider_id,m.is_draft,m.is_sent,
            f.in_inbox AS "in_inbox!", f.in_trash AS "in_trash!", f.in_junk AS "in_junk!", f.is_present AS "is_present!"
        FROM email_messages m JOIN email_message_mailbox_facts f ON f.id = m.id
        WHERE m.link_id = $1 AND m.thread_id = $2 ORDER BY m.id
    "#,link_id,thread_id).fetch_all(pool).await
}

pub(super) async fn enqueue(
    pool: &PgPool,
    link_id: Uuid,
    actor: MacroUserIdStr<'_>,
    action: &MailboxAction,
    targets: &[MailboxActionTarget],
) -> Result<Uuid, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Serialize acceptance per mailbox and recheck the scoped delegation edge at
    // commit, so an access revocation cannot create new pending work.
    let binding = sqlx::query!(r#"
        SELECT l.sync_generation FROM email_links l WHERE l.id = $1 AND l.provider = 'OUTLOOK' AND l.is_sync_active
            AND (l.macro_id = $2 OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = $2))
        FOR UPDATE
    "#,link_id,actor.as_ref()).fetch_one(&mut *tx).await?;
    if let MailboxAction::Category { name, .. } = action {
        let available=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_labels l WHERE l.link_id=$1 AND l.provider_label_id=$2 AND l.type='User'
            AND NOT EXISTS(SELECT 1 FROM email_mailbox_settings_work w WHERE w.link_id=l.link_id AND w.kind='delete_label' AND w.resource_key=l.provider_label_id AND w.completed_revision<w.revision)) AS "available!""#,link_id,name).fetch_one(&mut *tx).await?;
        if !available {
            return Err(sqlx::Error::RowNotFound);
        }
    }
    let command_id = macro_uuid::generate_uuid_v7();
    let intent = serde_json::to_value(action).map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
    sqlx::query!(
        r#"
        INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status)
        VALUES ($1,$2,$3,$4,$5,'pending')
    "#,
        command_id,
        link_id,
        binding.sync_generation,
        actor.as_ref(),
        intent
    )
    .execute(&mut *tx)
    .await?;
    let mut threads = std::collections::HashSet::new();
    for target in targets {
        let mut pending =
            serde_json::to_value(&target.pending).map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
        if let MailboxAction::Category { name, present } = action {
            pending[format!("tag:{name}")] = serde_json::json!(present);
        }
        let message = sqlx::query!(
            r#"
            SELECT id,thread_id,provider_id FROM email_messages WHERE id = $1 AND link_id = $2
                AND (provider_id IS NOT DISTINCT FROM $3 OR ($3 IS NULL AND is_draft))
                AND NOT COALESCE((mailbox_state->>'provider_missing')::bool,false)
                AND NOT EXISTS(SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id=email_messages.id AND (d.delete_requested OR d.state='deleted'))
                AND NOT EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.source_id=email_messages.id AND t.state<>'preparing')
                FOR UPDATE
        "#,
            target.message_id,
            link_id,
            target.provider_id
        )
        .fetch_one(&mut *tx)
        .await?;
        threads.insert(message.thread_id);
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_command_targets (command_id,message_id,provider_id,pending)
            VALUES ($1,$2,$3,$4)
        "#,
            command_id,
            message.id,
            message.provider_id,
            pending
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(r#"
            INSERT INTO email_pending_mailbox_state (message_id,attribute,command_id,desired)
            SELECT $1,key,$2,value FROM jsonb_each($3)
            ON CONFLICT (message_id,attribute) DO UPDATE SET command_id = EXCLUDED.command_id,desired = EXCLUDED.desired
        "#,message.id,command_id,pending).execute(&mut *tx).await?;
        sqlx::query!(r#"
            UPDATE email_messages SET is_read = COALESCE($2,is_read), is_starred = COALESCE($3,is_starred)
            WHERE id = $1
        "#,message.id,target.pending.is_read,target.pending.is_flagged).execute(&mut *tx).await?;
        // This write belongs to the accepted trash command's transaction.
        if target.pending.in_trash == Some(true) {
            sqlx::query!("DELETE FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2 AND NOT sent AND NOT processing",message.id,link_id)
                .execute(&mut *tx).await?;
        }
    }
    for thread_id in threads {
        email_db_client::threads::update::recompute_thread_metadata(&mut tx, thread_id, link_id)
            .await?;
        let payload = serde_json::json!({"kind":"organization","thread_id":thread_id,"actor":actor.as_ref(),"action":action});
        sqlx::query!(
            r#"
            INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)
        "#,
            macro_uuid::generate_uuid_v7(),
            link_id,
            binding.sync_generation,
            payload
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(command_id)
}

pub(super) async fn operations(
    pool: &PgPool,
    link: Uuid,
    thread: Uuid,
) -> Result<Vec<MailboxOperation>, sqlx::Error> {
    let rows=sqlx::query!(r#"SELECT DISTINCT ON(c.intent->>'kind',c.intent->'value'->>'name') c.id,c.intent,c.status,c.updated_at
        FROM email_mailbox_commands c WHERE c.link_id=$1 AND EXISTS(SELECT 1 FROM email_mailbox_command_targets t
            JOIN email_messages m ON m.id=t.message_id WHERE t.command_id=c.id AND m.thread_id=$2 AND m.link_id=$1)
        ORDER BY c.intent->>'kind',c.intent->'value'->>'name',c.accepted_order DESC LIMIT 100"#,link,thread).fetch_all(pool).await?;
    rows.into_iter()
        .map(|row| {
            Ok(MailboxOperation {
                id: row.id,
                action: serde_json::from_value(row.intent)
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
                state: match row.status.as_str() {
                    "succeeded" => MailboxOperationState::Applied,
                    "failed" => MailboxOperationState::Failed,
                    "cancelled" => MailboxOperationState::Cancelled,
                    _ => MailboxOperationState::Pending,
                },
                updated_at: row.updated_at,
            })
        })
        .collect()
}
