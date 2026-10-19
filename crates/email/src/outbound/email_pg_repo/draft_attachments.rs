use super::EmailPgRepo;
use crate::domain::{draft_attachments::*, models::UserProvider};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[cfg(test)]
mod test;

fn db_error(_: sqlx::Error) -> AttachmentError {
    AttachmentError::Infrastructure
}

impl DraftAttachmentRepository for EmailPgRepo {
    async fn draft_upload(
        &self,
        link: Uuid,
        draft: Uuid,
        id: Uuid,
    ) -> Result<Option<crate::domain::models::AttachmentDraft>, AttachmentError> {
        let row = sqlx::query!("SELECT a.id,a.draft_id,a.file_name,a.content_type,a.sha,a.size,a.s3_key,a.upload_pending,a.content_id,a.is_inline FROM email_attachments_drafts a JOIN email_messages m ON m.id=a.draft_id WHERE m.link_id=$1 AND a.draft_id=$2 AND a.id=$3",link,draft,id)
            .fetch_optional(&self.pool).await.map_err(db_error)?;
        Ok(row.map(|r| crate::domain::models::AttachmentDraft {
            id: r.id,
            draft_id: r.draft_id,
            file_name: r.file_name,
            content_type: r.content_type,
            sha: r.sha,
            size: r.size,
            s3_key: r.s3_key,
            upload_pending: r.upload_pending,
            content_id: r.content_id,
            is_inline: r.is_inline,
        }))
    }
    async fn attachment_reference(
        &self,
        id: Uuid,
    ) -> Result<Option<AttachmentReference>, AttachmentError> {
        let row=sqlx::query!("SELECT a.id,m.link_id,m.thread_id,a.filename,a.mime_type,a.size_bytes,a.reference_url FROM email_attachments a JOIN email_messages m ON m.id = a.message_id WHERE a.id = $1",id).fetch_optional(&self.pool).await.map_err(db_error)?;
        Ok(row.map(|row| AttachmentReference {
            reference_url: row.reference_url,
            id: row.id,
            link_id: row.link_id,
            thread_id: row.thread_id,
            filename: row.filename,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
        }))
    }

    async fn commit_attachment_change(
        &self,
        actor: &str,
        link: Uuid,
        draft: Uuid,
        change: AttachmentChange,
    ) -> Result<(), AttachmentError> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let mailbox=sqlx::query!(r#"SELECT provider::text AS "provider!",sync_generation,
            (macro_id = $2 OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = $2)) AS "authorized!"
            FROM email_links l WHERE id = $1 FOR UPDATE"#,link,actor).fetch_optional(&mut *tx).await.map_err(db_error)?.ok_or(AttachmentError::NotFound)?;
        let message=sqlx::query!(r#"SELECT thread_id,is_draft,is_sent,
            EXISTS (SELECT 1 FROM email_scheduled_messages s WHERE s.message_id = m.id) AS "scheduled!",
            (EXISTS (SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id = m.id AND d.delete_requested) OR EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.source_id=m.id AND t.state<>'preparing')) AS "deleted!"
            FROM email_messages m WHERE id = $1 AND link_id = $2 FOR UPDATE"#,draft,link).fetch_optional(&mut *tx).await.map_err(db_error)?.ok_or(AttachmentError::NotFound)?;
        let provider = match mailbox.provider.as_str() {
            "GMAIL" => UserProvider::Gmail,
            "OUTLOOK" => UserProvider::Outlook,
            _ => return Err(AttachmentError::Infrastructure),
        };
        let total=sqlx::query_scalar!(r#"
            SELECT COALESCE((SELECT sum(size)::bigint FROM email_attachments_drafts WHERE draft_id = $1),0)
                + COALESCE((SELECT sum(a.size_bytes)::bigint FROM email_attachments_fwd f JOIN email_attachments a ON a.id = f.attachment_id WHERE f.message_id = $1),0)
                + COALESCE((SELECT sum(a.size_bytes)::bigint FROM email_attachments a WHERE a.message_id = $1
                    AND NOT EXISTS (SELECT 1 FROM email_draft_attachment_removals r WHERE r.message_id = $1 AND (r.provider_id = a.provider_attachment_id OR trim(both '<>' from r.content_id) = trim(both '<>' from a.content_id)))
                    AND NOT EXISTS (SELECT 1 FROM email_attachments_drafts d WHERE d.draft_id = $1 AND trim(both '<>' from a.content_id) = COALESCE(trim(both '<>' from d.content_id),d.id::text || '@attachments.macro.com'))
                    AND NOT EXISTS (SELECT 1 FROM email_attachments_fwd f JOIN email_attachments original ON original.id=f.attachment_id WHERE f.message_id = $1 AND (trim(both '<>' from a.content_id) = f.attachment_id::text || '@attachments.macro.com' OR trim(both '<>' from a.content_id)=trim(both '<>' from original.content_id)))),0) AS "total!"
        "#,draft).fetch_one(&mut *tx).await.map_err(db_error)?;
        let already_forwarded = if let AttachmentChange::Forward(source) = &change {
            sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_attachments_fwd WHERE message_id = $1 AND attachment_id = $2) AS \"exists!\"",draft,source.id).fetch_one(&mut *tx).await.map_err(db_error)?
        } else {
            false
        };
        let existing_upload = if let AttachmentChange::Upload(upload) = &change {
            sqlx::query!("SELECT draft_id,file_name,content_type,sha,size,s3_key FROM email_attachments_drafts WHERE id=$1", upload.id)
                .fetch_optional(&mut *tx).await.map_err(db_error)?
        } else {
            None
        };
        if let (Some(existing), AttachmentChange::Upload(upload)) = (&existing_upload, &change)
            && (existing.draft_id != draft
                || existing.file_name != upload.file_name
                || existing.content_type != upload.content_type
                || existing.sha != upload.sha
                || existing.size != upload.size
                || existing.s3_key != upload.s3_key)
        {
            return Err(AttachmentError::Invalid(
                "Upload identifier is already used for different content",
            ));
        }
        let added = match &change {
            AttachmentChange::Upload(_) if existing_upload.is_some() => 0,
            AttachmentChange::Upload(upload) => u64::try_from(upload.size)
                .map_err(|_| AttachmentError::Invalid("Invalid attachment size"))?,
            AttachmentChange::Forward(source) if !already_forwarded => u64::try_from(
                source
                    .size_bytes
                    .ok_or(AttachmentError::Invalid("Attachment size is unavailable"))?,
            )
            .map_err(|_| AttachmentError::Invalid("Invalid attachment size"))?,
            _ => 0,
        };
        validate_attachment_edit(
            &AttachmentEditFacts {
                authorized: mailbox.authorized,
                editable: (message.is_draft || message.scheduled)
                    && !message.is_sent
                    && !message.deleted,
                scheduled: message.scheduled,
                provider,
                total_bytes: total.max(0) as u64,
            },
            added,
        )?;
        match change {
            AttachmentChange::Upload(upload) => {
                let removed=sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_draft_object_cleanup WHERE object_key=$1) AS \"removed!\"",upload.s3_key)
                    .fetch_one(&mut *tx).await.map_err(db_error)?;
                if removed {
                    return Err(AttachmentError::NotFound);
                }
                let inserted=sqlx::query!(r#"INSERT INTO email_attachments_drafts (id,draft_id,file_name,content_type,sha,size,s3_key,upload_pending,upload_expires_at,content_id,is_inline)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 THEN now()+interval '1 day' ELSE NULL END,$9,$10)
                    ON CONFLICT (id) DO UPDATE SET upload_expires_at=CASE WHEN email_attachments_drafts.upload_pending THEN now()+interval '1 day' ELSE NULL END
                    WHERE email_attachments_drafts.draft_id=EXCLUDED.draft_id AND email_attachments_drafts.sha=EXCLUDED.sha AND email_attachments_drafts.size=EXCLUDED.size AND email_attachments_drafts.file_name=EXCLUDED.file_name AND email_attachments_drafts.content_type=EXCLUDED.content_type AND email_attachments_drafts.s3_key=EXCLUDED.s3_key"#,
                    upload.id,draft,upload.file_name,upload.content_type,upload.sha,upload.size,upload.s3_key,upload.upload_pending,upload.content_id,upload.is_inline)
                    .execute(&mut *tx).await.map_err(db_error)?.rows_affected();
                if inserted != 1 {
                    return Err(AttachmentError::Invalid(
                        "Attachment identity already belongs to another upload",
                    ));
                }
            }
            AttachmentChange::CompleteUpload(upload) => {
                let changed = sqlx::query!(r#"UPDATE email_attachments_drafts SET upload_pending=false,upload_expires_at=NULL
                    WHERE id=$1 AND draft_id=$2 AND sha=$3 AND size=$4 AND s3_key=$5
                    AND (NOT upload_pending OR upload_expires_at>now())"#, upload.id,draft,upload.sha,upload.size,upload.s3_key)
                    .execute(&mut *tx).await.map_err(db_error)?.rows_affected();
                if changed != 1 {
                    return Err(AttachmentError::Invalid(
                        "Upload expired or was removed; upload the file again",
                    ));
                }
            }
            AttachmentChange::Forward(source) => {
                // Re-adding a removed file restores both its Macro and original
                // inline Content-ID, rather than retaining a delete intention.
                sqlx::query!(r#"DELETE FROM email_draft_attachment_removals r WHERE r.message_id=$1 AND
                    (trim(both '<>' from r.content_id)=$2 OR trim(both '<>' from r.content_id)=(SELECT trim(both '<>' from content_id) FROM email_attachments WHERE id=$3))"#,
                    draft,format!("{}@attachments.macro.com",source.id),source.id).execute(&mut *tx).await.map_err(db_error)?;
                sqlx::query!("INSERT INTO email_attachments_fwd (message_id,attachment_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",draft,source.id).execute(&mut *tx).await.map_err(db_error)?;
            }
            AttachmentChange::Remove {
                attachment_id,
                kind: RemovalKind::Forwarded,
            } => {
                let row=sqlx::query!("DELETE FROM email_attachments_fwd WHERE message_id = $1 AND attachment_id = $2 RETURNING attachment_id",draft,attachment_id).fetch_optional(&mut *tx).await.map_err(db_error)?;
                if row.is_none() {
                    return Err(AttachmentError::NotFound);
                }
                content_removal(
                    &mut tx,
                    draft,
                    &format!("{attachment_id}@attachments.macro.com"),
                )
                .await?;
                // Inline forwarded files keep their original Content-ID.
                let cid = sqlx::query_scalar!(
                    "SELECT content_id FROM email_attachments WHERE id = $1",
                    attachment_id
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_error)?
                .flatten();
                if let Some(cid) = cid {
                    content_removal(&mut tx, draft, cid.trim_matches(['<', '>'])).await?;
                }
            }
            AttachmentChange::Remove {
                attachment_id,
                kind: RemovalKind::UploadedOrNative,
            } => {
                let upload=sqlx::query!("DELETE FROM email_attachments_drafts WHERE id = $1 AND draft_id = $2 RETURNING s3_key,content_id",attachment_id,draft).fetch_optional(&mut *tx).await.map_err(db_error)?;
                if let Some(upload) = upload {
                    sqlx::query!("INSERT INTO email_draft_object_cleanup (object_key,available_at) VALUES ($1,now() + interval '1 day') ON CONFLICT DO NOTHING",upload.s3_key).execute(&mut *tx).await.map_err(db_error)?;
                    content_removal(
                        &mut tx,
                        draft,
                        &upload
                            .content_id
                            .unwrap_or_else(|| format!("{attachment_id}@attachments.macro.com")),
                    )
                    .await?;
                } else {
                    let native=sqlx::query!("SELECT provider_attachment_id FROM email_attachments WHERE id = $1 AND message_id = $2",attachment_id,draft).fetch_optional(&mut *tx).await.map_err(db_error)?.ok_or(AttachmentError::NotFound)?;
                    let id = native
                        .provider_attachment_id
                        .ok_or(AttachmentError::NotFound)?;
                    sqlx::query!("INSERT INTO email_draft_attachment_removals (id,message_id,provider_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",macro_uuid::generate_uuid_v7(),draft,id).execute(&mut *tx).await.map_err(db_error)?;
                }
            }
        }
        sqlx::query!(r#"
            UPDATE email_messages m SET updated_at = now(),has_attachments =
                EXISTS (SELECT 1 FROM email_attachments_drafts a WHERE a.draft_id = m.id)
                OR EXISTS (SELECT 1 FROM email_attachments_fwd a WHERE a.message_id = m.id)
                OR EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = m.id AND NOT EXISTS (
                    SELECT 1 FROM email_draft_attachment_removals r WHERE r.message_id = m.id AND (r.provider_id = a.provider_attachment_id OR trim(both '<>' from r.content_id) = trim(both '<>' from a.content_id))))
            WHERE m.id = $1
        "#,draft).execute(&mut *tx).await.map_err(db_error)?;
        super::draft::snapshot_outlook_draft(&mut tx, draft, link, actor)
            .await
            .map_err(db_error)?;
        if provider == UserProvider::Outlook {
            let payload = serde_json::json!({"kind":"organization","thread_id":message.thread_id});
            sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),link,mailbox.sync_generation,payload).execute(&mut *tx).await.map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)
    }
}

async fn content_removal(
    tx: &mut Transaction<'_, Postgres>,
    draft: Uuid,
    cid: &str,
) -> Result<(), AttachmentError> {
    let cid = cid.trim_matches(['<', '>']);
    sqlx::query!("INSERT INTO email_draft_attachment_removals (id,message_id,content_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",macro_uuid::generate_uuid_v7(),draft,cid).execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}
