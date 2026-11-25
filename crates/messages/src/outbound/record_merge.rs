//! Discussions and mentions follow a merged CRM record to the one that stays,
//! inside the merging domain's transaction. Message ids, threads, replies,
//! edits, attachments and read state are untouched.

#[cfg(test)]
mod test;

use sqlx::PgConnection;
use uuid::Uuid;

/// The kind of CRM record whose discussions move.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergedParent {
    /// A CRM company.
    CrmCompany,
    /// A CRM contact.
    CrmContact,
}

impl MergedParent {
    fn as_str(self) -> &'static str {
        match self {
            Self::CrmCompany => "crm_company",
            Self::CrmContact => "crm_contact",
        }
    }
}

/// What moved, each with the record it named before.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MergedDiscussions {
    /// Messages re-parented: `(message id, previous parent id)`.
    pub messages: Vec<(Uuid, String)>,
    /// Thread rows re-parented: `(root id, previous parent id)`.
    pub threads: Vec<(Uuid, String)>,
    /// Mentions retargeted: `(mention id, previous entity id)`.
    pub mentions: Vec<(Uuid, String)>,
}

/// Move every discussion message and thread on `sources` to `survivor`, and
/// point mentions of `sources` at it. Messages and their thread rows change in
/// one statement: the thread's key to its root is checked at the statement's
/// end, so neither side is ever seen without the other.
#[tracing::instrument(
    name = "messages.merge_discussions",
    skip_all,
    fields(parent = parent.as_str(), sources = sources.len(), messages = tracing::field::Empty, mentions = tracing::field::Empty),
    err
)]
pub async fn merge_discussions_in(
    conn: &mut PgConnection,
    parent: MergedParent,
    sources: &[Uuid],
    survivor: Uuid,
) -> Result<MergedDiscussions, sqlx::Error> {
    let parent_type = parent.as_str();
    let sources: Vec<String> = sources.iter().map(Uuid::to_string).collect();
    let survivor = survivor.to_string();

    let moved = sqlx::query!(
        r#"WITH old_messages AS MATERIALIZED (
               SELECT id, parent_entity_id FROM comms_messages
               WHERE parent_entity_type = $1 AND parent_entity_id = ANY($2)
               ORDER BY id
               FOR UPDATE
           ), old_threads AS MATERIALIZED (
               SELECT root_id, parent_entity_id FROM comms_message_threads
               WHERE parent_entity_type = $1 AND parent_entity_id = ANY($2)
               ORDER BY root_id
               FOR UPDATE
           ), messages AS (
               UPDATE comms_messages m SET parent_entity_id = $3
               FROM old_messages o WHERE m.id = o.id
               RETURNING m.id
           ), threads AS (
               UPDATE comms_message_threads t SET parent_entity_id = $3
               FROM old_threads o WHERE t.root_id = o.root_id AND t.parent_entity_type = $1
               RETURNING t.root_id
           )
           SELECT 'message' AS "kind!", o.id AS "id!", o.parent_entity_id AS "previous!"
           FROM old_messages o JOIN messages USING (id)
           UNION ALL
           SELECT 'thread', o.root_id, o.parent_entity_id
           FROM old_threads o JOIN threads ON threads.root_id = o.root_id"#,
        parent_type,
        &sources,
        &survivor,
    )
    .fetch_all(&mut *conn)
    .await?;

    let mentions = sqlx::query!(
        r#"WITH old AS MATERIALIZED (
               SELECT id, entity_id FROM comms_entity_mentions
               WHERE entity_type = $1 AND entity_id = ANY($2)
               ORDER BY id
               FOR UPDATE
           ), updated AS (
               UPDATE comms_entity_mentions m SET entity_id = $3
               FROM old WHERE m.id = old.id
           )
           SELECT id AS "id!", entity_id AS "previous!" FROM old"#,
        parent_type,
        &sources,
        &survivor,
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut merged = MergedDiscussions::default();
    for row in moved {
        match row.kind.as_str() {
            "message" => merged.messages.push((row.id, row.previous)),
            _ => merged.threads.push((row.id, row.previous)),
        }
    }
    merged.mentions = mentions
        .into_iter()
        .map(|row| (row.id, row.previous))
        .collect();
    let span = tracing::Span::current();
    span.record("messages", merged.messages.len());
    span.record("mentions", merged.mentions.len());
    Ok(merged)
}

/// How many discussion messages are on `sources`, for a merge's review.
pub async fn count_discussion_messages_in(
    conn: &mut PgConnection,
    parent: MergedParent,
    sources: &[Uuid],
) -> Result<i64, sqlx::Error> {
    let sources: Vec<String> = sources.iter().map(Uuid::to_string).collect();
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM comms_messages
           WHERE parent_entity_type = $1 AND parent_entity_id = ANY($2) AND deleted_at IS NULL"#,
        parent.as_str(),
        &sources,
    )
    .fetch_one(conn)
    .await
}
