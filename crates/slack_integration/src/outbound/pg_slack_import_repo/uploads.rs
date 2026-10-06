//! Immutable descriptors, explicit verification, sealing and atomic readiness.

use super::*;

#[cfg(test)]
mod test;

struct UploadRow {
    object_key: String,
    sha256: String,
    byte_length: i64,
    record_count: Option<i32>,
    verified_version_id: Option<String>,
    verified_etag: Option<String>,
}

impl UploadRow {
    fn registered(&self, upload: UploadId) -> PortResult<RegisteredUpload> {
        Ok(RegisteredUpload {
            descriptor: UploadDescriptor {
                upload,
                sha256: self.sha256.parse().map_err(internal)?,
                byte_length: self.byte_length as u64,
                record_count: self.record_count.map(|n| n as u32),
            },
            key: self.object_key.parse().map_err(internal)?,
        })
    }

    fn identity(&self) -> PortResult<Option<ObjectIdentity>> {
        if let Some(version) = &self.verified_version_id {
            return Ok(Some(ObjectIdentity::Version(
                version.parse().map_err(internal)?,
            )));
        }
        self.verified_etag
            .as_ref()
            .map(|etag| Ok(ObjectIdentity::EntityTag(etag.parse().map_err(internal)?)))
            .transpose()
    }
}

impl PgSlackImportRepo {
    /// Register a bounded batch atomically, returning persisted server-owned keys.
    /// Exact retries do not consume additional bytes or change the job revision.
    pub async fn register(
        &self,
        team: TeamId,
        job: JobId,
        command: &RegisterUploads,
    ) -> PortResult<Vec<RegisteredUpload>> {
        check_batch(command.descriptors.iter().map(|d| &d.upload), &self.limits)?;
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let state = lock_job(&mut tx, team, job).await?;
        state.require_open()?;
        let mut total = state.registered_bytes as u64;
        let mut registered = Vec::with_capacity(command.descriptors.len());
        for descriptor in &command.descriptors {
            descriptor.validate(&self.limits).map_err(|error| {
                rootcause::Report::new(error).context(ImportError::LimitExceeded)
            })?;
            let existing = find_upload(&mut tx, team, job, &descriptor.upload).await?;
            if let Some(row) = existing {
                let upload = row.registered(descriptor.upload.clone())?;
                if upload.descriptor != *descriptor {
                    return Err(ImportError::Conflict.into());
                }
                registered.push(upload);
                continue;
            }
            let (channel, index) = upload_columns(&descriptor.upload)?;
            if let Some(channel) = channel {
                let conversation = sqlx::query!(
                    r#"SELECT c.sealed_at FROM slack_import_conversation c
                       JOIN slack_import_job j ON j.id = c.job_id
                       WHERE j.team_id = $1 AND j.id = $2 AND c.slack_channel_id = $3"#,
                    Uuid::from(team),
                    Uuid::from(job),
                    channel,
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(internal)?
                .ok_or(ImportError::Unavailable)?;
                if conversation.sealed_at.is_some() || !state.include_message_history {
                    return Err(ImportError::Conflict.into());
                }
            }
            total = total
                .checked_add(descriptor.byte_length)
                .filter(|n| *n <= self.limits.selected_bytes && *n <= i64::MAX as u64)
                .ok_or(ImportError::LimitExceeded)?;
            let key = object_key(team, job, &descriptor.upload)?;
            let bytes =
                i64::try_from(descriptor.byte_length).map_err(|_| ImportError::LimitExceeded)?;
            let records = descriptor
                .record_count
                .map(i32::try_from)
                .transpose()
                .map_err(|_| ImportError::LimitExceeded)?;
            sqlx::query!(
                r#"INSERT INTO slack_import_upload
                    (job_id, slack_channel_id, part_index, object_key, sha256, byte_length, record_count)
                   SELECT id, $3, $4, $5, $6, $7, $8 FROM slack_import_job
                   WHERE team_id = $1 AND id = $2
                   ON CONFLICT (job_id, slack_channel_id, part_index) DO NOTHING"#,
                Uuid::from(team), Uuid::from(job), channel, index, key.as_str(),
                descriptor.sha256.as_str(), bytes, records,
            ).execute(&mut *tx).await.map_err(internal)?;
            registered.push(RegisteredUpload {
                descriptor: descriptor.clone(),
                key,
            });
        }
        if total != state.registered_bytes as u64 {
            sqlx::query!(
                "UPDATE slack_import_job SET registered_bytes = $3 WHERE team_id = $1 AND id = $2",
                Uuid::from(team),
                Uuid::from(job),
                total as i64,
            )
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
            bump_revision(&mut tx, team, job).await?;
        }
        tx.commit().await.map_err(internal)?;
        Ok(registered)
    }

    /// Resolve only persisted identities belonging to this team and job.
    /// No key or key prefix can confer permission to verify an object.
    pub async fn uploads(
        &self,
        team: TeamId,
        job: JobId,
        uploads: &[UploadId],
    ) -> PortResult<Vec<RegisteredUpload>> {
        check_batch(uploads.iter(), &self.limits)?;
        let mut tx = self.pool.begin().await.map_err(internal)?;
        lock_job(&mut tx, team, job).await?;
        let mut registered = Vec::with_capacity(uploads.len());
        for upload in uploads {
            registered.push(
                find_upload(&mut tx, team, job, upload)
                    .await?
                    .ok_or(ImportError::Unavailable)?
                    .registered(upload.clone())?,
            );
        }
        tx.commit().await.map_err(internal)?;
        Ok(registered)
    }

    /// Record storage-verified immutable identities and optionally seal the entire
    /// manifest. Readiness and unique import events commit in this transaction.
    /// After closure, only exact completion/seal replays are accepted.
    pub async fn complete(
        &self,
        team: TeamId,
        job: JobId,
        verified: &[VerifiedUpload],
        seal: Option<&ConversationSeal>,
    ) -> PortResult<ImportProgress> {
        check_batch(
            verified.iter().map(|v| &v.registered.descriptor.upload),
            &self.limits,
        )?;
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let state = lock_job(&mut tx, team, job).await?;
        let mut changed = false;
        for upload in verified {
            let id = &upload.registered.descriptor.upload;
            let row = find_upload(&mut tx, team, job, id)
                .await?
                .ok_or(ImportError::Unavailable)?;
            if row.registered(id.clone())? != upload.registered {
                return Err(ImportError::UploadMismatch.into());
            }
            if let Some(identity) = row.identity()? {
                if identity != upload.identity {
                    return Err(ImportError::UploadMismatch.into());
                }
                continue;
            }
            state.require_open()?;
            let (version, etag) = match &upload.identity {
                ObjectIdentity::Version(value) => (Some(value.as_str()), None),
                ObjectIdentity::EntityTag(value) => (None, Some(value.as_str())),
            };
            let (channel, index) = upload_columns(id)?;
            sqlx::query!(
                r#"UPDATE slack_import_upload u
                   SET verified_at = clock_timestamp(), verified_version_id = $5, verified_etag = $6
                   FROM slack_import_job j
                   WHERE j.team_id = $1 AND j.id = $2 AND u.job_id = j.id
                     AND u.slack_channel_id IS NOT DISTINCT FROM $3
                     AND u.part_index IS NOT DISTINCT FROM $4 AND u.verified_at IS NULL"#,
                Uuid::from(team),
                Uuid::from(job),
                channel,
                index,
                version,
                etag,
            )
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
            changed = true;
        }
        if let Some(seal) = seal {
            changed |= seal_conversation(&mut tx, team, job, &state, seal).await?;
        }
        if state.require_open().is_ok() {
            // A users completion may release many previously sealed conversations.
            // Sealing alone (including a zero-part seal) cannot bypass users.
            let queued = sqlx::query!(
                r#"WITH ready AS (
                    UPDATE slack_import_conversation c
                    SET status = 'queued', event_generation = event_generation + 1, updated_at = clock_timestamp()
                    FROM slack_import_job j
                    WHERE j.team_id = $1 AND j.id = $2 AND c.job_id = j.id
                      AND j.status = 'uploading' AND j.registration_closed_at IS NULL
                      AND j.cancel_requested_at IS NULL
                      AND c.status = 'awaiting_uploads' AND c.sealed_at IS NOT NULL
                      AND EXISTS (SELECT 1 FROM slack_import_upload u
                                  WHERE u.job_id = j.id AND u.slack_channel_id IS NULL AND u.verified_at IS NOT NULL)
                      AND c.part_count = (SELECT count(*) FROM slack_import_upload u
                          WHERE u.job_id = c.job_id AND u.slack_channel_id = c.slack_channel_id
                            AND u.verified_at IS NOT NULL)
                    RETURNING c.job_id, c.slack_channel_id, c.event_generation
                )
                INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation)
                SELECT job_id, slack_channel_id, 'import', event_generation FROM ready
                ON CONFLICT (job_id, slack_channel_id, kind, generation) DO NOTHING"#,
                Uuid::from(team), Uuid::from(job),
            ).execute(&mut *tx).await.map_err(internal)?;
            changed |= queued.rows_affected() > 0;
        }
        if changed {
            bump_revision(&mut tx, team, job).await?;
        }
        let progress = self.receipt(&mut tx, team, job).await?;
        tx.commit().await.map_err(internal)?;
        Ok(progress)
    }
}

async fn find_upload(
    connection: &mut PgConnection,
    team: TeamId,
    job: JobId,
    upload: &UploadId,
) -> PortResult<Option<UploadRow>> {
    let (channel, index) = upload_columns(upload)?;
    sqlx::query_as!(
        UploadRow,
        r#"SELECT u.object_key, u.sha256, u.byte_length, u.record_count, u.verified_version_id, u.verified_etag
           FROM slack_import_upload u JOIN slack_import_job j ON j.id = u.job_id
           WHERE j.team_id = $1 AND j.id = $2
             AND u.slack_channel_id IS NOT DISTINCT FROM $3 AND u.part_index IS NOT DISTINCT FROM $4"#,
        Uuid::from(team), Uuid::from(job), channel, index,
    ).fetch_optional(connection).await.map_err(internal)
}

async fn seal_conversation(
    connection: &mut PgConnection,
    team: TeamId,
    job: JobId,
    state: &LockedJob,
    seal: &ConversationSeal,
) -> PortResult<bool> {
    let row = sqlx::query!(
        r#"SELECT c.part_count, c.manifest_sha256 FROM slack_import_conversation c
           JOIN slack_import_job j ON j.id = c.job_id
           WHERE j.team_id = $1 AND j.id = $2 AND c.slack_channel_id = $3"#,
        Uuid::from(team),
        Uuid::from(job),
        seal.slack_channel_id.as_str(),
    )
    .fetch_optional(&mut *connection)
    .await
    .map_err(internal)?
    .ok_or(ImportError::Unavailable)?;
    if let Some(count) = row.part_count {
        if count as u32 != seal.part_count
            || row.manifest_sha256.as_deref() != Some(seal.manifest_sha256.as_str())
        {
            return Err(ImportError::Conflict.into());
        }
        return Ok(false);
    }
    state.require_open()?;
    // Aggregate the complete stored set rather than trusting a completion batch.
    // The schema trigger independently validates this same canonical digest.
    let manifest = sqlx::query!(
        r#"SELECT count(*) AS "count!", max(u.part_index) AS last_index,
                  encode(digest(coalesce(string_agg(
                    u.part_index::text || ':' || u.sha256 || ':' || u.byte_length::text || ':' || u.record_count::text || E'\n',
                    '' ORDER BY u.part_index), ''), 'sha256'), 'hex') AS "sha256!"
           FROM slack_import_upload u JOIN slack_import_job j ON j.id = u.job_id
           WHERE j.team_id = $1 AND j.id = $2 AND u.slack_channel_id = $3"#,
        Uuid::from(team), Uuid::from(job), seal.slack_channel_id.as_str(),
    ).fetch_one(&mut *connection).await.map_err(internal)?;
    if manifest.count != i64::from(seal.part_count)
        || (manifest.count > 0 && manifest.last_index.map(i64::from) != Some(manifest.count - 1))
        || manifest.sha256 != seal.manifest_sha256.as_str()
    {
        return Err(ImportError::Conflict.into());
    }
    let count = i32::try_from(seal.part_count).map_err(|_| ImportError::LimitExceeded)?;
    sqlx::query!(
        r#"UPDATE slack_import_conversation c
           SET part_count = $4, manifest_sha256 = $5, sealed_at = clock_timestamp(), updated_at = clock_timestamp()
           FROM slack_import_job j
           WHERE j.team_id = $1 AND j.id = $2 AND c.job_id = j.id AND c.slack_channel_id = $3"#,
        Uuid::from(team), Uuid::from(job), seal.slack_channel_id.as_str(), count, seal.manifest_sha256.as_str(),
    ).execute(connection).await.map_err(internal)?;
    Ok(true)
}

fn upload_columns(upload: &UploadId) -> PortResult<(Option<&str>, Option<i32>)> {
    match upload {
        UploadId::Users => Ok((None, None)),
        UploadId::ConversationPart {
            slack_channel_id,
            part_index,
        } => Ok((
            Some(slack_channel_id.as_str()),
            Some(i32::try_from(*part_index).map_err(|_| ImportError::LimitExceeded)?),
        )),
    }
}

fn object_key(team: TeamId, job: JobId, upload: &UploadId) -> PortResult<ObjectKey> {
    let suffix = match upload {
        UploadId::Users => "users.json".to_owned(),
        UploadId::ConversationPart {
            slack_channel_id,
            part_index,
        } => format!("{slack_channel_id}/{part_index}.ndjson"),
    };
    format!("slack-import/{team}/{job}/{suffix}")
        .parse()
        .map_err(internal)
}

fn check_batch<'a>(
    uploads: impl Iterator<Item = &'a UploadId>,
    limits: &ImportLimits,
) -> PortResult<()> {
    let mut seen = HashSet::new();
    for upload in uploads {
        if !seen.insert(upload) {
            return Err(ImportError::InvalidInput.into());
        }
        if seen.len() > limits.registration_batch.min(50) as usize {
            return Err(ImportError::LimitExceeded.into());
        }
    }
    Ok(())
}
