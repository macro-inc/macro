use crate::domain::models::{
    EmailErr,
    mailbox_operation::{MessageResolutionAction, MessageResolutionPlan},
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

/// Commit the domain's resolution only while authorization, revision, provider
/// version and operation phase still match the decision the user reviewed.
pub(super) async fn commit(
    pool: &PgPool,
    actor: &MacroUserIdStr<'_>,
    plan: MessageResolutionPlan,
) -> Result<Uuid, EmailErr> {
    let id = plan.message_id;
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    let link=sqlx::query!(r#"
        SELECT l.id,l.sync_generation FROM email_links l JOIN email_messages m ON m.link_id = l.id
        WHERE m.id = $1 AND (l.macro_id = $2 OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = $2))
        FOR UPDATE OF l
    "#,id,actor.as_ref()).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?.ok_or(EmailErr::MessageNotFound(id))?;
    let message=sqlx::query!("SELECT thread_id,provider_id,provider_version,is_sent FROM email_messages WHERE id = $1 FOR UPDATE",id).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
    if message.is_sent {
        return Err(EmailErr::MessageAlreadySent(id));
    }
    if plan
        .expected
        .remote_version
        .as_deref()
        .is_some_and(|v| v.starts_with("transfer:"))
    {
        let keep = matches!(plan.action, MessageResolutionAction::KeepOriginal);
        let changed=sqlx::query!(r#"UPDATE email_draft_transfers SET state=CASE WHEN $5 THEN 'retained' ELSE 'cleanup' END,
            issue=NULL,revision=revision+1,available_at=now(),updated_at=now()
            WHERE destination_id=$1 AND revision=$2 AND 'transfer:'||id::text=$3 AND state IN ('cleanup','conflict')
                AND (lease_until IS NULL OR lease_until<now()) AND (actor_id=$4 OR EXISTS(SELECT 1 FROM email_links source WHERE source.id=source_link_id AND (source.macro_id=$4 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=source.id AND u.primary_macro_id=$4))))"#,
            id,plan.expected.revision,plan.expected.remote_version,actor.as_ref(),keep).execute(&mut *tx).await.map_err(anyhow::Error::from)?.rows_affected();
        if changed != 1 {
            return Err(EmailErr::MessageDeliveryConflict(id));
        }
        let payload = serde_json::json!({"kind":"organization","thread_id":message.thread_id});
        sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),link.id,link.sync_generation,payload).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        tx.commit().await.map_err(anyhow::Error::from)?;
        return Ok(message.thread_id);
    }
    if message.provider_version != plan.expected.remote_version {
        return Err(EmailErr::MessageDeliveryConflict(id));
    }
    let expected_state = serde_json::to_value(plan.expected.state).map_err(anyhow::Error::from)?;
    let expected_stage = plan
        .expected
        .stage
        .map(serde_json::to_value)
        .transpose()
        .map_err(anyhow::Error::from)?;
    let row=sqlx::query!(r#"
        SELECT checkpoint FROM email_mailbox_drafts WHERE message_id = $1 AND revision = $2 AND state = $3
            AND checkpoint->>'stage' IS NOT DISTINCT FROM $4 AND generation = $5
            AND (lease_until IS NULL OR lease_until < now()) FOR UPDATE
    "#,id,plan.expected.revision,expected_state.as_str(),expected_stage.as_ref().and_then(serde_json::Value::as_str),link.sync_generation).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?.ok_or(EmailErr::MessageDeliveryConflict(id))?;
    match plan.action {
        MessageResolutionAction::KeepOriginal => return Err(EmailErr::MessageDeliveryConflict(id)),
        MessageResolutionAction::KeepLocal | MessageResolutionAction::UseProvider => {
            // Resolving content is not permission to send a changed payload. A
            // fresh Send/Schedule action is required after the conflict is resolved.
            let processing=sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND processing AND NOT sent) AS \"processing!\"",id).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
            if processing {
                return Err(EmailErr::MessageDeliveryConflict(id));
            }
            sqlx::query!("DELETE FROM email_scheduled_messages WHERE message_id = $1 AND NOT sent AND NOT processing",id).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
            sqlx::query!("UPDATE email_messages SET is_draft = true,mailbox_state = COALESCE(mailbox_state,'{}'::jsonb) - 'provider_missing' WHERE id = $1 AND NOT is_sent",id).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
            match plan.action {
                MessageResolutionAction::KeepLocal => {
                    sqlx::query!(r#"
                        UPDATE email_mailbox_drafts SET revision = revision + 1,base_version = $2,checkpoint = NULL,
                            state = 'pending',error_code = NULL,delete_requested = false,actor_id = $3,available_at = now(),updated_at = now()
                        WHERE message_id = $1
                    "#,id,message.provider_version,actor.as_ref()).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
                }
                MessageResolutionAction::UseProvider => {
                    let provider_id = message
                        .provider_id
                        .as_ref()
                        .ok_or(EmailErr::MessageDeliveryConflict(id))?;
                    sqlx::query!(r#"
                        UPDATE email_mailbox_drafts SET synced_revision = revision,base_version = $2,checkpoint = NULL,
                            state = 'synced',error_code = 'accepting_remote',delete_requested = false,actor_id = $3,updated_at = now()
                        WHERE message_id = $1
                    "#,id,message.provider_version,actor.as_ref()).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
                    // Force current provider content through normal ingestion even
                    // when this version was already observed during the conflict.
                    sqlx::query!("UPDATE email_messages SET provider_version = NULL,body_macro = NULL WHERE id = $1",id).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
                    sqlx::query!(r#"
                        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,revision,is_import)
                        VALUES ($1,$2,$3,1,false) ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET
                            revision = email_message_reconciliation.revision + 1,available_at = now()
                    "#,link.id,link.sync_generation,provider_id).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
                }
                _ => unreachable!("outer match limits content resolutions"),
            }
        }
        MessageResolutionAction::Recheck | MessageResolutionAction::RetrySend => {
            let mut checkpoint = row
                .checkpoint
                .ok_or(EmailErr::MessageDeliveryConflict(id))?;
            let now = serde_json::to_value(chrono::Utc::now()).map_err(anyhow::Error::from)?;
            checkpoint["stage_started_at"] = now.clone();
            if checkpoint.get("transfer").is_some_and(|v| v.is_object()) {
                checkpoint["transfer"]["started_at"] = now;
            }
            if plan.action == MessageResolutionAction::RetrySend {
                checkpoint["stage"] = serde_json::json!("ready");
                checkpoint["actor_id"] = serde_json::json!(actor.as_ref());
                checkpoint["submission_started"] = serde_json::json!(false);
                let changed=sqlx::query!("UPDATE email_scheduled_messages SET processing = false,send_time = now(),actor_id = $2,updated_at = now() WHERE message_id = $1 AND NOT sent",id,actor.as_ref()).execute(&mut *tx).await.map_err(anyhow::Error::from)?.rows_affected();
                if changed != 1 {
                    return Err(EmailErr::MessageDeliveryConflict(id));
                }
            }
            sqlx::query!("UPDATE email_mailbox_drafts SET checkpoint = $2,state = 'pending',error_code = NULL,actor_id = $3,available_at = now(),updated_at = now() WHERE message_id = $1",id,checkpoint,actor.as_ref()).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        }
    }
    super::thread::update_thread_metadata(&mut tx, message.thread_id, link.id)
        .await
        .map_err(anyhow::Error::from)?;
    let payload = serde_json::json!({"kind":"organization","thread_id":message.thread_id});
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",
        macro_uuid::generate_uuid_v7(),
        link.id,
        link.sync_generation,
        payload
    )
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(message.thread_id)
}
