//! Indexed component storage; individual operations hydrate only their selected keys.
use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Clone, serde::Serialize)]
struct Entry {
    kind: String,
    key: String,
    folder_id: Option<String>,
    message_id: Option<String>,
    sequence: Option<i64>,
    received_at: Option<chrono::DateTime<chrono::Utc>>,
    document: Value,
    body: Option<String>,
}
impl Entry {
    fn new(kind: &str, key: String, value: &impl serde::Serialize) -> Result<Self, Error> {
        Ok(Self {
            kind: kind.into(),
            key,
            folder_id: None,
            message_id: None,
            sequence: None,
            received_at: None,
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
                "change",
                format!("{}:{}:{:020}", id, f.uid_validity, c.sequence),
                &c,
            )?;
            e.folder_id = Some(id.clone());
            e.sequence = Some(i64::try_from(c.sequence).map_err(|_| Error::Invalid)?);
            rows.push(e);
        }
        rows.push(Entry::new("folder", id.clone(), &f)?);
    }
    for (id, m) in &state.messages {
        let mut e = Entry::new("message", id.clone(), m)?;
        e.folder_id = Some(m.folder_id.clone());
        e.received_at = Some(m.received_at);
        rows.push(e);
    }
    for l in &state.locations {
        let mut e = Entry::new(
            "location",
            format!("{}:{}:{}", l.folder_id, l.uid_validity, l.uid),
            l,
        )?;
        e.folder_id = Some(l.folder_id.clone());
        e.message_id = Some(l.message_id.clone());
        rows.push(e);
    }
    for (id, t) in &state.thread_refs {
        rows.push(Entry::new("thread", id.clone(), t)?);
    }
    for (id, d) in &state.drafts {
        let mut d = d.clone();
        for (cid, attachment) in std::mem::take(&mut d.attachments) {
            let mut e = Entry::new("attachment", format!("{id}/{cid}"), &attachment)?;
            e.message_id = Some(id.clone());
            rows.push(e);
        }
        rows.push(Entry::new("draft", id.clone(), &d)?);
    }
    for (id, u) in &state.uploads {
        let mut u = u.clone();
        let bytes = std::mem::take(&mut u.bytes);
        let mut e = Entry::new("upload", id.to_string(), &u)?;
        e.message_id = Some(u.draft_id.clone());
        e.body = Some(STANDARD.encode(bytes));
        rows.push(e);
    }
    Ok(rows)
}
fn hydrate(state: &mut AccountState, rows: &[Entry]) -> Result<(), Error> {
    // Parents before children, independent of database order.
    for e in rows {
        match e.kind.as_str() {
            "folder" => {
                state.folders.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone())
                        .map_err(|_| Error::ConnectionUnavailable)?,
                );
            }
            "message" => {
                state.messages.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone())
                        .map_err(|_| Error::ConnectionUnavailable)?,
                );
            }
            "location" => state.locations.push(
                serde_json::from_value(e.document.clone())
                    .map_err(|_| Error::ConnectionUnavailable)?,
            ),
            "thread" => {
                state.thread_refs.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone())
                        .map_err(|_| Error::ConnectionUnavailable)?,
                );
            }
            "draft" => {
                state.drafts.insert(
                    e.key.clone(),
                    serde_json::from_value(e.document.clone())
                        .map_err(|_| Error::ConnectionUnavailable)?,
                );
            }
            "upload" => {
                let mut u: Upload = serde_json::from_value(e.document.clone())
                    .map_err(|_| Error::ConnectionUnavailable)?;
                u.bytes = STANDARD
                    .decode(e.body.as_deref().unwrap_or(""))
                    .map_err(|_| Error::ConnectionUnavailable)?;
                state.uploads.insert(u.session.id, u);
            }
            _ => {}
        }
    }
    for e in rows {
        if e.kind == "change" {
            if let Some(f) = e
                .folder_id
                .as_ref()
                .and_then(|id| state.folders.get_mut(id))
            {
                f.journal.push(
                    serde_json::from_value(e.document.clone())
                        .map_err(|_| Error::ConnectionUnavailable)?,
                );
            }
        } else if e.kind == "attachment"
            && let Some(d) = e
                .message_id
                .as_ref()
                .and_then(|id| state.drafts.get_mut(id))
        {
            let attachment: AttachmentInput = serde_json::from_value(e.document.clone())
                .map_err(|_| Error::ConnectionUnavailable)?;
            d.attachments
                .insert(attachment.content_id.clone(), attachment);
        }
    }
    for f in state.folders.values_mut() {
        f.journal.sort_by_key(|c| c.sequence);
    }
    Ok(())
}
macro_rules! load {
    ($connection:expr, $rows:expr, $query:expr) => {
        for r in $query
            .fetch_all(&mut *$connection)
            .await
            .map_err(super::acquisition::load_error)?
        {
            $rows.push(Entry {
                kind: r.kind,
                key: r.key,
                folder_id: r.folder_id,
                message_id: r.message_id,
                sequence: r.sequence,
                received_at: r.received_at,
                document: r.document,
                body: r.body.map(|b| STANDARD.encode(b)),
            });
        }
    };
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
        match selection {
            StateSelection::Sync => {
                load!(
                    connection,
                    rows,
                    sqlx::query!(
                        r#"
                        SELECT
                            kind,
                            key,
                            folder_id,
                            message_id,
                            sequence,
                            received_at,
                            document,
                            body
                        FROM
                            imap_state_entries
                        WHERE
                            link_id = $1
                            AND kind = ANY ($2)
                        "#,
                        link,
                        &["folder", "message", "location", "change", "thread", "draft"]
                            .map(str::to_owned)[..],
                    )
                );
            }
            selection => {
                load!(
                    connection,
                    rows,
                    sqlx::query!(
                        r#"
                        SELECT
                            kind,
                            key,
                            folder_id,
                            message_id,
                            sequence,
                            received_at,
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
                );
                match selection {
                    StateSelection::Catalog => {}
                    StateSelection::Message(id) => {
                        self.load_message(connection, link, &id, &mut rows).await?;
                    }
                    StateSelection::Recent(limit) => {
                        let folders = rows
                            .iter()
                            .filter_map(|e| {
                                serde_json::from_value::<FolderState>(e.document.clone()).ok()
                            })
                            .filter(|f| f.folder.role == FolderRole::Inbox)
                            .map(|f| f.folder.id)
                            .collect::<Vec<_>>();
                        load!(
                            connection,
                            rows,
                            sqlx::query!(
                                r#"
                                SELECT
                                    kind,
                                    key,
                                    folder_id,
                                    message_id,
                                    sequence,
                                    received_at,
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
                        );
                        let ids = rows
                            .iter()
                            .filter(|e| e.kind == "message")
                            .map(|e| e.key.clone())
                            .collect::<Vec<_>>();
                        load!(
                            connection,
                            rows,
                            sqlx::query!(
                                r#"
                                SELECT
                                    kind,
                                    key,
                                    folder_id,
                                    message_id,
                                    sequence,
                                    received_at,
                                    document,
                                    body
                                FROM
                                    imap_state_entries
                                WHERE
                                    link_id = $1
                                    AND kind = 'location'
                                    AND message_id = ANY ($2)
                                "#,
                                link,
                                &ids,
                            )
                        );
                    }
                    StateSelection::Draft { id, reply_to } => {
                        self.load_draft(connection, link, &id, &mut rows).await?;
                        if let Some(id) = reply_to {
                            self.load_message(connection, link, &id, &mut rows).await?;
                        }
                    }
                    StateSelection::Upload(id) => {
                        let id = id.to_string();
                        load!(
                            connection,
                            rows,
                            sqlx::query!(
                                r#"
                                SELECT
                                    kind,
                                    key,
                                    folder_id,
                                    message_id,
                                    sequence,
                                    received_at,
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
                        );
                        if let Some(id) = rows
                            .iter()
                            .find(|e| e.kind == "upload")
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
                            load!(
                                connection,
                                rows,
                                sqlx::query!(
                                    r#"
                                    SELECT DISTINCT ON (message_id)
                                        kind,
                                        key,
                                        folder_id,
                                        message_id,
                                        sequence,
                                        received_at,
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
                            );
                        } else {
                            let sequence =
                                i64::try_from(sequence).map_err(|_| Error::CursorOutdated)?;
                            // Include the earliest retained journal row for cursor-expiration policy.
                            load!(
                                connection,
                                rows,
                                sqlx::query!(
                                    r#"
                                    SELECT
                                        kind,
                                        key,
                                        folder_id,
                                        message_id,
                                        sequence,
                                        received_at,
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
                            );
                        }
                    }
                    StateSelection::Sync => unreachable!(),
                }
            }
        }
        // A selected upload is also returned by its owning draft query.
        let mut unique = BTreeMap::new();
        for e in rows {
            unique.insert((e.kind.clone(), e.key.clone()), e);
        }
        let rows = unique.into_values().collect::<Vec<_>>();
        let mut encoded_bytes = 0usize;
        account.checkpoint = rows
            .iter()
            .map(|entry| {
                let (hash, bytes) = entry.hash_and_size()?;
                encoded_bytes = encoded_bytes.saturating_add(bytes);
                Ok(((entry.kind.clone(), entry.key.clone()), hash))
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
        load!(
            connection,
            rows,
            sqlx::query!(
                r#"
                SELECT
                    kind,
                    key,
                    folder_id,
                    message_id,
                    sequence,
                    received_at,
                    document,
                    body
                FROM
                    imap_state_entries
                WHERE
                    link_id = $1
                    AND ((kind = 'message'
                            AND key = $2)
                        OR (kind = 'location'
                            AND message_id = $2))
                "#,
                link,
                id,
            )
        );
        Ok(())
    }
    async fn load_draft(
        &self,
        connection: &mut sqlx::PgConnection,
        link: Uuid,
        id: &str,
        rows: &mut Vec<Entry>,
    ) -> Result<(), Error> {
        load!(
            connection,
            rows,
            sqlx::query!(
                r#"
                SELECT
                    kind,
                    key,
                    folder_id,
                    message_id,
                    sequence,
                    received_at,
                    document,
                    body
                FROM
                    imap_state_entries
                WHERE
                    link_id = $1
                    AND ((kind = 'draft'
                            AND key = $2)
                        OR (kind = 'attachment'
                            AND message_id = $2)
                        OR (kind = 'message'
                            AND key = $2))
                "#,
                link,
                id,
            )
        );
        let reply = rows
            .iter()
            .find(|e| e.kind == "draft" && e.key == id)
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
            let key = (e.kind.clone(), e.key.clone());
            let hash = e.hash()?;
            if a.checkpoint.get(&key) != Some(&hash) {
                changed.push(e);
            }
            next.insert(key, hash);
        }
        let deleted = a
            .checkpoint
            .keys()
            .filter(|k| !next.contains_key(*k))
            .map(|(kind, key)| serde_json::json!({"kind":kind,"key":key}))
            .collect::<Vec<_>>();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '30s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        let revision = Self::write_health(&mut tx, a).await?;
        let removed_drafts = deleted
            .iter()
            .filter(|v| v["kind"] == "draft")
            .filter_map(|v| v["key"].as_str().map(str::to_owned))
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
            .map_err(|_| Error::ConnectionUnavailable)?;
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
            ).execute(&mut *tx).await.map_err(|_|Error::ConnectionUnavailable)?;
        }
        for chunk in changed.chunks(500) {
            let data = serde_json::to_value(chunk).map_err(|_| Error::Invalid)?;
            sqlx::query!(
                r#"
                INSERT INTO imap_state_entries (link_id, kind, key, folder_id, message_id, sequence,
                    received_at,
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
                                document = EXCLUDED.document,
                                body = EXCLUDED.body
                "#,
                a.binding.link_id,
                data,
            )
            .execute(&mut *tx)
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        }
        tx.commit()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
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
        let r = sqlx::query!(
            r#"
            UPDATE
                imap_accounts
            SET
                state = $6,
                revision = revision + 1,
                lease_until = now() + interval '5 minutes',
                updated_at = now()
            WHERE
                link_id = $1
                AND sync_generation = $2
                AND grant_generation = $3
                AND lease_id = $4
                AND revision = $5
                AND lease_until > now()
                AND EXISTS (
                    SELECT
                        1
                    FROM
                        email_links l
                    WHERE
                        l.id = imap_accounts.link_id
                        AND l.macro_id = imap_accounts.user_id
                        AND l.provider = 'IMAP'
                        AND l.is_sync_active
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
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .ok_or(Error::Conflict)?;
        Ok(r.revision)
    }
    pub(super) async fn save_small_state(&self, a: &mut Account) -> Result<(), Error> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        let revision = Self::write_health(&mut tx, a).await?;
        tx.commit()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        a.revision = revision;
        Ok(())
    }
}
