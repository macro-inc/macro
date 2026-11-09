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

/// [`IdeaRepo`] on MacroDB.
pub struct PgIdeaRepo {
    pool: PgPool,
}

impl PgIdeaRepo {
    /// Ideas in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The person's ideas: every one, or only `id`, or only `dedup_key`'s.
    async fn load(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Option<Uuid>,
        dedup_key: Option<&str>,
    ) -> Result<Vec<Idea>, PgIdeaRepoError> {
        let rows = sqlx::query!(
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
                 AND ($2::uuid IS NULL OR i.id = $2)
                 AND ($3::text IS NULL OR i.dedup_key = $3)"#,
            user.as_ref(),
            id,
            dedup_key,
        )
        .fetch_all(&self.pool)
        .await?;
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let targets = sqlx::query!(
            r#"SELECT idea_id, role, entity_type, entity_id, part_id
               FROM idea_target
               WHERE idea_id = ANY($1)
               ORDER BY idea_id, role, position"#,
            &ids,
        )
        .fetch_all(&self.pool)
        .await?;
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

/// Serialize writes to one person's ideas for the rest of the transaction,
/// so limits hold under concurrent writes.
async fn lock(conn: &mut PgConnection, user: &MacroUserIdStr<'_>) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('idea:' || $1, 0))",
        user.as_ref(),
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// Whether one more open idea stays within `limits`.
async fn within(
    conn: &mut PgConnection,
    user: &MacroUserIdStr<'_>,
    generation: Uuid,
    limits: Limits,
) -> Result<Written, sqlx::Error> {
    let counts = sqlx::query!(
        r#"SELECT
             (SELECT count(*) FROM idea
              WHERE user_id = $1 AND state IN ('proposed', 'accepted')) AS "open!",
             (SELECT count(*) FROM suggestion_change
              WHERE generation_id = $2 AND subject = 'idea'
                AND action IN ('created', 'restored')) AS "added!""#,
        user.as_ref(),
        generation,
    )
    .fetch_one(conn)
    .await?;
    if counts.open >= i64::from(limits.open) {
        return Ok(Written::OverOpenLimit);
    }
    if counts.added >= i64::from(limits.new_per_generation) {
        return Ok(Written::OverNewLimit);
    }
    Ok(Written::Applied)
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
    sqlx::query!(
        r#"INSERT INTO suggestion_change
             (id, user_id, generation_id, session_id, subject, subject_id, action,
              old_value, new_value, reason, created_at)
           VALUES ($1, $2, $3, $4, 'idea', $5, $6, $7, $8, $9, $10)"#,
        Uuid::now_v7(),
        user.as_ref(),
        change.generation,
        change.session,
        idea,
        change.action.as_ref(),
        change.old,
        change.new,
        change.reason,
        change.at,
    )
    .execute(conn)
    .await?;
    Ok(())
}

impl IdeaRepo for PgIdeaRepo {
    type Err = PgIdeaRepoError;

    async fn kept_by(&self, session: Uuid) -> Result<u32, Self::Err> {
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM suggestion_change
               WHERE session_id = $1 AND subject = 'idea'"#,
            session,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    async fn ideas(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<Idea>, Self::Err> {
        self.load(user, None, None).await
    }

    async fn idea(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> Result<Option<Idea>, Self::Err> {
        Ok(self.load(user, Some(id), None).await?.into_iter().next())
    }

    async fn by_dedup_key(
        &self,
        user: &MacroUserIdStr<'_>,
        dedup_key: &str,
    ) -> Result<Option<Idea>, Self::Err> {
        Ok(self
            .load(user, None, Some(dedup_key))
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
        lock(&mut tx, user).await?;
        let within = within(&mut tx, user, change.generation, limits).await?;
        if within != Written::Applied {
            return Ok(within);
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
        lock(&mut tx, user).await?;
        if !from.is_open() && to.is_open() {
            let within = within(&mut tx, user, change.generation, limits).await?;
            if within != Written::Applied {
                return Ok(within);
            }
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
