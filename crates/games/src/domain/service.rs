//! Games service implementation.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Utc};
use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::EditAccessLevel;
use strum::IntoEnumIterator;
use uuid::Uuid;

use crate::domain::models::{
    BestScore, GameKind, GameLeaderboard, GameLeaderboards, GameScoring, GamesError, GamesReceipt,
    LEADERBOARD_SIZE, LeaderboardEntry, MAX_PLAYERS, MAX_ROUND, NewRoundResult, RoundRecorded,
    RoundReport, RoundWrite, ScoreSubmission, WinTally,
};
use crate::domain::ports::{GamesRepo, GamesService};

/// Concrete games service backed by a [`GamesRepo`].
#[derive(Debug, Clone)]
pub struct GamesServiceImpl<R> {
    repo: R,
}

impl<R> GamesServiceImpl<R>
where
    R: GamesRepo,
    anyhow::Error: From<R::Err>,
{
    /// Create a service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

/// A result to rank: the player, their value, and when they reached it.
struct Standing {
    user_id: MacroUserIdStr<'static>,
    value: i64,
    at: DateTime<Utc>,
}

/// Rank standings best first; on a tie, whoever got there first leads.
fn rank(
    kind: GameKind,
    mut standings: Vec<Standing>,
    viewer: &MacroUserIdStr<'static>,
) -> GameLeaderboard {
    standings.sort_by(|a, b| {
        let by_value = match kind.scoring() {
            GameScoring::LowScore => a.value.cmp(&b.value),
            GameScoring::HighScore | GameScoring::Wins => b.value.cmp(&a.value),
        };
        by_value.then(a.at.cmp(&b.at))
    });
    let ranked: Vec<LeaderboardEntry> = standings
        .into_iter()
        .zip(1u32..)
        .map(|(standing, rank)| LeaderboardEntry {
            user_id: standing.user_id,
            rank,
            value: standing.value,
            at: standing.at,
        })
        .collect();
    let viewer_entry = ranked
        .iter()
        .find(|entry| &entry.user_id == viewer)
        .cloned();
    GameLeaderboard {
        kind,
        scoring: kind.scoring(),
        entries: ranked.into_iter().take(LEADERBOARD_SIZE).collect(),
        viewer: viewer_entry,
    }
}

fn build_leaderboards(
    receipt: &GamesReceipt,
    best_scores: Vec<BestScore>,
    win_tallies: Vec<WinTally>,
) -> GameLeaderboards {
    let mut standings: BTreeMap<GameKind, Vec<Standing>> = BTreeMap::new();
    for best in best_scores {
        // A game's ranking can change between releases; ignore stale rows.
        if best.kind.scoring() == GameScoring::Wins {
            continue;
        }
        standings.entry(best.kind).or_default().push(Standing {
            user_id: best.user_id,
            value: best.score,
            at: best.achieved_at,
        });
    }
    for tally in win_tallies {
        if tally.kind.scoring() != GameScoring::Wins {
            continue;
        }
        standings.entry(tally.kind).or_default().push(Standing {
            user_id: tally.user_id,
            value: tally.wins,
            at: tally.last_won_at,
        });
    }
    GameLeaderboards {
        team_id: receipt.scope().team_id(),
        games: GameKind::iter()
            .map(|kind| {
                rank(
                    kind,
                    standings.remove(&kind).unwrap_or_default(),
                    receipt.user_id(),
                )
            })
            .collect(),
    }
}

/// Check a run against its game's ranking and plausible bounds.
fn validate_score(kind: GameKind, score: i64) -> Result<(), GamesError> {
    let Some(range) = kind.score_range() else {
        return Err(GamesError::BadRequest(format!(
            "{kind} is ranked by wins; report rounds instead of scores"
        )));
    };
    if !range.contains(&score) {
        return Err(GamesError::BadRequest(format!(
            "{kind} scores must be between {} and {}",
            range.start(),
            range.end()
        )));
    }
    Ok(())
}

/// Validate a reported round against the receipt that authorized it.
fn validate_round(
    receipt: &EntityAccessReceipt<EditAccessLevel>,
    report: RoundReport,
) -> Result<NewRoundResult, GamesError> {
    if receipt.entity().entity_type != EntityType::Document {
        return Err(GamesError::BadRequest(
            "rounds are reported for game rooms".to_string(),
        ));
    }
    let reporter = receipt
        .get_authenticated_user()
        .map_err(|_| GamesError::Unauthorized)?;
    if report.kind.scoring() != GameScoring::Wins {
        return Err(GamesError::BadRequest(format!(
            "{} is ranked by score; submit scores instead of rounds",
            report.kind
        )));
    }
    if !(0..=MAX_ROUND).contains(&report.round) {
        return Err(GamesError::BadRequest(format!(
            "round must be between 0 and {MAX_ROUND}"
        )));
    }
    let players: HashSet<&MacroUserIdStr<'static>> = report.players.iter().collect();
    if players.len() != report.players.len() {
        return Err(GamesError::BadRequest(
            "each player may be listed once".to_string(),
        ));
    }
    if players.len() < 2 || players.len() > MAX_PLAYERS {
        return Err(GamesError::BadRequest(format!(
            "a round needs between 2 and {MAX_PLAYERS} players"
        )));
    }
    if !players.contains(reporter) {
        return Err(GamesError::Unauthorized);
    }
    if report
        .winner
        .as_ref()
        .is_some_and(|winner| !players.contains(winner))
    {
        return Err(GamesError::BadRequest(
            "the winner must be one of the players".to_string(),
        ));
    }
    Ok(NewRoundResult {
        id: Uuid::now_v7(),
        reporter: reporter.clone(),
        document_id: receipt.entity().entity_id.clone(),
        round: report.round,
        kind: report.kind,
        winner: report.winner,
    })
}

impl<R> GamesService for GamesServiceImpl<R>
where
    R: GamesRepo,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn leaderboards(&self, receipt: &GamesReceipt) -> Result<GameLeaderboards, GamesError> {
        let (best_scores, win_tallies) = tokio::try_join!(
            async {
                self.repo
                    .best_scores(receipt.scope())
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.repo
                    .win_tallies(receipt.scope())
                    .await
                    .map_err(anyhow::Error::from)
            },
        )?;
        Ok(build_leaderboards(receipt, best_scores, win_tallies))
    }

    #[tracing::instrument(err, skip(self))]
    async fn submit_score(
        &self,
        user_id: &MacroUserIdStr<'static>,
        kind: GameKind,
        score: i64,
    ) -> Result<ScoreSubmission, GamesError> {
        validate_score(kind, score)?;
        let (best, improved) = self
            .repo
            .record_best_score(user_id, kind, score)
            .await
            .map_err(anyhow::Error::from)?;
        Ok(ScoreSubmission {
            best: best.score,
            achieved_at: best.achieved_at,
            improved,
        })
    }

    #[tracing::instrument(err, skip(self, receipt))]
    async fn report_round(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        report: RoundReport,
    ) -> Result<RoundRecorded, GamesError> {
        let round = validate_round(&receipt, report)?;
        let write = self
            .repo
            .record_round(&round)
            .await
            .map_err(anyhow::Error::from)?;
        match write {
            RoundWrite::Recorded => Ok(RoundRecorded { recorded: true }),
            RoundWrite::Pending | RoundWrite::AlreadyRecorded => {
                Ok(RoundRecorded { recorded: false })
            }
            RoundWrite::UnknownReference => Err(GamesError::BadRequest(
                "the room or one of its players no longer exists".to_string(),
            )),
        }
    }
}
