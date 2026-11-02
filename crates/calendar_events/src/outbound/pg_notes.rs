//! PostgreSQL adapter for durable meeting-note links.

use crate::domain::notes::*;
use sqlx::PgPool;
use uuid::Uuid;

/// Calendar-owned note-link storage.
pub struct PgNoteRepository {
    pool: PgPool,
}

impl PgNoteRepository {
    /// Use the primary database so permission changes are immediately visible.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl NoteRepository for PgNoteRepository {
    type Err = sqlx::Error;

    async fn document_links(
        &self,
        user: &str,
        document: &str,
    ) -> Result<Vec<DocumentNoteLink>, Self::Err> {
        let rows = sqlx::query!(r#"
            SELECT note.event_id, note.occurrence_key, document.name AS document_name,
                CASE WHEN calendar_note_event_visible($1, note.event_id, note.occurrence_key)
                     THEN CASE WHEN event.owner_id = $1 OR EXISTS (
                         SELECT 1 FROM macro_user_links delegate
                         WHERE delegate.link_id = event.source_link_id AND delegate.primary_macro_id = $1
                     ) THEN event.title ELSE 'Shared meeting' END
                     ELSE 'Unavailable meeting' END AS "event_title!",
                team.id AS "team_id?", team.name AS "team_name?"
            FROM calendar_event_notes note
            JOIN "Document" document ON document.id = note.document_id AND document.owner = $1 AND document."deletedAt" IS NULL
            JOIN calendar_events event ON event.id = note.event_id
            LEFT JOIN team ON team.id = note.team_id
            WHERE note.document_id = $2
            ORDER BY note.created_at, note.event_id, note.occurrence_key
        "#, user, document).fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| DocumentNoteLink {
                document_name: row.document_name,
                event_id: row.event_id,
                occurrence_key: row.occurrence_key,
                event_title: row.event_title,
                team: row
                    .team_id
                    .zip(row.team_name)
                    .map(|(id, name)| NoteTeam { id, name }),
            })
            .collect())
    }

    async fn visible(&self, user: &str, target: &NoteTarget) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            "SELECT calendar_note_event_visible($1, $2, calendar_note_link_key($2, $3)) AS \"visible!\"",
            user, target.event_id, target.occurrence_key,
        ).fetch_one(&self.pool).await
    }

    async fn occurrence_exists(&self, target: &NoteTarget) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            "SELECT EXISTS (SELECT 1 FROM calendar_event_occurrences WHERE event_id = $1 AND calendar_note_link_key($1, occurrence_key) = calendar_note_link_key($1, $2) AND NOT is_cancelled) AS \"exists!\"",
            target.event_id, target.occurrence_key,
        ).fetch_one(&self.pool).await
    }

    async fn is_markdown(&self, document: &str) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            "SELECT EXISTS (SELECT 1 FROM \"Document\" WHERE id = $1 AND \"fileType\" = 'md' AND \"deletedAt\" IS NULL) AS \"exists!\"",
            document,
        ).fetch_one(&self.pool).await
    }

    async fn team_member(&self, user: &str, team: Uuid) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            "SELECT EXISTS (SELECT 1 FROM team_user WHERE user_id = $1 AND team_id = $2) AS \"exists!\"",
            user, team,
        ).fetch_one(&self.pool).await
    }

    async fn list(&self, user: &str, target: &NoteTarget) -> Result<Vec<MeetingNote>, Self::Err> {
        let rows = sqlx::query!(r#"
            SELECT d.id, d.name, team.id AS "team_id?", team.name AS "team_name?",
                d.owner = $1 AS "can_manage!"
            FROM calendar_event_notes note
            JOIN calendar_events event ON event.id = note.event_id
            JOIN calendar_events requested ON requested.id = $2
              AND requested.ical_uid = event.ical_uid
              AND lower(requested.organizer_email) IS NOT DISTINCT FROM lower(event.organizer_email)
            JOIN "Document" d ON d.id = note.document_id AND d."deletedAt" IS NULL AND d."fileType" = 'md'
            LEFT JOIN team ON team.id = note.team_id
            WHERE note.occurrence_key = calendar_note_link_key($2, $3) AND event.status <> 'cancelled'
              AND calendar_note_event_visible($1, note.event_id, note.occurrence_key)
              AND calendar_note_copies_match(requested.id, note.event_id, calendar_note_link_key($2, $3))
            ORDER BY note.created_at, d.id
        "#, user, target.event_id, target.occurrence_key).fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| MeetingNote {
                document_id: row.id,
                name: row.name,
                team: row
                    .team_id
                    .zip(row.team_name)
                    .map(|(id, name)| NoteTeam { id, name }),
                can_manage: row.can_manage,
            })
            .collect())
    }

    async fn picker(&self, user: &str, query: &str) -> Result<NotePicker, Self::Err> {
        let documents = sqlx::query_as!(
            NoteDocument,
            r#"
            SELECT id AS document_id, name FROM "Document"
            WHERE owner = $1 AND "fileType" = 'md' AND "deletedAt" IS NULL
              AND name ILIKE '%' || $2 || '%'
            ORDER BY "updatedAt" DESC, id LIMIT 30
        "#,
            user,
            query
        )
        .fetch_all(&self.pool)
        .await?;
        let teams = sqlx::query_as!(
            NoteTeam,
            r#"
            SELECT team.id, team.name FROM team
            JOIN team_user member ON member.team_id = team.id WHERE member.user_id = $1
            ORDER BY team.name, team.id
        "#,
            user
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(NotePicker { documents, teams })
    }

    async fn link(
        &self,
        user: &str,
        target: &NoteTarget,
        document: &str,
        team: Option<Uuid>,
    ) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;
        // A document can be linked from two inbox copies concurrently. Serialize
        // its link writes so retries never leave duplicate or conflicting grants.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            document
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(r#"
            DELETE FROM calendar_event_notes note USING calendar_events event, calendar_events requested
            WHERE note.event_id = event.id AND requested.id = $1
              AND event.ical_uid = requested.ical_uid
              AND lower(event.organizer_email) IS NOT DISTINCT FROM lower(requested.organizer_email)
              AND note.occurrence_key = calendar_note_link_key($1, $2) AND note.document_id = $3 AND note.event_id <> $1
        "#, target.event_id, target.occurrence_key, document).execute(&mut *tx).await?;
        sqlx::query!(r#"
            INSERT INTO calendar_event_notes (event_id, occurrence_key, document_id, team_id, user_id)
            VALUES ($1, calendar_note_link_key($1, $2), $3, $4, $5)
            ON CONFLICT (event_id, occurrence_key, document_id) DO UPDATE SET team_id = EXCLUDED.team_id, user_id = EXCLUDED.user_id
        "#, target.event_id, target.occurrence_key, document, team, user).execute(&mut *tx).await?;
        tx.commit().await
    }

    async fn unlink(&self, target: &NoteTarget, document: &str) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            document
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(r#"
            DELETE FROM calendar_event_notes note USING calendar_events event, calendar_events requested
            WHERE note.event_id = event.id AND requested.id = $1
              AND event.ical_uid = requested.ical_uid
              AND lower(event.organizer_email) IS NOT DISTINCT FROM lower(requested.organizer_email)
              AND (note.occurrence_key = $2 OR note.occurrence_key = calendar_note_link_key($1, $2)) AND note.document_id = $3
        "#, target.event_id, target.occurrence_key, document).execute(&mut *tx).await?;
        tx.commit().await
    }
}
