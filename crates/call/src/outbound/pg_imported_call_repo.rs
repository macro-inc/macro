//! Imported calls use durable entities, never synthetic RTC/archive rows.
use crate::domain::{imports::*, records::*};
use async_trait::async_trait;
use entity_access_db_utils::{AccessLevel, EntityAccessSourceType, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

/// Transactional call-owned import storage.
pub struct PgImportedCallRepository {
    pool: PgPool,
}
impl PgImportedCallRepository {
    /// Use the shared application database.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ImportedCallRepository for PgImportedCallRepository {
    async fn upsert(&self, mut call: ImportedCall) -> Result<Uuid, rootcause::Report> {
        let source = &call.source;
        let provider = match source.provider {
            CallProvider::Macro => "macro",
            CallProvider::Granola => "granola",
        };
        let key = serde_json::to_string(&(
            source.user_id.as_ref(),
            &source.namespace,
            provider,
            &source.object_type,
            source.external_id.as_ref(),
        ))?;
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
            .execute(tx.as_mut())
            .await?;
        let existing = sqlx::query!(
            r#"SELECT call_id, external_updated_at, metadata FROM call_entity_sources
            WHERE user_id = $1 AND namespace = $2 AND provider = $3 AND object_type = $4 AND external_id = $5"#,
            source.user_id.as_ref(), source.namespace, provider, source.object_type, source.external_id.as_ref()
        ).fetch_optional(tx.as_mut()).await?;
        if let Some(existing) = &existing
            && matches!((source.external_updated_at, existing.external_updated_at), (Some(new), Some(old)) if new < old)
        {
            return Ok(existing.call_id);
        }
        let id = existing
            .as_ref()
            .map(|r| r.call_id)
            .unwrap_or_else(macro_uuid::generate_uuid_v7);
        let duration = call
            .started_at
            .zip(call.ended_at)
            .map(|(s, e)| (e - s).num_milliseconds());
        if existing.is_none() {
            let share_id = macro_uuid::generate_uuid_v7().to_string();
            share_permission_db_utils::create_private_share_permission(tx.as_mut(), &share_id)
                .await?;
            sqlx::query!(
                r#"INSERT INTO call_entities (id, user_id, title, created_via, started_at, ended_at, duration_ms, share_permission_id)
                VALUES ($1,$2,$3,'import',$4,$5,$6,$7)"#,
                id, source.user_id.as_ref(), call.title, call.started_at, call.ended_at, duration, share_id
            ).execute(tx.as_mut()).await?;
            entity_access_db_utils::insert_entity_access_row(
                &mut tx,
                &id,
                EntityType::Call,
                source.user_id.as_ref(),
                EntityAccessSourceType::User,
                AccessLevel::Owner,
            )
            .await?;
        } else {
            let old_title = existing
                .as_ref()
                .and_then(|e| e.metadata.get("sourceTitle"))
                .and_then(|v| v.as_str());
            // Preserve a title edited in Macro instead of clobbering it on sync.
            sqlx::query!(
                r#"UPDATE call_entities SET title = CASE WHEN title IS NOT DISTINCT FROM $7 THEN $2 ELSE title END,
                started_at = $3, ended_at = $4, duration_ms = $5, updated_at = now()
                WHERE id = $1 AND user_id = $6"#,
                id, call.title, call.started_at, call.ended_at, duration, source.user_id.as_ref(), old_title
            ).execute(tx.as_mut()).await?;
        }
        // Keep call-local participant IDs stable across edits. These email values
        // are provider identity hints only; they never create Macro-user grants.
        let old_ids: Vec<Uuid> = existing
            .as_ref()
            .and_then(|e| e.metadata.get("participantIds"))
            .map(|v| serde_json::from_value(v.clone()))
            .transpose()?
            .unwrap_or_default();
        let previous = sqlx::query!(
            "SELECT id, email FROM call_entity_participants WHERE call_id = $1 AND id = ANY($2)",
            id,
            &old_ids
        )
        .fetch_all(tx.as_mut())
        .await?;
        for participant in &mut call.participants {
            if let Some(previous) = previous.iter().find(|p| {
                p.email
                    .as_deref()
                    .zip(participant.email.as_deref())
                    .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
            }) {
                participant.id = previous.id;
            }
        }
        let participant_ids: Vec<Uuid> = call.participants.iter().map(|p| p.id).collect();
        sqlx::query!("DELETE FROM call_entity_participants WHERE call_id = $1 AND id = ANY($2) AND NOT (id = ANY($3))", id, &old_ids, &participant_ids)
            .execute(tx.as_mut()).await?;
        let participants = serde_json::to_value(&call.participants)?;
        sqlx::query!(
            r#"INSERT INTO call_entity_participants (call_id, id, display_name, email)
            SELECT $1, id, "displayName", email FROM jsonb_to_recordset($2::jsonb)
                AS p(id uuid, "displayName" text, email text)
            ON CONFLICT (call_id, id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email"#,
            id, participants
        ).execute(tx.as_mut()).await?;
        call.source
            .metadata
            .insert("participantIds".into(), json!(participant_ids));
        let old_transcript_id: Option<Uuid> = existing
            .as_ref()
            .and_then(|e| e.metadata.get("transcriptId"))
            .map(|v| serde_json::from_value(v.clone()))
            .transpose()?;
        if let Some(mut transcript) = call.transcript {
            transcript.id = old_transcript_id.unwrap_or(transcript.id);
            let transcript_id = transcript.id;
            sqlx::query!(
                r#"INSERT INTO call_entity_transcripts (call_id,id,provider,started_at)
                VALUES ($1,$2,$3,$4) ON CONFLICT (call_id,id) DO UPDATE SET started_at = EXCLUDED.started_at"#,
                id, transcript_id, provider, transcript.started_at
            ).execute(tx.as_mut()).await?;
            sqlx::query!("DELETE FROM call_entity_transcript_segments WHERE call_id = $1 AND transcript_id = $2", id, transcript_id)
                .execute(tx.as_mut()).await?;
            let segments = serde_json::to_value(transcript.segments)?;
            sqlx::query!(
                r#"INSERT INTO call_entity_transcript_segments (call_id,transcript_id,sequence_num,speaker_label,content,start_ms,end_ms)
                SELECT $1,$2,"sequenceNum","speakerLabel",content,"startMs","endMs"
                FROM jsonb_to_recordset($3::jsonb) AS s("sequenceNum" integer,"speakerLabel" text,content text,"startMs" bigint,"endMs" bigint)"#,
                id, transcript_id, segments
            ).execute(tx.as_mut()).await?;
            call.source
                .metadata
                .insert("transcriptId".into(), json!(transcript_id));
        } else if let Some(transcript_id) = old_transcript_id {
            sqlx::query!(
                "DELETE FROM call_entity_transcripts WHERE call_id = $1 AND id = $2",
                id,
                transcript_id
            )
            .execute(tx.as_mut())
            .await?;
        }
        let metadata = json!(call.source.metadata);
        sqlx::query!(
            r#"INSERT INTO call_entity_sources (call_id,user_id,namespace,provider,object_type,external_id,external_url,external_updated_at,synced_at,metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
            ON CONFLICT (user_id,namespace,provider,object_type,external_id) DO UPDATE SET
                external_url = EXCLUDED.external_url, external_updated_at = EXCLUDED.external_updated_at,
                synced_at = now(), metadata = EXCLUDED.metadata"#,
            id, call.source.user_id.as_ref(), call.source.namespace, provider, call.source.object_type,
            call.source.external_id.as_ref(), call.source.external_url, call.source.external_updated_at, metadata
        ).execute(tx.as_mut()).await?;
        tx.commit().await?;
        Ok(id)
    }

    async fn list_owned(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report> {
        Ok(sqlx::query_as!(
            ImportedCallPreview,
            r#"SELECT id,title,started_at,created_at FROM call_entities
            WHERE user_id = $1 AND created_via = 'import'
            ORDER BY created_at DESC, id DESC LIMIT 100"#,
            user.as_ref()
        )
        .fetch_all(&self.pool)
        .await?)
    }

    async fn read_owned(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report> {
        // One MVCC snapshot includes all children; no partially replaced transcript.
        let row = sqlx::query_file!(
            "src/outbound/pg_imported_call_repo/read.sql",
            user.as_ref(),
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| serde_json::from_value(row.record).map_err(rootcause::Report::from))
            .transpose()
    }
}

#[cfg(test)]
mod test;
