//! PostgreSQL implementation of the [`GamesRepo`] port.

#[cfg(test)]
mod test;

use std::str::FromStr;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::models::{
    BestScore, GameKind, GameScoring, LeaderboardScope, NewRoundResult, RoundWrite, WinTally,
};
use crate::domain::ports::GamesRepo;

/// Postgres-backed games repository.
#[derive(Debug, Clone)]
pub struct PgGamesRepo {
    pool: PgPool,
}

impl PgGamesRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres games repository.
#[derive(Debug, thiserror::Error)]
pub enum GamesRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored value could not be decoded into its domain type.
    #[error("invalid stored value: {0}")]
    Decode(String),
}

/// Postgres foreign-key-violation SQLSTATE.
const FOREIGN_KEY_VIOLATION: &str = "23503";

fn is_foreign_key_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db| db.code())
        .is_some_and(|code| code == FOREIGN_KEY_VIOLATION)
}

fn user_id(raw: String) -> Result<MacroUserIdStr<'static>, GamesRepoErr> {
    MacroUserIdStr::try_from(raw).map_err(|error| GamesRepoErr::Decode(error.to_string()))
}

/// Rows of games this build does not know yet (added by a newer migration)
/// are skipped rather than failing the whole leaderboard.
fn known_kind(raw: &str) -> Option<GameKind> {
    GameKind::from_str(raw)
        .inspect_err(|_| tracing::warn!(game_kind = raw, "skipping unknown game kind"))
        .ok()
}

struct BestScoreRow {
    user_id: String,
    game_kind: String,
    score: i64,
    achieved_at: DateTime<Utc>,
}

fn best_scores_from_rows(rows: Vec<BestScoreRow>) -> Result<Vec<BestScore>, GamesRepoErr> {
    rows.into_iter()
        .filter_map(|row| known_kind(&row.game_kind).map(|kind| (kind, row)))
        .map(|(kind, row)| {
            Ok(BestScore {
                user_id: user_id(row.user_id)?,
                kind,
                score: row.score,
                achieved_at: row.achieved_at,
            })
        })
        .collect()
}

struct WinTallyRow {
    user_id: String,
    game_kind: String,
    wins: i64,
    last_won_at: DateTime<Utc>,
}

fn win_tallies_from_rows(rows: Vec<WinTallyRow>) -> Result<Vec<WinTally>, GamesRepoErr> {
    rows.into_iter()
        .filter_map(|row| known_kind(&row.game_kind).map(|kind| (kind, row)))
        .map(|(kind, row)| {
            Ok(WinTally {
                user_id: user_id(row.user_id)?,
                kind,
                wins: row.wins,
                last_won_at: row.last_won_at,
            })
        })
        .collect()
}

struct StoredBest {
    score: i64,
    achieved_at: DateTime<Utc>,
}

impl GamesRepo for PgGamesRepo {
    type Err = GamesRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn best_scores(&self, scope: &LeaderboardScope) -> Result<Vec<BestScore>, Self::Err> {
        let rows = match scope {
            // Current members only: a player who leaves takes their scores along.
            LeaderboardScope::Team(team_id) => {
                sqlx::query_as!(
                    BestScoreRow,
                    r#"
                    SELECT
                        s.user_id,
                        s.game_kind::text AS "game_kind!",
                        s.score,
                        s.achieved_at
                    FROM game_best_score s
                    JOIN team_user tu ON tu.user_id = s.user_id
                    WHERE tu.team_id = $1
                    "#,
                    team_id,
                )
                .fetch_all(&self.pool)
                .await?
            }
            LeaderboardScope::User(user) => {
                sqlx::query_as!(
                    BestScoreRow,
                    r#"
                    SELECT
                        user_id,
                        game_kind::text AS "game_kind!",
                        score,
                        achieved_at
                    FROM game_best_score
                    WHERE user_id = $1
                    "#,
                    user.as_ref(),
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        best_scores_from_rows(rows)
    }

    #[tracing::instrument(err, skip(self))]
    async fn win_tallies(&self, scope: &LeaderboardScope) -> Result<Vec<WinTally>, Self::Err> {
        let rows = match scope {
            LeaderboardScope::Team(team_id) => {
                sqlx::query_as!(
                    WinTallyRow,
                    r#"
                    SELECT
                        r.winner_user_id AS "user_id!",
                        r.game_kind::text AS "game_kind!",
                        COUNT(*) AS "wins!",
                        MAX(r.finished_at) AS "last_won_at!"
                    FROM game_round_result r
                    JOIN team_user tu ON tu.user_id = r.winner_user_id
                    WHERE tu.team_id = $1
                    GROUP BY r.winner_user_id, r.game_kind
                    "#,
                    team_id,
                )
                .fetch_all(&self.pool)
                .await?
            }
            LeaderboardScope::User(user) => {
                sqlx::query_as!(
                    WinTallyRow,
                    r#"
                    SELECT
                        winner_user_id AS "user_id!",
                        game_kind::text AS "game_kind!",
                        COUNT(*) AS "wins!",
                        MAX(finished_at) AS "last_won_at!"
                    FROM game_round_result
                    WHERE winner_user_id = $1
                    GROUP BY winner_user_id, game_kind
                    "#,
                    user.as_ref(),
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        win_tallies_from_rows(rows)
    }

    #[tracing::instrument(err, skip(self))]
    async fn record_best_score(
        &self,
        user_id: &MacroUserIdStr<'_>,
        kind: GameKind,
        score: i64,
    ) -> Result<(BestScore, bool), Self::Err> {
        let kind_name = kind.to_string();
        // The comparison lives in the upsert itself so concurrent runs can
        // never overwrite a better score.
        let improved = match kind.scoring() {
            GameScoring::LowScore => {
                sqlx::query_as!(
                    StoredBest,
                    r#"
                    INSERT INTO game_best_score (user_id, game_kind, score)
                    VALUES ($1, $2::text::game_kind, $3)
                    ON CONFLICT (user_id, game_kind) DO UPDATE
                    SET score = EXCLUDED.score, achieved_at = now()
                    WHERE game_best_score.score > EXCLUDED.score
                    RETURNING score, achieved_at
                    "#,
                    user_id.as_ref(),
                    kind_name,
                    score,
                )
                .fetch_optional(&self.pool)
                .await?
            }
            GameScoring::HighScore | GameScoring::Wins => {
                sqlx::query_as!(
                    StoredBest,
                    r#"
                    INSERT INTO game_best_score (user_id, game_kind, score)
                    VALUES ($1, $2::text::game_kind, $3)
                    ON CONFLICT (user_id, game_kind) DO UPDATE
                    SET score = EXCLUDED.score, achieved_at = now()
                    WHERE game_best_score.score < EXCLUDED.score
                    RETURNING score, achieved_at
                    "#,
                    user_id.as_ref(),
                    kind_name,
                    score,
                )
                .fetch_optional(&self.pool)
                .await?
            }
        };
        let (stored, changed) = match improved {
            Some(stored) => (stored, true),
            None => (
                sqlx::query_as!(
                    StoredBest,
                    r#"
                    SELECT score, achieved_at
                    FROM game_best_score
                    WHERE user_id = $1 AND game_kind = $2::text::game_kind
                    "#,
                    user_id.as_ref(),
                    kind_name,
                )
                .fetch_one(&self.pool)
                .await?,
                false,
            ),
        };
        Ok((
            BestScore {
                user_id: MacroUserIdStr::try_from(user_id.to_string())
                    .map_err(|error| GamesRepoErr::Decode(error.to_string()))?,
                kind,
                score: stored.score,
                achieved_at: stored.achieved_at,
            },
            changed,
        ))
    }

    #[tracing::instrument(err, skip(self))]
    async fn record_round(&self, round: &NewRoundResult) -> Result<RoundWrite, Self::Err> {
        let kind = round.kind.to_string();
        let winner = round.winner.as_ref().map(|winner| winner.as_ref());
        // A player reports each round once; reporting again changes nothing.
        let reported = sqlx::query!(
            r#"
            INSERT INTO game_round_report
                (document_id, round, reporter_user_id, game_kind, winner_user_id)
            VALUES ($1, $2, $3, $4::text::game_kind, $5)
            ON CONFLICT (document_id, round, reporter_user_id) DO NOTHING
            "#,
            round.document_id,
            round.round,
            round.reporter.as_ref(),
            kind,
            winner,
        )
        .execute(&self.pool)
        .await;
        match reported {
            Ok(_) => {}
            Err(error) if is_foreign_key_violation(&error) => {
                return Ok(RoundWrite::UnknownReference);
            }
            Err(error) => return Err(error.into()),
        }

        // The round counts once two players' reports agree. Each statement
        // commits on its own, so whichever report lands second sees both.
        let counted = sqlx::query!(
            r#"
            INSERT INTO game_round_result (id, document_id, round, game_kind, winner_user_id)
            SELECT $1::uuid, $2::text, $3::int4, $4::text::game_kind, $5::text
            WHERE (
                SELECT COUNT(*)
                FROM game_round_report
                WHERE document_id = $2
                  AND round = $3
                  AND game_kind = $4::text::game_kind
                  AND winner_user_id IS NOT DISTINCT FROM $5
            ) >= 2
            ON CONFLICT (document_id, round) DO NOTHING
            "#,
            round.id,
            round.document_id,
            round.round,
            kind,
            winner,
        )
        .execute(&self.pool)
        .await?;
        if counted.rows_affected() == 1 {
            return Ok(RoundWrite::Recorded);
        }
        let settled = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM game_round_result WHERE document_id = $1 AND round = $2
            ) AS "settled!"
            "#,
            round.document_id,
            round.round,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(if settled {
            RoundWrite::AlreadyRecorded
        } else {
            RoundWrite::Pending
        })
    }
}
