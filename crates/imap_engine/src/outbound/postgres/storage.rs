//! Indexed component storage; individual operations hydrate only their selected keys.
use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// The location document has no duplicate of the required indexed digest.
#[derive(serde::Serialize, serde::Deserialize)]
struct LocationDocument {
    folder_id: String,
    uid_validity: u32,
    uid: u32,
    message_id: String,
}
impl From<&Location> for LocationDocument {
    fn from(location: &Location) -> Self {
        Self {
            folder_id: location.folder_id.clone(),
            uid_validity: location.uid_validity,
            uid: location.uid,
            message_id: location.message_id.clone(),
        }
    }
}
pub(super) fn decode_location(
    document: Value,
    fingerprint: MessageFingerprint,
) -> Result<Location, Error> {
    let document: LocationDocument = serde_json::from_value(document).map_err(corrupt_state)?;
    Ok(Location {
        folder_id: document.folder_id,
        uid_validity: document.uid_validity,
        uid: document.uid,
        message_id: document.message_id,
        fingerprint,
    })
}

#[derive(Clone, serde::Serialize)]
struct Entry {
    kind: StateEntryKind,
    key: String,
    folder_id: Option<String>,
    message_id: Option<String>,
    sequence: Option<i64>,
    received_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(serialize_with = "serialize_fingerprint")]
    fingerprint: Option<MessageFingerprint>,
    document: Value,
    body: Option<String>,
}
#[derive(serde::Serialize)]
struct DeletedEntry<'a> {
    kind: StateEntryKind,
    key: &'a str,
}

fn serialize_fingerprint<S: serde::Serializer>(
    fingerprint: &Option<MessageFingerprint>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match fingerprint {
        Some(value) => serializer.serialize_some(&STANDARD.encode(value.as_bytes())),
        None => serializer.serialize_none(),
    }
}
impl Entry {
    fn new(
        kind: StateEntryKind,
        key: String,
        value: &impl serde::Serialize,
    ) -> Result<Self, Error> {
        Ok(Self {
            kind,
            key,
            folder_id: None,
            message_id: None,
            sequence: None,
            received_at: None,
            fingerprint: None,
            document: serde_json::to_value(value).map_err(|_| Error::Invalid)?,
            body: None,
        })
    }
    fn hash(&self) -> Result<[u8; 32], Error> {
        self.hash_and_size().map(|(hash, _)| hash)
    }
    fn hash_and_size(&self) -> Result<([u8; 32], usize), Error> {
        let encoded = serde_json::to_vec(self).map_err(|_| Error::Invalid)?;
        Ok((Sha256::digest(&encoded).into(), encoded.len()))
    }
}
fn entries(state: &AccountState) -> Result<Vec<Entry>, Error> {
    let mut rows = Vec::new();
    for (id, f) in &state.folders {
        let mut f = f.clone();
        for c in std::mem::take(&mut f.journal) {
            let mut e = Entry::new(
                StateEntryKind::Change,
                format!("{}:{}:{:020}", id, f.uid_validity, c.sequence),
                &c,
            )?;
            e.folder_id = Some(id.clone());
            e.sequence = Some(i64::try_from(c.sequence).map_err(|_| Error::Invalid)?);
            rows.push(e);
        }
        rows.push(Entry::new(StateEntryKind::Folder, id.clone(), &f)?);
    }
    for (id, m) in &state.messages {
        let mut metadata = m.clone();
        if m.source_complete && !metadata.mime_base64.is_empty() {
            let mut source = Entry::new(
                StateEntryKind::SentSource,
                id.clone(),
                &serde_json::json!({}),
            )?;
            source.body = Some(std::mem::take(&mut metadata.mime_base64));
            rows.push(source);
        }
        let mut e = Entry::new(StateEntryKind::Message, id.clone(), &metadata)?;
        e.folder_id = Some(m.folder_id.clone());
        e.received_at = Some(m.received_at);
        rows.push(e);
    }
    for l in &state.locations {
        let mut e = Entry::new(
            StateEntryKind::Location,
            l.storage_key(),
            &LocationDocument::from(l),
        )?;
        e.folder_id = Some(l.folder_id.clone());
        e.message_id = Some(l.message_id.clone());
        e.fingerprint = Some(l.fingerprint);
        rows.push(e);
    }
    for (id, t) in &state.thread_refs {
        rows.push(Entry::new(StateEntryKind::Thread, id.clone(), t)?);
    }
    for (id, d) in &state.drafts {
        let mut d = d.clone();
        if let Some(content) = d.frozen_content.take() {
            rows.push(Entry::new(
                StateEntryKind::FrozenSubmission,
                id.clone(),
                &content,
            )?);
        }
        for (cid, attachment) in std::mem::take(&mut d.attachments) {
            let mut e = Entry::new(
                StateEntryKind::Attachment,
                format!("{id}/{cid}"),
                &attachment,
            )?;
            e.message_id = Some(id.clone());
            rows.push(e);
        }
        rows.push(Entry::new(StateEntryKind::Draft, id.clone(), &d)?);
    }
    for (id, u) in &state.uploads {
        let mut u = u.clone();
        let bytes = std::mem::take(&mut u.bytes);
        let mut e = Entry::new(StateEntryKind::Upload, id.to_string(), &u)?;
        e.message_id = Some(u.draft_id.clone());
        e.body = Some(STANDARD.encode(bytes));
        rows.push(e);
    }
    Ok(rows)
}
fn hydrate(state: &mut AccountState, rows: &[Entry]) -> Result<(), Error> {
    // Parents before children, independent of database order.
    for e in rows {
        match e.kind {
            StateEntryKind::Folder => {
                state.folders.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone()).map_err(corrupt_state)?,
                );
            }
            StateEntryKind::Message => {
                state.messages.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone()).map_err(corrupt_state)?,
                );
            }
            StateEntryKind::Location => {
                let location = decode_location(
                    e.document.clone(),
                    e.fingerprint.ok_or(Error::ConnectionUnavailable)?,
                )?;
                if location.storage_key() != e.key {
                    return Err(Error::ConnectionUnavailable);
                }
                state.locations.push(location);
            }
            StateEntryKind::Thread => {
                state.thread_refs.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone()).map_err(corrupt_state)?,
                );
            }
            StateEntryKind::Draft => {
                state.drafts.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone()).map_err(corrupt_state)?,
                );
            }
            StateEntryKind::Upload => {
                let mut u: Upload =
                    serde_json::from_value(e.document.clone()).map_err(corrupt_state)?;
                u.bytes = STANDARD
                    .decode(e.body.as_deref().unwrap_or(""))
                    .map_err(corrupt_state)?;
                state.uploads.insert(u.session.id, u);
            }
            StateEntryKind::Change
            | StateEntryKind::Attachment
            | StateEntryKind::FrozenSubmission
            | StateEntryKind::SentSource => {}
        }
    }
    for e in rows {
        if e.kind == StateEntryKind::Change {
            if let Some(f) = e
                .folder_id
                .as_ref()
                .and_then(|id| state.folders.get_mut(id))
            {
                f.journal
                    .push(serde_json::from_value(e.document.clone()).map_err(corrupt_state)?);
            }
        } else if e.kind == StateEntryKind::FrozenSubmission {
            if let Some(draft) = state.drafts.get_mut(&e.key) {
                draft.frozen_content = Some(e.document.clone());
            }
        } else if e.kind == StateEntryKind::SentSource {
            if let Some(message) = state.messages.get_mut(&e.key) {
                message.mime_base64 = e.body.clone().ok_or_else(|| corrupt_state(()))?;
            }
        } else if e.kind == StateEntryKind::Attachment
            && let Some(d) = e
                .message_id
                .as_ref()
                .and_then(|id| state.drafts.get_mut(id))
        {
            let attachment: AttachmentInput =
                serde_json::from_value(e.document.clone()).map_err(corrupt_state)?;
            d.attachments
                .insert(attachment.content_id.clone(), attachment);
        }
    }
    for f in state.folders.values_mut() {
        f.journal.sort_by_key(|c| c.sequence);
    }
    Ok(())
}
struct EntryRow {
    kind: String,
    key: String,
    folder_id: Option<String>,
    message_id: Option<String>,
    sequence: Option<i64>,
    received_at: Option<chrono::DateTime<chrono::Utc>>,
    fingerprint: Option<Vec<u8>>,
    document: Value,
    body: Option<Vec<u8>>,
}

impl TryFrom<EntryRow> for Entry {
    type Error = Error;

    fn try_from(row: EntryRow) -> Result<Self, Error> {
        Ok(Self {
            kind: row.kind.parse().map_err(corrupt_state)?,
            key: row.key,
            folder_id: row.folder_id,
            message_id: row.message_id,
            sequence: row.sequence,
            received_at: row.received_at,
            fingerprint: row
                .fingerprint
                .as_deref()
                .map(MessageFingerprint::from_bytes)
                .transpose()?,
            document: row.document,
            body: row.body.map(|bytes| STANDARD.encode(bytes)),
        })
    }
}

fn append_entries(rows: &mut Vec<Entry>, loaded: Vec<EntryRow>) -> Result<(), Error> {
    for row in loaded {
        rows.push(Entry::try_from(row)?);
    }
    Ok(())
}

impl PgRepository {
    pub(super) async fn hydrate(
        &self,
        connection: &mut sqlx::PgConnection,
        account: &mut Account,
        selection: StateSelection,
    ) -> Result<(), Error> {
        let link = account.binding.link_id;
        let mut rows = Vec::new();
        if !matches!(selection, StateSelection::Health | StateSelection::Sync) {
            append_entries(
                &mut rows,
                sqlx::query_as!(
                    EntryRow,
                    r#"
                    SELECT
                        kind,
                        key,
                        folder_id,
                        message_id,
                        sequence,
                        received_at,
                        fingerprint,
                        document,
                        body
                    FROM
                        imap_state_entries
                    WHERE
                        link_id = $1
                        AND kind = 'folder'
                    ORDER BY
                        key
                    LIMIT 2000
                    "#,
                    link,
                )
                .fetch_all(&mut *connection)
                .await
                .map_err(super::acquisition::load_error)?,
            )?;
        }
        match selection {
            StateSelection::Health => return Ok(()),
            StateSelection::Sync => {
                // Sync only needs a draft's Message-ID and delivery metadata.
                // The row hash also covers this projection, so unchanged drafts
                // never enter save_entries' write set.
                append_entries(
                    &mut rows,
                    sqlx::query_as!(
                        EntryRow,
                        r#"
                        SELECT
                            kind,
                            key,
                            folder_id,
                            message_id,
                            sequence,
                            received_at,
                            fingerprint,
                            CASE WHEN kind = 'draft' THEN
                                jsonb_set(document, '{input,content}', jsonb_build_object(
                                    'message_id', document #> '{input,content,message_id}'
                                ))
                            ELSE document END AS "document!",
                            body
                        FROM
                            imap_state_entries
                        WHERE
                            link_id = $1
                            AND kind = ANY ($2)
                        "#,
                        link,
                        &[
                            StateEntryKind::Folder,
                            StateEntryKind::Message,
                            StateEntryKind::Location,
                            StateEntryKind::Change,
                            StateEntryKind::Thread,
                            StateEntryKind::Draft,
                        ]
                        .map(|kind| kind.as_ref().to_owned())[..],
                    )
                    .fetch_all(&mut *connection)
                    .await
                    .map_err(super::acquisition::load_error)?,
                )?;
            }
            StateSelection::Catalog => {}
            StateSelection::Message(id) => {
                self.load_message(connection, link, &id, &mut rows).await?;
            }
            StateSelection::Recent(limit) => {
                let folders = rows
                    .iter()
                    .filter_map(|e| serde_json::from_value::<FolderState>(e.document.clone()).ok())
                    .filter(|f| f.folder.role == FolderRole::Inbox)
                    .map(|f| f.folder.id)
                    .collect::<Vec<_>>();
                append_entries(
                    &mut rows,
                    sqlx::query_as!(
                        EntryRow,
                        r#"
                        SELECT
                            kind,
                            key,
                            folder_id,
                            message_id,
                            sequence,
                            received_at,
                            fingerprint,
                            document,
                            body
                        FROM
                            imap_state_entries
                        WHERE
                            link_id = $1
                            AND kind = 'message'
                            AND folder_id = ANY ($2)
                        ORDER BY
                            received_at DESC,
                            key
                        LIMIT $3
                        "#,
                        link,
                        &folders,
                        i64::from(limit.min(100)),
                    )
                    .fetch_all(&mut *connection)
                    .await
                    .map_err(super::acquisition::load_error)?,
                )?;
                // The preceding recent-message query caps these keys at 100.
                let ids = rows
                    .iter()
                    .filter(|e| e.kind == StateEntryKind::Message)
                    .map(|e| e.key.clone())
                    .collect::<Vec<_>>();
                append_entries(
                    &mut rows,
                    sqlx::query_as!(
                        EntryRow,
                        r#"
                        WITH requested AS MATERIALIZED (
                            SELECT DISTINCT message_id
                            FROM unnest($2::text[]) AS ids(message_id)
                        )
                        SELECT
                            locations.kind,
                            locations.key,
                            locations.folder_id,
                            locations.message_id,
                            locations.sequence,
                            locations.received_at,
                            locations.fingerprint,
                            locations.document,
                            locations.body
                        FROM requested
                        CROSS JOIN LATERAL (
                            SELECT
                                kind,
                                key,
                                folder_id,
                                message_id,
                                sequence,
                                received_at,
                                fingerprint,
                                document,
                                body
                            FROM imap_state_entries
                            WHERE link_id = $1
                                AND kind = 'location'
                                AND message_id = requested.message_id
                            OFFSET 0
                        ) locations
                        "#,
                        link,
                        &ids,
                    )
                    .fetch_all(&mut *connection)
                    .await
                    .map_err(super::acquisition::load_error)?,
                )?;
            }
            StateSelection::Draft { id, reply_to } => {
                self.load_draft(connection, link, &id, &mut rows).await?;
                if let Some(id) = reply_to {
                    self.load_message(connection, link, &id, &mut rows).await?;
                }
            }
            StateSelection::Upload(id) => {
                let id = id.to_string();
                append_entries(
                    &mut rows,
                    sqlx::query_as!(
                        EntryRow,
                        r#"
                        SELECT
                            kind,
                            key,
                            folder_id,
                            message_id,
                            sequence,
                            received_at,
                            fingerprint,
                            document,
                            body
                        FROM
                            imap_state_entries
                        WHERE
                            link_id = $1
                            AND kind = 'upload'
                            AND key = $2
                        "#,
                        link,
                        id,
                    )
                    .fetch_all(&mut *connection)
                    .await
                    .map_err(super::acquisition::load_error)?,
                )?;
                if let Some(id) = rows
                    .iter()
                    .find(|e| e.kind == StateEntryKind::Upload)
                    .and_then(|e| e.message_id.clone())
                {
                    self.load_draft(connection, link, &id, &mut rows).await?;
                }
            }
            StateSelection::Changes {
                folder,
                after,
                sequence,
            } => {
                if let Some(after) = after {
                    append_entries(
                        &mut rows,
                        sqlx::query_as!(
                            EntryRow,
                            r#"
                            SELECT DISTINCT ON (message_id)
                                kind,
                                key,
                                folder_id,
                                message_id,
                                sequence,
                                received_at,
                                fingerprint,
                                document,
                                body
                            FROM
                                imap_state_entries
                            WHERE
                                link_id = $1
                                AND kind = 'location'
                                AND folder_id = $2
                                AND message_id > $3
                            ORDER BY
                                message_id,
                                key
                            LIMIT 501
                            "#,
                            link,
                            folder,
                            after,
                        )
                        .fetch_all(&mut *connection)
                        .await
                        .map_err(super::acquisition::load_error)?,
                    )?;
                } else {
                    let sequence = i64::try_from(sequence).map_err(|_| Error::CursorOutdated)?;
                    // Include the earliest retained journal row for cursor-expiration policy.
                    append_entries(
                        &mut rows,
                        sqlx::query_as!(
                            EntryRow,
                            r#"
                            SELECT
                                kind,
                                key,
                                folder_id,
                                message_id,
                                sequence,
                                received_at,
                                fingerprint,
                                document,
                                body
                            FROM
                                imap_state_entries
                            WHERE
                                link_id = $1
                                AND kind = 'change'
                                AND folder_id = $2
                                AND (sequence >
                                        $3
                                        OR sequence =
                                            (
                                                SELECT
                                                    min(sequence)
                                                FROM
                                                    imap_state_entries
                                                WHERE
                                                    link_id = $1
                                                    AND kind = 'change'
                                                    AND folder_id = $2))
                                    ORDER BY
                                        sequence
                                    LIMIT 502
                            "#,
                            link,
                            folder,
                            sequence,
                        )
                        .fetch_all(&mut *connection)
                        .await
                        .map_err(super::acquisition::load_error)?,
                    )?;
                }
            }
        }
        let rows = normalize_entries(rows);
        let mut encoded_bytes = 0usize;
        account.checkpoint = rows
            .iter()
            .map(|entry| {
                let (hash, bytes) = entry.hash_and_size()?;
                encoded_bytes = encoded_bytes.saturating_add(bytes);
                Ok(((entry.kind, entry.key.clone()), hash))
            })
            .collect::<Result<_, Error>>()?;
        let span = tracing::Span::current();
        span.record(
            "imap.load.rows",
            i64::try_from(rows.len()).unwrap_or(i64::MAX),
        );
        span.record(
            "imap.load.bytes",
            i64::try_from(encoded_bytes).unwrap_or(i64::MAX),
        );
        hydrate(&mut account.state, &rows)
    }
    async fn load_message(
        &self,
        connection: &mut sqlx::PgConnection,
        link: Uuid,
        id: &str,
        rows: &mut Vec<Entry>,
    ) -> Result<(), Error> {
        append_entries(
            rows,
            sqlx::query_as!(
                EntryRow,
                r#"
                SELECT
                    kind,
                    key,
                    folder_id,
                    message_id,
                    sequence,
                    received_at,
                    fingerprint,
                    document,
                    body
                FROM
                    imap_state_entries
                WHERE
                    link_id = $1
                    AND ((kind IN ('message', 'sent_source')
                            AND key = $2)
                        OR (kind = 'location'
                            AND message_id = $2))
                "#,
                link,
                id,
            )
            .fetch_all(&mut *connection)
            .await
            .map_err(super::acquisition::load_error)?,
        )?;
        Ok(())
    }
    async fn load_draft(
        &self,
        connection: &mut sqlx::PgConnection,
        link: Uuid,
        id: &str,
        rows: &mut Vec<Entry>,
    ) -> Result<(), Error> {
        append_entries(
            rows,
            sqlx::query_as!(
                EntryRow,
                r#"
                SELECT
                    kind,
                    key,
                    folder_id,
                    message_id,
                    sequence,
                    received_at,
                    fingerprint,
                    document,
                    body
                FROM
                    imap_state_entries
                WHERE
                    link_id = $1
                    AND ((kind IN ('draft', 'frozen_submission')
                            AND key = $2)
                        OR (kind = 'attachment'
                            AND message_id = $2)
                        OR (kind IN ('message', 'sent_source')
                            AND key = $2))
                "#,
                link,
                id,
            )
            .fetch_all(&mut *connection)
            .await
            .map_err(super::acquisition::load_error)?,
        )?;
        let reply = rows
            .iter()
            .find(|e| e.kind == StateEntryKind::Draft && e.key == id)
            .and_then(|e| serde_json::from_value::<DraftState>(e.document.clone()).ok())
            .and_then(|d| d.input.reply_to);
        if let Some(reply) = reply {
            self.load_message(connection, link, &reply, rows).await?;
        }
        Ok(())
    }
    pub(super) async fn save_entries(&self, a: &mut Account) -> Result<(), Error> {
        a.lease_id.ok_or(Error::Conflict)?;
        let rows = entries(&a.state)?;
        let mut next = BTreeMap::new();
        let mut changed = Vec::new();
        for e in rows {
            let key = (e.kind, e.key.clone());
            let hash = e.hash()?;
            if a.checkpoint.get(&key) != Some(&hash) {
                changed.push(e);
            }
            next.insert(key, hash);
        }
        let mut deleted = a
            .checkpoint
            .keys()
            .filter(|k| !next.contains_key(*k))
            .map(|(kind, key)| DeletedEntry { kind: *kind, key })
            .collect::<Vec<_>>();
        // A Sync may have matched a remote Sent copy without loading the
        // frozen bytes. Retire that exact companion row with the new draft state.
        deleted.extend(
            changed
                .iter()
                .filter(|entry| entry.kind == StateEntryKind::Draft)
                .filter_map(|entry| {
                    let draft = a.state.drafts.get(&entry.key)?;
                    (draft.submission == Some(SubmissionOutcome::Accepted)
                        && !draft.sent_copy_pending)
                        .then_some(DeletedEntry {
                            kind: StateEntryKind::FrozenSubmission,
                            key: &entry.key,
                        })
                }),
        );
        // Sync loads the fallback's metadata only. If the provider copy
        // replaces that fallback, remove its complete source in the same save.
        deleted.extend(
            changed
                .iter()
                .filter(|entry| entry.kind == StateEntryKind::Message)
                .filter(|entry| {
                    a.state.messages.get(&entry.key).is_some_and(|message| {
                        !message.source_complete && message.draft_correlation.is_some()
                    })
                })
                .map(|entry| DeletedEntry {
                    kind: StateEntryKind::SentSource,
                    key: &entry.key,
                }),
        );
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '30s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        let revision = Self::write_health(&mut tx, a).await?;
        let removed_drafts = deleted
            .iter()
            .filter(|entry| entry.kind == StateEntryKind::Draft)
            .map(|entry| entry.key.to_owned())
            .collect::<Vec<_>>();
        if !removed_drafts.is_empty() {
            sqlx::query!(
                r#"
                DELETE FROM imap_state_entries
                WHERE link_id = $1
                    AND kind IN ('attachment', 'upload')
                    AND message_id = ANY ($2)
                "#,
                a.binding.link_id,
                &removed_drafts,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        for chunk in deleted.chunks(500) {
            let data = serde_json::to_value(chunk).map_err(|_| Error::Invalid)?;
            sqlx::query!(
                r#"
                DELETE FROM imap_state_entries e USING jsonb_to_recordset($2::jsonb) AS d (kind text,
                        key text)
                    WHERE e.link_id = $1
                        AND e.kind = d.kind
                        AND e.key = d.key
                "#,
                a.binding.link_id,
                data,
            ).execute(&mut *tx).await.map_err(db_error)?;
        }
        // A sync may update post-send flags on projected drafts. Preserve
        // the stored content until a confirmed, settled send can retire it.
        for chunk in changed.chunks(500) {
            let data = serde_json::to_value(chunk).map_err(|_| Error::Invalid)?;
            sqlx::query!(
                r#"
                INSERT INTO imap_state_entries (link_id, kind, key, folder_id, message_id, sequence,
                    received_at,
                    fingerprint,
                    document,
                    body
                )
                SELECT
                    $1,
                    d.kind,
                    d.key,
                    d.folder_id,
                    d.message_id,
                    d.sequence,
                    d.received_at,
                    decode(d.fingerprint, 'base64'),
                    d.document,
                    decode(d.body, 'base64')
                FROM
                    jsonb_to_recordset($2::jsonb) AS d (kind text,
                        key text,
                        folder_id text,
                        message_id text,
                        sequence bigint
                ,
                            received_at timestamptz,
                            fingerprint text,
                            document jsonb,
                            body text)
                    ON CONFLICT (link_id,
                        kind,
                        key)
                        DO UPDATE SET
                            folder_id = EXCLUDED.folder_id,
                            message_id = EXCLUDED.message_id,
                            sequence =
                                EXCLUDED.sequence,
                                received_at = EXCLUDED.received_at,
                                fingerprint = EXCLUDED.fingerprint,
                                document = CASE WHEN $3 AND EXCLUDED.kind = 'draft'
                                        AND (EXCLUDED.document->>'submission' IS DISTINCT FROM 'accepted'
                                            OR EXCLUDED.document->>'sent_copy_pending' = 'true')
                                    THEN jsonb_set(EXCLUDED.document, '{input,content}',
                                        imap_state_entries.document #> '{input,content}')
                                    ELSE EXCLUDED.document END,
                                body = EXCLUDED.body
                "#,
                a.binding.link_id,
                data,
                a.loaded_for_sync,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)?;
        a.revision = revision;
        a.checkpoint = next;
        Ok(())
    }
    async fn write_health(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        a: &Account,
    ) -> Result<i64, Error> {
        let lease = a.lease_id.ok_or(Error::Conflict)?;
        let health = serde_json::to_value(a.state.small_state()).map_err(|_| Error::Invalid)?;
        // A settings edit clears the sync retry delay. A concurrent command
        // must not restore that old delay when it saves its own state.
        let r = sqlx::query!(
            r#"
            UPDATE
                imap_accounts
            SET
                state = CASE WHEN folder_preferences_revision = $8
                    THEN $6::jsonb ELSE $6::jsonb - 'sync_retry_at' END,
                revision = revision + 1,
                lease_until = now() + make_interval(secs => $7::double precision),
                updated_at = now()
            WHERE
                link_id = $1
                AND sync_generation = $2
                AND grant_generation = $3
                AND lease_id = $4
                AND revision = $5
                AND (NOT $9 OR folder_preferences_revision = $8)
                AND lease_until > now()
                AND EXISTS (
                    SELECT
                        1
                    FROM
                        imap_current_links l
                    WHERE
                        l.id = imap_accounts.link_id
                        AND l.macro_id = imap_accounts.user_id
                        AND NOT l.needs_reauth
                        AND l.sync_generation = imap_accounts.sync_generation
                        AND l.grant_generation = imap_accounts.grant_generation)
            RETURNING
                revision
            "#,
            a.binding.link_id,
            a.binding.sync_generation,
            a.binding.grant_generation,
            lease,
            a.revision,
            health,
            COMMAND_LEASE_BUDGET.as_secs_f64(),
            a.folder_preferences_revision,
            a.loaded_for_sync,
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_error)?
        .ok_or(Error::Conflict)?;
        Ok(r.revision)
    }
    pub(super) async fn save_small_state(&self, a: &mut Account) -> Result<(), Error> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let revision = Self::write_health(&mut tx, a).await?;
        tx.commit().await.map_err(db_error)?;
        a.revision = revision;
        Ok(())
    }
}

// The BTreeMap supplies byte-key order independently of query row order, and
// deduplicates uploads returned by both their own and their draft's selection.
fn normalize_entries(rows: Vec<Entry>) -> Vec<Entry> {
    let mut unique = BTreeMap::new();
    for entry in rows {
        unique.insert((entry.kind, entry.key.clone()), entry);
    }
    unique.into_values().collect()
}

#[cfg(test)]
mod test;
