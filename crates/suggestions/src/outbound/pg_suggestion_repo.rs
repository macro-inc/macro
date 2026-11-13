//! PostgreSQL store for suggestions: the base `suggestion` row, one child row per kind,
//! the items in `suggestion_target`, and every generation session's change in
//! `suggestion_change`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use sqlx::{PgConnection, PgPool};

use crate::domain::lifecycle::{self, LifecycleEvent};
use crate::domain::model::{
    Category, Change, EntityAction, NewKind, OpenTarget, ResolveReason, StoredRun, Suggestion,
    SuggestionContent, SuggestionKind, SuggestionRun, SuggestionState, SuggestionStatus, Target,
    TargetRole,
};
use crate::domain::ports::{Limits, SuggestionRepo, Written};
use crate::domain::run::{RunEvent, RunState};

#[cfg(test)]
pub(crate) mod test;

/// Why reading or writing suggestions failed.
#[derive(Debug, thiserror::Error)]
pub enum PgSuggestionRepoError {
    /// The database failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A stored row holds a value the domain doesn't know.
    #[error("undecodable suggestion row: {0}")]
    Decode(String),
}

/// Which of a person's suggestions a read loads.
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

/// A suggestion's base row with its kind's columns.
struct SuggestionRow {
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
    sends: Option<String>,
    action: Option<String>,
    routine_suggestion_id: Option<Uuid>,
}

/// [`SuggestionRepo`] on MacroDB.
pub struct PgSuggestionRepo {
    pool: PgPool,
}

impl PgSuggestionRepo {
    /// Suggestions in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The person's suggestions that `read` names, one query per kind of read so
    /// each plan uses its own index.
    async fn load(
        &self,
        user: &MacroUserIdStr<'_>,
        read: Read<'_>,
    ) -> Result<Vec<Suggestion>, PgSuggestionRepoError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        let rows = match read {
            Read::Shown { done_since } => {
                sqlx::query_as!(
                    SuggestionRow,
                    r#"SELECT i.id, i.kind, i.dedup_key, i.title, i.summary, i.importance,
                              i.categories, i.state, i.state_reason, i.created_at, i.updated_at,
                              i.state_changed_at,
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?", p.sends AS "sends?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM suggestion i
                       LEFT JOIN suggestion_prompt p ON p.suggestion_id = i.id
                       LEFT JOIN suggestion_entity e ON e.suggestion_id = i.id
                       LEFT JOIN suggestion_routine r ON r.suggestion_id = i.id
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
                    SuggestionRow,
                    r#"SELECT i.id AS "id!", i.kind AS "kind!", i.dedup_key AS "dedup_key!",
                              i.title AS "title!", i.summary AS "summary!",
                              i.importance AS "importance!", i.categories AS "categories!",
                              i.state AS "state!", i.state_reason,
                              i.created_at AS "created_at!", i.updated_at AS "updated_at!",
                              i.state_changed_at AS "state_changed_at!",
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?", p.sends AS "sends?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM (
                           SELECT * FROM suggestion
                           WHERE user_id = $1 AND state IN ('proposed', 'accepted')
                           UNION ALL
                           (SELECT * FROM suggestion
                            WHERE user_id = $1 AND state NOT IN ('proposed', 'accepted')
                            ORDER BY state_changed_at DESC
                            LIMIT $2)
                       ) i
                       LEFT JOIN suggestion_prompt p ON p.suggestion_id = i.id
                       LEFT JOIN suggestion_entity e ON e.suggestion_id = i.id
                       LEFT JOIN suggestion_routine r ON r.suggestion_id = i.id"#,
                    user.as_ref(),
                    closed,
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Read::Id(id) => {
                sqlx::query_as!(
                    SuggestionRow,
                    r#"SELECT i.id, i.kind, i.dedup_key, i.title, i.summary, i.importance,
                              i.categories, i.state, i.state_reason, i.created_at, i.updated_at,
                              i.state_changed_at,
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?", p.sends AS "sends?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM suggestion i
                       LEFT JOIN suggestion_prompt p ON p.suggestion_id = i.id
                       LEFT JOIN suggestion_entity e ON e.suggestion_id = i.id
                       LEFT JOIN suggestion_routine r ON r.suggestion_id = i.id
                       WHERE i.id = $2 AND i.user_id = $1"#,
                    user.as_ref(),
                    id,
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Read::Key(dedup_key) => {
                sqlx::query_as!(
                    SuggestionRow,
                    r#"SELECT i.id, i.kind, i.dedup_key, i.title, i.summary, i.importance,
                              i.categories, i.state, i.state_reason, i.created_at, i.updated_at,
                              i.state_changed_at,
                              p.prompt AS "prompt?", p.run_mode AS "run_mode?", p.sends AS "sends?",
                              e.action AS "action?",
                              r.routine_suggestion_id AS "routine_suggestion_id?"
                       FROM suggestion i
                       LEFT JOIN suggestion_prompt p ON p.suggestion_id = i.id
                       LEFT JOIN suggestion_entity e ON e.suggestion_id = i.id
                       LEFT JOIN suggestion_routine r ON r.suggestion_id = i.id
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
            r#"SELECT suggestion_id, role, entity_type, entity_id, part_id
               FROM suggestion_target
               WHERE suggestion_id = ANY($1)
               ORDER BY suggestion_id, role, position"#,
            &ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        // Each suggestion's latest run, by its index.
        let runs = sqlx::query!(
            r#"SELECT DISTINCT ON (suggestion_id) suggestion_id, session_id, started_at, state,
                      state_changed_at
               FROM suggestion_run
               WHERE suggestion_id = ANY($1)
               ORDER BY suggestion_id, started_at DESC"#,
            &ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        type Decoded = Result<(TargetRole, Target), PgSuggestionRepoError>;
        let mut by_suggestion: HashMap<Uuid, Vec<Decoded>> = HashMap::new();
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
            by_suggestion
                .entry(row.suggestion_id)
                .or_default()
                .push(target);
        }
        let mut latest_run: HashMap<Uuid, Result<SuggestionRun, PgSuggestionRepoError>> = runs
            .into_iter()
            .map(|row| {
                let run = parse(&row.state).map(|state| SuggestionRun {
                    session_id: row.session_id,
                    started_at: row.started_at,
                    state,
                    state_changed_at: row.state_changed_at,
                });
                (row.suggestion_id, run)
            })
            .collect();
        let suggestions = rows.into_iter().filter_map(|row| {
            let id = row.id;
            let suggestion = (|| -> Result<Suggestion, PgSuggestionRepoError> {
                let run = latest_run.remove(&row.id).transpose()?;
                let state = parse(&row.state)?;
                let targets = by_suggestion
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
                    ("prompt", Some(prompt), Some(run_mode), None, None) => SuggestionKind::Prompt {
                        prompt,
                        run_mode: parse(&run_mode)?,
                        sends: row.sends,
                    },
                    ("entity", None, None, Some(action), None) => SuggestionKind::Entity {
                        action: parse(&action)?,
                        draft: of(TargetRole::Draft).into_iter().next(),
                    },
                    ("routine", None, None, None, Some(routine_suggestion_id)) => {
                        SuggestionKind::Routine {
                            routine_suggestion_id,
                        }
                    }
                    (kind, ..) => {
                        return Err(PgSuggestionRepoError::Decode(format!(
                            "suggestion {} of kind {kind} lacks its kind's row",
                            row.id
                        )));
                    }
                };
                Ok(Suggestion {
                    id: row.id,
                    dedup_key: row.dedup_key,
                    title: row.title,
                    summary: row.summary,
                    importance: u8::try_from(row.importance)
                        .map_err(|_| PgSuggestionRepoError::Decode("importance".to_owned()))?,
                    categories: row
                        .categories
                        .iter()
                        .map(|category| parse::<Category>(category))
                        .collect::<Result<_, _>>()?,
                    state,
                    state_reason: row.state_reason,
                    about: of(TargetRole::About),
                    produced: of(TargetRole::Produced),
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    state_changed_at: row.state_changed_at,
                    status: SuggestionStatus::of(state, run.as_ref()),
                    run,
                    kind,
                })
            })();
            // One broken row must not hide the person's other suggestions.
            suggestion.inspect_err(|error| {
                tracing::warn!(suggestion_id = %id, error = %error, "skipped an undecodable suggestion row");
            })
            .ok()
        });
        Ok(suggestions.collect())
    }
}

/// An `suggestion_run` row as the run queries select it.
struct RunRow {
    session_id: Uuid,
    suggestion_id: Uuid,
    user_id: String,
    agent_id: String,
    action_id: Uuid,
    started_at: DateTime<Utc>,
    state: String,
    state_changed_at: DateTime<Utc>,
    sends: Option<String>,
}

fn run(row: RunRow) -> Result<StoredRun, PgSuggestionRepoError> {
    Ok(StoredRun {
        session: row.session_id,
        suggestion: row.suggestion_id,
        user: MacroUserIdStr::try_from(row.user_id)
            .map_err(|_| PgSuggestionRepoError::Decode("a run's user".to_owned()))?,
        agent: row
            .agent_id
            .parse()
            .map_err(|_| PgSuggestionRepoError::Decode("a run's agent".to_owned()))?,
        action: row.action_id,
        started_at: row.started_at,
        state: RunState::stored(parse(&row.state)?, row.state_changed_at),
        state_changed_at: row.state_changed_at,
        sends: row.sends,
    })
}

/// Move `run` to `to`, entered at `changed_at`, if it is still as read;
/// letting go of it when `release`. The run's suggestion when it moved.
async fn write_run(
    conn: &mut PgConnection,
    run: &StoredRun,
    to: RunState,
    changed_at: DateTime<Utc>,
    now: DateTime<Utc>,
    release: bool,
) -> Result<Option<Uuid>, sqlx::Error> {
    let (from, to_name) = (run.state.name(), to.name());
    sqlx::query_scalar!(
        r#"UPDATE suggestion_run
           SET state = $4, state_changed_at = $5, settled_at = $6,
               claimed_until = CASE WHEN $7 THEN NULL ELSE claimed_until END
           WHERE session_id = $1 AND state = $2 AND state_changed_at = $3
           RETURNING suggestion_id"#,
        run.session,
        from.as_ref(),
        run.state_changed_at,
        to_name.as_ref(),
        changed_at,
        to.is_settled().then_some(now),
        release,
    )
    .fetch_optional(&mut *conn)
    .await
}

/// Cancel suggestion `suggestion`'s unsettled run, if it has one, as the run's
/// state machine says: the suggestion closed under it.
async fn cancel_run(
    conn: &mut PgConnection,
    suggestion: Uuid,
    now: DateTime<Utc>,
) -> Result<(), PgSuggestionRepoError> {
    let row = sqlx::query_as!(
        RunRow,
        r#"SELECT session_id, suggestion_id, user_id, agent_id, action_id, started_at, state,
                  state_changed_at, sends
           FROM suggestion_run WHERE suggestion_id = $1 AND settled_at IS NULL
           FOR UPDATE"#,
        suggestion,
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(run) = row.map(run).transpose()? else {
        return Ok(());
    };
    // A cancel needs nothing done first; its stop follows from the state.
    let Ok(step) = run.state.on(RunEvent::Cancel, run.started_at, now) else {
        return Ok(());
    };
    if step.moves_from(run.state) {
        write_run(conn, &run, step.to, step.to.since_or(now), now, false).await?;
    }
    Ok(())
}

fn parse<T: std::str::FromStr>(value: &str) -> Result<T, PgSuggestionRepoError> {
    value
        .parse()
        .map_err(|_| PgSuggestionRepoError::Decode(format!("unknown value `{value}`")))
}

fn category_names(categories: &[Category]) -> Vec<String> {
    categories
        .iter()
        .map(|category| category.as_ref().to_owned())
        .collect()
}

/// `states` as stored.
fn state_names(states: &[SuggestionState]) -> Vec<String> {
    states
        .iter()
        .map(|state| state.as_ref().to_owned())
        .collect()
}

/// The states a suggestion is open in, as stored.
fn open_states() -> Vec<String> {
    state_names(&[SuggestionState::Proposed, SuggestionState::Accepted])
}

/// Whether one more open suggestion stays within `limits`, under the person's
/// lock, which this takes.
async fn locked_room(
    conn: &mut PgConnection,
    user: &MacroUserIdStr<'_>,
    generation: Uuid,
    limits: Limits,
) -> Result<Written, sqlx::Error> {
    suggestions_db_utils::lock_user(conn, user.as_ref()).await?;
    Ok(
        match suggestions_db_utils::room(
            conn,
            user.as_ref(),
            generation,
            limits.open,
            limits.new_per_generation,
        )
        .await?
        {
            suggestions_db_utils::Room::Fits => Written::Applied,
            suggestions_db_utils::Room::OpenFull => Written::OverOpenLimit,
            suggestions_db_utils::Room::GenerationFull => Written::OverNewLimit,
        },
    )
}

async fn insert_targets(
    conn: &mut PgConnection,
    suggestion: Uuid,
    role: TargetRole,
    targets: &[Target],
) -> Result<(), sqlx::Error> {
    for (position, target) in targets.iter().enumerate() {
        sqlx::query!(
            r#"INSERT INTO suggestion_target (suggestion_id, role, position, entity_type, entity_id, part_id)
               VALUES ($1, $2, $3, $4, $5, $6)"#,
            suggestion,
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
    suggestion: Uuid,
    change: &Change,
) -> Result<(), sqlx::Error> {
    suggestions_db_utils::log_change(
        conn,
        user.as_ref(),
        suggestion,
        &suggestions_db_utils::SuggestionChange {
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

impl SuggestionRepo for PgSuggestionRepo {
    type Err = PgSuggestionRepoError;

    async fn kept_by(&self, generation: Uuid, session: Uuid) -> Result<u32, Self::Err> {
        // By generation first: its index bounds the scan to one generation.
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM suggestion_change
               WHERE generation_id = $1 AND session_id = $2 AND subject = 'suggestion'"#,
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
    ) -> Result<Vec<Suggestion>, Self::Err> {
        self.load(user, Read::Shown { done_since }).await
    }

    async fn for_review(
        &self,
        user: &MacroUserIdStr<'_>,
        closed: u32,
    ) -> Result<Vec<Suggestion>, Self::Err> {
        self.load(
            user,
            Read::Review {
                closed: i64::from(closed),
            },
        )
        .await
    }

    async fn suggestion(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<Suggestion>, Self::Err> {
        Ok(self.load(user, Read::Id(id)).await?.into_iter().next())
    }

    async fn by_dedup_key(
        &self,
        user: &MacroUserIdStr<'_>,
        dedup_key: &str,
    ) -> Result<Option<Suggestion>, Self::Err> {
        Ok(self
            .load(user, Read::Key(dedup_key))
            .await?
            .into_iter()
            .next())
    }

    async fn added_in(&self, generation: Uuid) -> Result<u32, Self::Err> {
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM suggestion_change
               WHERE generation_id = $1 AND subject = 'suggestion'
                 AND action IN ('created', 'restored')"#,
            generation,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }

    async fn start_run(
        &self,
        run: &StoredRun,
        shown_updated_at: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await?;
        suggestions_db_utils::lock_user(&mut tx, run.user.as_ref()).await?;
        // In a state a run may start from, with no run going (a restored
        // suggestion's old run may still be), and still what the person saw.
        let accepted = sqlx::query!(
            r#"UPDATE suggestion SET state = $5, updated_at = $3,
                   state_changed_at = CASE WHEN state = $5 THEN state_changed_at ELSE $3 END
               WHERE id = $1 AND user_id = $2 AND updated_at = $4 AND state = ANY($6)
                 AND EXISTS (SELECT 1 FROM suggestion_prompt p WHERE p.suggestion_id = suggestion.id AND p.run_mode = 'background')
                 AND NOT EXISTS (
                     SELECT 1 FROM suggestion_run r WHERE r.suggestion_id = suggestion.id AND r.settled_at IS NULL)"#,
            run.suggestion,
            run.user.as_ref(),
            run.started_at,
            shown_updated_at,
            SuggestionState::Accepted.as_ref(),
            &state_names(&lifecycle::sources(LifecycleEvent::StartRun)),
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if !accepted {
            return Ok(false);
        }
        let state = run.state.name();
        sqlx::query!(
            r#"INSERT INTO suggestion_run
                 (session_id, suggestion_id, user_id, agent_id, action_id, started_at, state,
                  state_changed_at, sends)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
            run.session,
            run.suggestion,
            run.user.as_ref(),
            run.agent.to_string(),
            run.action,
            run.started_at,
            state.as_ref(),
            run.state_changed_at,
            run.sends.as_deref(),
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn run(&self, session: Uuid) -> Result<Option<StoredRun>, Self::Err> {
        let row = sqlx::query_as!(
            RunRow,
            r#"SELECT session_id, suggestion_id, user_id, agent_id, action_id, started_at, state,
                      state_changed_at, sends
               FROM suggestion_run WHERE session_id = $1"#,
            session,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(run).transpose()
    }

    async fn runs_to_check(
        &self,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<StoredRun>, Self::Err> {
        let rows = sqlx::query_as!(
            RunRow,
            r#"SELECT session_id, suggestion_id, user_id, agent_id, action_id, started_at, state,
                      state_changed_at, sends
               FROM suggestion_run
               WHERE settled_at IS NULL AND (claimed_until IS NULL OR claimed_until <= $1)
               ORDER BY checked_at NULLS FIRST, started_at LIMIT $2"#,
            now,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(run).collect()
    }

    async fn claim_run(
        &self,
        session: Uuid,
        now: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> Result<Option<StoredRun>, Self::Err> {
        let row = sqlx::query_as!(
            RunRow,
            r#"UPDATE suggestion_run SET claimed_until = $3, checked_at = $2
               WHERE session_id = $1 AND settled_at IS NULL
                 AND (claimed_until IS NULL OR claimed_until <= $2)
               RETURNING session_id, suggestion_id, user_id, agent_id, action_id, started_at, state,
                         state_changed_at, sends"#,
            session,
            now,
            until,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(run).transpose()
    }

    async fn release_run(&self, session: Uuid, until: DateTime<Utc>) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE suggestion_run SET claimed_until = NULL
               WHERE session_id = $1 AND claimed_until = $2"#,
            session,
            until,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn move_run(
        &self,
        run: &StoredRun,
        to: RunState,
        changed_at: DateTime<Utc>,
        produced: &[Target],
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await?;
        let Some(suggestion) = write_run(&mut tx, run, to, changed_at, now, true).await? else {
            return Ok(false);
        };
        if to == RunState::Finished {
            // Each item once, in the order given, after what the suggestion has
            // already.
            let (types, ids, parts): (Vec<String>, Vec<String>, Vec<Option<String>>) = produced
                .iter()
                .map(|target| {
                    (
                        target.entity_type.as_ref().to_owned(),
                        target.entity_id.clone(),
                        target.part_id.clone(),
                    )
                })
                .collect();
            sqlx::query!(
                r#"INSERT INTO suggestion_target (suggestion_id, role, position, entity_type, entity_id, part_id)
                   SELECT $1, $2, (base.next + row_number() OVER (ORDER BY item.ord) - 1)::smallint,
                          item.entity_type, item.entity_id, item.part_id
                   FROM (SELECT COALESCE(max(position) + 1, 0) AS next FROM suggestion_target
                         WHERE suggestion_id = $1 AND role = $2) base,
                        (SELECT DISTINCT ON (entity_type, entity_id, part_id) entity_type, entity_id, part_id, ord
                         FROM unnest($3::text[], $4::text[], $5::text[])
                           WITH ORDINALITY AS given(entity_type, entity_id, part_id, ord)
                         ORDER BY entity_type, entity_id, part_id, ord) item
                   WHERE NOT EXISTS (
                       SELECT 1 FROM suggestion_target t
                       WHERE t.suggestion_id = $1 AND t.role = $2
                         AND t.entity_type = item.entity_type AND t.entity_id = item.entity_id
                         AND t.part_id IS NOT DISTINCT FROM item.part_id)"#,
                suggestion,
                TargetRole::Produced.as_ref(),
                &types,
                &ids,
                &parts as &[Option<String>],
            )
            .execute(&mut *tx)
            .await?;
            // A run of a suggestion closed meanwhile still records what it made;
            // only one still accepted becomes done.
            sqlx::query!(
                r#"UPDATE suggestion SET state = $3, updated_at = $2, state_changed_at = $2
                   WHERE id = $1 AND state = ANY($4)"#,
                suggestion,
                now,
                SuggestionState::Done.as_ref(),
                &state_names(&lifecycle::sources(LifecycleEvent::RunFinished)),
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    async fn create(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        kind: &NewKind,
        content: &SuggestionContent,
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
            r#"INSERT INTO suggestion
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
                    "INSERT INTO suggestion_prompt (suggestion_id, prompt, run_mode, sends) VALUES ($1, $2, $3, $4)",
                    id,
                    content.prompt.as_deref().unwrap_or_default(),
                    run_mode.as_ref(),
                    content.sends.as_deref(),
                )
                .execute(&mut *tx)
                .await?;
            }
            NewKind::Entity { action } => {
                sqlx::query!(
                    "INSERT INTO suggestion_entity (suggestion_id, action) VALUES ($1, $2)",
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
        content: &SuggestionContent,
        from: SuggestionState,
        to: SuggestionState,
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
            suggestions_db_utils::lock_user(&mut tx, user.as_ref()).await?;
        }
        // Under the person's lock, which starting a run takes too: what a run
        // was started with stays until it settles.
        if let Some(prompt) = &content.prompt {
            let run_going = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                       SELECT 1 FROM suggestion_prompt p
                       JOIN suggestion_run r ON r.suggestion_id = p.suggestion_id AND r.settled_at IS NULL
                       WHERE p.suggestion_id = $1
                         AND (p.prompt IS DISTINCT FROM $2 OR p.sends IS DISTINCT FROM $3)
                   ) AS "run_going!""#,
                id,
                prompt,
                content.sends.as_deref(),
            )
            .fetch_one(&mut *tx)
            .await?;
            if run_going {
                return Ok(Written::RunGoing);
            }
        }
        let updated = sqlx::query!(
            r#"UPDATE suggestion
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
                "UPDATE suggestion_prompt SET prompt = $2, sends = $3 WHERE suggestion_id = $1",
                id,
                prompt,
                content.sends.as_deref(),
            )
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query!(
            "DELETE FROM suggestion_target WHERE suggestion_id = $1 AND role = 'about'",
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
        from: &[SuggestionState],
        to: SuggestionState,
        change: Option<&Change>,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let from: Vec<String> = from.iter().map(|state| state.as_ref().to_owned()).collect();
        let mut tx = self.pool.begin().await?;
        let moved = sqlx::query!(
            r#"UPDATE suggestion
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
        if moved && lifecycle::cancels_run(to) {
            cancel_run(&mut tx, id, now).await?;
        }
        tx.commit().await?;
        Ok(moved)
    }

    async fn set_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        draft: &Target,
        change: &Change,
    ) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await?;
        let open = sqlx::query!(
            r#"UPDATE suggestion SET session_id = $4, updated_at = $5
               WHERE user_id = $1 AND id = $2 AND state = ANY($3)"#,
            user.as_ref(),
            id,
            &state_names(&lifecycle::sources(LifecycleEvent::AttachDraft)),
            change.session,
            change.at,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if !open {
            return Ok(false);
        }
        sqlx::query!(
            "DELETE FROM suggestion_target WHERE suggestion_id = $1 AND role = $2",
            id,
            TargetRole::Draft.as_ref(),
        )
        .execute(&mut *tx)
        .await?;
        insert_targets(&mut tx, id, TargetRole::Draft, std::slice::from_ref(draft)).await?;
        log(&mut tx, user, id, change).await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn set_state_as_shown(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[SuggestionState],
        to: SuggestionState,
        shown_updated_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let from: Vec<String> = from.iter().map(|state| state.as_ref().to_owned()).collect();
        let moved = sqlx::query!(
            r#"UPDATE suggestion
               SET state = $4, state_reason = NULL, updated_at = $5, state_changed_at = $5
               WHERE user_id = $1 AND id = $2 AND state = ANY($3) AND updated_at = $6"#,
            user.as_ref(),
            id,
            &from,
            to.as_ref(),
            now,
            shown_updated_at,
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1;
        Ok(moved)
    }

    async fn open_about(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> Result<Vec<OpenTarget>, Self::Err> {
        // Every event of every person asks this: bounded, and the item's
        // targets found by their index first whatever the statistics say
        // (`OFFSET 0` keeps the planner from flattening the subquery).
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        let rows = sqlx::query!(
            r#"SELECT i.id, i.user_id, i.created_at, t.part_id, e.action AS "action?"
               FROM (SELECT suggestion_id, part_id, position FROM suggestion_target
                     WHERE entity_type = $1 AND entity_id = $2 AND role = $3
                     OFFSET 0) t
               JOIN suggestion i ON i.id = t.suggestion_id
               LEFT JOIN suggestion_entity e ON e.suggestion_id = i.id
               WHERE i.state = ANY($4)
               ORDER BY i.id, t.position"#,
            entity_type.as_ref(),
            entity_id,
            TargetRole::About.as_ref(),
            &open_states(),
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        let targets = rows.into_iter().filter_map(|row| {
            let id = row.id;
            let target = (|| -> Result<OpenTarget, PgSuggestionRepoError> {
                let action = row
                    .action
                    .as_deref()
                    .map(parse::<EntityAction>)
                    .transpose()?;
                Ok(OpenTarget {
                    suggestion: row.id,
                    user: MacroUserIdStr::try_from(row.user_id)
                        .map_err(|_| PgSuggestionRepoError::Decode("a suggestion's user".to_owned()))?,
                    created_at: row.created_at,
                    reply: action == Some(EntityAction::Reply),
                    part_id: row.part_id,
                })
            })();
            // One broken row must not keep the item's other suggestions open.
            target
                .inspect_err(|error| {
                    tracing::warn!(suggestion_id = %id, error = %error, "skipped an undecodable suggestion row");
                })
                .ok()
        });
        Ok(targets.collect())
    }

    async fn resolve(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        reason: ResolveReason,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await?;
        let moved = sqlx::query!(
            r#"UPDATE suggestion
               SET state = $4, state_reason = $5, updated_at = $6, state_changed_at = $6
               WHERE user_id = $1 AND id = $2 AND state = ANY($3)"#,
            user.as_ref(),
            id,
            &state_names(&lifecycle::sources(LifecycleEvent::Resolve)),
            SuggestionState::Resolved.as_ref(),
            reason.as_ref(),
            now,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if moved {
            cancel_run(&mut tx, id, now).await?;
        }
        tx.commit().await?;
        Ok(moved)
    }
}

#[async_trait::async_trait]
impl crate::domain::ports::RunScopes for PgSuggestionRepo {
    async fn sends_nothing(&self, session: Uuid) -> Result<bool, rootcause::Report> {
        let sends = sqlx::query_scalar!(
            r#"SELECT sends FROM suggestion_run WHERE session_id = $1"#,
            session,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        Ok(
            matches!(sends, Some(sends) if sends.as_deref().is_none_or(|sends| sends.trim().is_empty())),
        )
    }
}
