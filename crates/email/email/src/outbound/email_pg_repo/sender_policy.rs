use super::*;

pub(in crate::outbound) async fn enqueue(
    tx: &mut sqlx::PgConnection,
    link: Uuid,
    sender: &str,
    blocked: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key,desired) VALUES($1,$2,'sender_block',$3,$4)
        ON CONFLICT(link_id,kind,resource_key) DO UPDATE SET desired=EXCLUDED.desired,
            revision=email_mailbox_settings_work.revision+1,next_run_at=now(),failure=NULL"#,
        macro_uuid::generate_uuid_v7(),link,sender,blocked).execute(tx).await?;
    Ok(())
}

pub(super) async fn commit(
    pool: &PgPool,
    actor: &MacroUserIdStr<'_>,
    link: Uuid,
    sender: &str,
    blocked: bool,
    important: Option<bool>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let binding=sqlx::query!(r#"SELECT l.sync_generation FROM email_links l WHERE l.id=$1 AND l.is_sync_active AND l.disconnect_requested_at IS NULL
        AND (l.macro_id=$2 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$2)) FOR UPDATE"#,link,actor.as_ref())
        .fetch_one(&mut *tx).await?;
    enqueue(&mut tx, link, sender, blocked).await?;
    if let Some(important) = important {
        email_filter::upsert_email_filter_by_address(&mut tx, link, sender, important).await?;
    }
    sqlx::query!(r#"INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES($1,$2,$3,'{"kind":"link_changed"}')"#,
        macro_uuid::generate_uuid_v7(),link,binding.sync_generation).execute(&mut *tx).await?;
    tx.commit().await
}
