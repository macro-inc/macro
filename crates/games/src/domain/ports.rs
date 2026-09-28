//! Ports (trait contracts) for the games domain.

use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::EditAccessLevel;

use crate::domain::models::{
    BestScore, GameKind, GameLeaderboards, GamesError, GamesReceipt, LeaderboardScope,
    NewRoundResult, RoundRecorded, RoundReport, RoundWrite, ScoreSubmission, WinTally,
};

/// Outbound persistence port for game results.
pub trait GamesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Send + std::fmt::Debug;

    /// Best scores of everyone in `scope` across all high-score games: the
    /// team's current members, or the one player.
    fn best_scores(
        &self,
        scope: &LeaderboardScope,
    ) -> impl Future<Output = Result<Vec<BestScore>, Self::Err>> + Send;

    /// Outright round wins of everyone in `scope`, per game.
    fn win_tallies(
        &self,
        scope: &LeaderboardScope,
    ) -> impl Future<Output = Result<Vec<WinTally>, Self::Err>> + Send;

    /// Keep `score` as the player's best unless the stored best is at least as
    /// good under `kind`'s ranking. Returns the best afterwards and whether
    /// this call changed it; the check and the write are one atomic statement.
    fn record_best_score(
        &self,
        user_id: &MacroUserIdStr<'_>,
        kind: GameKind,
        score: i64,
    ) -> impl Future<Output = Result<(BestScore, bool), Self::Err>> + Send;

    /// Store a player's report of a round, once per player. The round counts,
    /// once per room and round index, when two of its players' reports agree.
    fn record_round(
        &self,
        round: &NewRoundResult,
    ) -> impl Future<Output = Result<RoundWrite, Self::Err>> + Send;
}

/// Inbound port for game leaderboards.
pub trait GamesService: Send + Sync + 'static {
    /// Every game's leaderboard for the receipt's scope.
    fn leaderboards(
        &self,
        receipt: &GamesReceipt,
    ) -> impl Future<Output = Result<GameLeaderboards, GamesError>> + Send;

    /// Record a finished run of a high-score game for `user_id`.
    fn submit_score(
        &self,
        user_id: &MacroUserIdStr<'static>,
        kind: GameKind,
        score: i64,
    ) -> impl Future<Output = Result<ScoreSubmission, GamesError>> + Send;

    /// Record a player's report of a finished round of a win-ranked game. The
    /// receipt proves the reporter can edit the room; the reporter must be one
    /// of its players. The round counts once another player agrees.
    fn report_round(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        report: RoundReport,
    ) -> impl Future<Output = Result<RoundRecorded, GamesError>> + Send;
}
