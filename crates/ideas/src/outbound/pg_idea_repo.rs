//! PostgreSQL store for ideas: the base `idea` row, one child row per kind,
//! the items in `idea_target`, and every generation session's change in
//! `suggestion_change`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use sqlx::{PgConnection, PgPool};

use crate::domain::model::{
    Category, Change, Idea, IdeaContent, IdeaKind, IdeaState, NewKind, Target, TargetRole,
};
use crate::domain::ports::{IdeaRepo, Limits, Written};

#[cfg(test)]
pub(crate) mod test;

/// Why reading or writing ideas failed.
#[derive(Debug, thiserror::Error)]
pub enum PgIdeaRepoError {
    /// The database failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A stored row holds a value the domain doesn't know.
    #[error("undecodable idea row: {0}")]
    Decode(String),
}

/// Which of a person's ideas a read loads.
enum Read<'a> {
    /// Open, and done since `done_since`: the feed.
    Shown { done_since: DateTime<Utc> },
    /// Open, and the `closed` most recently closed: a session's review.
    Review { closed: i64 },
    /// One, by id.
    Id(Uuid),
    /// One, by dedup key.
    Key(&'a str),
}

/// An idea's base row with its kind's columns.
struct IdeaRow {
    id: Uuid,
    kind: String,
    dedup_key: String,
    title: String,
    summary: String,
    importance: i16,
    categories: Vec<String>,
    state: String,
    state_reason: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    state_changed_at: DateTime<Utc>,
    prompt: Option<String>,
    run_mode: Option<String>,
    action: Option<String>,
    routine_suggestion_id: Option<Uuid>,
}

/// [`IdeaRepo`] on MacroDB.
pub struct PgIdeaRepo {
    pool: PgPool,
}

impl PgIdeaRepo {
    /// Ideas in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The person's ideas that `read` names, one query per kind of read so
    /// each plan uses its own index.
    async fn load(
        &self,
        user: &MacroUserIdStr<'_>,
        read: Read<'_>,
    ) -> Result<Vec<Idea>, PgIdeaRepoError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        let rows = match read {
            Read::Shown { done_since } => {
                sqlx::query_as!(
                    IdeaRow,
                    r#"SELECT i.id, i.kind, i.dedup_key, i.title, i.summary, i.importance,
                              i.categories, i.state, i.state_reason, i.created_at, i.updated_at,
                              i.state_changed_at,
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM idea i
                       LEFT JOIN idea_prompt p ON p.idea_id = i.id
                       LEFT JOIN idea_entity e ON e.idea_id = i.id
                       LEFT JOIN idea_routine r ON r.idea_id = i.id
                       WHERE i.user_id = $1
                         AND (i.state IN ('proposed', 'accepted')
                              OR (i.state = 'done' AND i.state_changed_at >= $2))"#,
                    user.as_ref(),
                    done_since,
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Read::Review { closed } => {
                sqlx::query_as!(
                    IdeaRow,
                    r#"SELECT i.id AS "id!", i.kind AS "kind!", i.dedup_key AS "dedup_key!",
                              i.title AS "title!", i.summary AS "summary!",
                              i.importance AS "importance!", i.categories AS "categories!",
                              i.state AS "state!", i.state_reason,
                              i.created_at AS "created_at!", i.updated_at AS "updated_at!",
                              i.state_changed_at AS "state_changed_at!",
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM (
                           SELECT * FROM idea
                           WHERE user_id = $1 AND state IN ('proposed', 'accepted')
                           UNION ALL
                           (SELECT * FROM idea
                            WHERE user_id = $1 AND state NOT IN ('proposed', 'accepted')
                            ORDER BY state_changed_at DESC
                            LIMIT $2)
                       ) i
                       LEFT JOIN idea_prompt p ON p.idea_id = i.id
                       LEFT JOIN idea_entity e ON e.idea_id = i.id
                       LEFT JOIN idea_routine r ON r.idea_id = i.id"#,
                    user.as_ref(),
                    closed,
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Read::Id(id) => {
                sqlx::query_as!(
                    IdeaRow,
                    r#"SELECT i.id, i.kind, i.dedup_key, i.title, i.summary, i.importance,
                              i.categories, i.state, i.state_reason, i.created_at, i.updated_at,
                              i.state_changed_at,
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM idea i
                       LEFT JOIN idea_prompt p ON p.idea_id = i.id
                       LEFT JOIN idea_entity e ON e.idea_id = i.id
                       LEFT JOIN idea_routine r ON r.idea_id = i.id
                       WHERE i.id = $2 AND i.user_id = $1"#,
                    user.as_ref(),
                    id,
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Read::Key(dedup_key) => {
                sqlx::query_as!(
                    IdeaRow,
                    r#"SELECT i.id, i.kind, i.dedup_key, i.title, i.summary, i.importance,
                              i.categories, i.state, i.state_reason, i.created_at, i.updated_at,
                              i.state_changed_at,
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM idea i
                       LEFT JOIN idea_prompt p ON p.idea_id = i.id
                       LEFT JOIN idea_entity e ON e.idea_id = i.id
                       LEFT JOIN idea_routine r ON r.idea_id = i.id
                       WHERE i.user_id = $1 AND i.dedup_key = $2"#,
                    user.as_ref(),
                    dedup_key,
                )
                .fetch_all(&mut *tx)
                .await?
            }
        };
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let targets = sqlx::query!(
            r#"SELECT idea_id, role, entity_type, entity_id, part_id
               FROM idea_target
               WHERE idea_id = ANY($1)
               ORDER BY idea_id, role, position"#,
            &ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        type Decoded = Result<(TargetRole, Target), PgIdeaRepoError>;
        let mut by_idea: HashMap<Uuid, Vec<Decoded>> = HashMap::new();
        for row in targets {
            let target = parse::<TargetRole>(&row.role).and_then(|role| {
                Ok((
                    role,
                    Target {
                        entity_type: parse::<EntityType>(&row.entity_type)?,
                        entity_id: row.entity_id,
                        part_id: row.part_id,
                    },
                ))
            });
            by_idea.entry(row.idea_id).or_default().push(target);
        }
        let ideas = rows.into_iter().filter_map(|row| {
            let id = row.id;
            let idea = (|| -> Result<Idea, PgIdeaRepoError> {
                let targets = by_idea
                    .remove(&row.id)
                    .unwrap_or_default()
                    .into_iter()
                    .collect::<Result<Vec<_>, _>>()?;
                let of = |wanted: TargetRole| -> Vec<Target> {
                    targets
                        .iter()
                        .filter(|(role, _)| *role == wanted)
                        .map(|(_, target)| target.clone())
                        .collect()
                };
                let kind = match (
                    row.kind.as_str(),
                    row.prompt,
                    row.run_mode,
                    row.action,
                    row.routine_suggestion_id,
                ) {
                    ("prompt", Some(prompt), Some(run_mode), None, None) => IdeaKind::Prompt {
                        prompt,
                        run_mode: parse(&run_mode)?,
                    },
                    ("entity", None, None, Some(action), None) => IdeaKind::Entity {
                        action: parse(&action)?,
                        draft: of(TargetRole::Draft).into_iter().next(),
                    },
                    ("routine", None, None, None, Some(routine_suggestion_id)) => {
                        IdeaKind::Routine {
                            routine_suggestion_id,
                        }
                    }
                    (kind, ..) => {
                        return Err(PgIdeaRepoError::Decode(format!(
                            "idea {} of kind {kind} lacks its kind's row",
                            row.id
                        )));
                    }
                };
                Ok(Idea {
                    id: row.id,
                    dedup_key: row.dedup_key,
                    title: row.title,
                    summary: row.summary,
                    importance: u8::try_from(row.importance)
                        .map_err(|_| PgIdeaRepoError::Decode("importance".to_owned()))?,
                    categories: row
                        .categories
                        .iter()
                        .map(|category| parse::<Category>(category))
                        .collect::<Result<_, _>>()?,
                    state: parse(&row.state)?,
                    state_reason: row.state_reason,
                    about: of(TargetRole::About),
                    produced: of(TargetRole::Produced),
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    state_changed_at: row.state_changed_at,
                    kind,
                })
            })();
            // One broken row must not hide the person's other ideas.
            idea.inspect_err(|error| {
                tracing::warn!(idea_id = %id, error = %error, "skipped an undecodable idea row");
            })
            .ok()
        });
        Ok(ideas.collect())
    }
}

fn parse<T: std::str::FromStr>(value: &str) -> Result<T, PgIdeaRepoError> {
    value
        .parse()
        .map_err(|_| PgIdeaRepoError::Decode(format!("unknown value `{value}`")))
}

fn category_names(categories: &[Category]) -> Vec<String> {
    categories
        .iter()
        .map(|category| category.as_ref().to_owned())
        .collect()
}

/// Whether one more open idea stays within `limits`, under the person's
/// lock, which this takes.
async fn locked_room(
    conn: &mut PgConnection,
    user: &MacroUserIdStr<'_>,
    generation: Uuid,
    limits: Limits,
) -> Result<Written, sqlx::Error> {
    ideas_db_utils::lock_user(conn, user.as_ref()).await?;
    Ok(
        match ideas_db_utils::room(
            conn,
            user.as_ref(),
            generation,
            limits.open,
            limits.new_per_generation,
        )
        .await?
        {
            ideas_db_utils::Room::Fits => Written::Applied,
            ideas_db_utils::Room::OpenFull => Written::OverOpenLimit,
            ideas_db_utils::Room::GenerationFull => Written::OverNewLimit,
        },
    )
}

async fn insert_targets(
    conn: &mut PgConnection,
    idea: Uuid,
    role: TargetRole,
    targets: &[Target],
) -> Result<(), sqlx::Error> {
    for (position, target) in targets.iter().enumerate() {
        sqlx::query!(
            r#"INSERT INTO idea_target (idea_id, role, position, entity_type, entity_id, part_id)
               VALUES ($1, $2, $3, $4, $5, $6)"#,
            idea,
            role.as_ref(),
            i16::try_from(position).unwrap_or(i16::MAX),
            target.entity_type.as_ref(),
            target.entity_id,
            target.part_id,
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn log(
    conn: &mut PgConnection,
    user: &MacroUserIdStr<'_>,
    idea: Uuid,
    change: &Change,
) -> Result<(), sqlx::Error> {
    ideas_db_utils::log_change(
        conn,
        user.as_ref(),
        idea,
        &ideas_db_utils::IdeaChange {
            generation: change.generation,
            session: change.session,
            action: change.action.as_ref(),
            old: change.old.clone(),
            new: change.new.clone(),
            reason: change.reason.as_deref(),
            at: change.at,
        },
    )
    .await
}

impl IdeaRepo for PgIdeaRepo {
    type Err = PgIdeaRepoError;

    async fn kept_by(&self, generation: Uuid, session: Uuid) -> Result<u32, Self::Err> {
        // By generation first: its index bounds the scan to one generation.
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM suggestion_change
               WHERE generation_id = $1 AND session_id = $2 AND subject = 'idea'"#,
            generation,
            session,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    async fn shown(
        &self,
        user: &MacroUserIdStr<'_>,
        done_since: DateTime<Utc>,
    ) -> Result<Vec<Idea>, Self::Err> {
        self.load(user, Read::Shown { done_since }).await
    }

    async fn for_review(
        &self,
        user: &MacroUserIdStr<'_>,
        closed: u32,
    ) -> Result<Vec<Idea>, Self::Err> {
        self.load(
            user,
            Read::Review {
                closed: i64::from(closed),
            },
        )
        .await
    }

    async fn idea(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> Result<Option<Idea>, Self::Err> {
        Ok(self.load(user, Read::Id(id)).await?.into_iter().next())
    }

    async fn by_dedup_key(
        &self,
        user: &MacroUserIdStr<'_>,
        dedup_key: &str,
    ) -> Result<Option<Idea>, Self::Err> {
        Ok(self
            .load(user, Read::Key(dedup_key))
            .await?
            .into_iter()
            .next())
    }

    async fn added_in(&self, generation: Uuid) -> Result<u32, Self::Err> {
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM suggestion_change
               WHERE generation_id = $1 AND subject = 'idea'
                 AND action IN ('created', 'restored')"#,
            generation,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    async fn create(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        kind: &NewKind,
        content: &IdeaContent,
        limits: Limits,
        change: &Change,
    ) -> Result<Written, Self::Err> {
        let mut tx = self.pool.begin().await?;
        let room = locked_room(&mut tx, user, change.generation, limits).await?;
        if room != Written::Applied {
            return Ok(room);
        }
        let kind_name = match kind {
            NewKind::Prompt { .. } => "prompt",
            NewKind::Entity { .. } => "entity",
        };
        let inserted = sqlx::query!(
            r#"INSERT INTO idea
                 (id, user_id, kind, dedup_key, title, summary, importance, categories,
                  session_id, created_at, updated_at, state_changed_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)
               ON CONFLICT (user_id, dedup_key) DO NOTHING"#,
            id,
            user.as_ref(),
            kind_name,
            content.dedup_key,
            content.title,
            content.summary,
            i16::from(content.importance),
            &category_names(&content.categories),
            change.session,
            change.at,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if inserted == 0 {
            return Ok(Written::Conflict);
        }
        match kind {
            NewKind::Prompt { run_mode } => {
                sqlx::query!(
                    "INSERT INTO idea_prompt (idea_id, prompt, run_mode) VALUES ($1, $2, $3)",
                    id,
                    content.prompt.as_deref().unwrap_or_default(),
                    run_mode.as_ref(),
                )
                .execute(&mut *tx)
                .await?;
            }
            NewKind::Entity { action } => {
                sqlx::query!(
                    "INSERT INTO idea_entity (idea_id, action) VALUES ($1, $2)",
                    id,
                    action.as_ref(),
                )
                .execute(&mut *tx)
                .await?;
            }
        }
        insert_targets(&mut tx, id, TargetRole::About, &content.about).await?;
        log(&mut tx, user, id, change).await?;
        tx.commit().await?;
        Ok(Written::Applied)
    }

    async fn replace(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        content: &IdeaContent,
        from: IdeaState,
        to: IdeaState,
        limits: Limits,
        change: &Change,
    ) -> Result<Written, Self::Err> {
        let mut tx = self.pool.begin().await?;
        if !from.is_open() && to.is_open() {
            let room = locked_room(&mut tx, user, change.generation, limits).await?;
            if room != Written::Applied {
                return Ok(room);
            }
        } else {
            ideas_db_utils::lock_user(&mut tx, user.as_ref()).await?;
        }
        let updated = sqlx::query!(
            r#"UPDATE idea
               SET title = $4, summary = $5, importance = $6, categories = $7,
                   state = $8, state_reason = NULL, session_id = $9, updated_at = $10,
                   state_changed_at = CASE WHEN state = $8 THEN state_changed_at ELSE $10 END
               WHERE user_id = $1 AND id = $2 AND state = $3"#,
            user.as_ref(),
            id,
            from.as_ref(),
            content.title,
            content.summary,
            i16::from(content.importance),
            &category_names(&content.categories),
            to.as_ref(),
            change.session,
            change.at,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if updated == 0 {
            return Ok(Written::Conflict);
        }
        if let Some(prompt) = &content.prompt {
            sqlx::query!(
                "UPDATE idea_prompt SET prompt = $2 WHERE idea_id = $1",
                id,
                prompt,
            )
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query!(
            "DELETE FROM idea_target WHERE idea_id = $1 AND role = 'about'",
            id,
        )
        .execute(&mut *tx)
        .await?;
        insert_targets(&mut tx, id, TargetRole::About, &content.about).await?;
        log(&mut tx, user, id, change).await?;
        tx.commit().await?;
        Ok(Written::Applied)
    }

    async fn set_state(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[IdeaState],
        to: IdeaState,
        change: Option<&Change>,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let from: Vec<String> = from.iter().map(|state| state.as_ref().to_owned()).collect();
        let mut tx = self.pool.begin().await?;
        let moved = sqlx::query!(
            r#"UPDATE idea
               SET state = $4, state_reason = NULL, updated_at = $5, state_changed_at = $5,
                   session_id = COALESCE($6, session_id)
               WHERE user_id = $1 AND id = $2 AND state = ANY($3)"#,
            user.as_ref(),
            id,
            &from,
            to.as_ref(),
            now,
            change.map(|change| change.session),
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if moved && let Some(change) = change {
            log(&mut tx, user, id, change).await?;
        }
        tx.commit().await?;
        Ok(moved)
    }
}
