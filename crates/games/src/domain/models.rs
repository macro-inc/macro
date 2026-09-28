//! Domain models for game leaderboards.

#[cfg(test)]
mod test;

use std::ops::RangeInclusive;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Entries returned per game leaderboard.
pub const LEADERBOARD_SIZE: usize = 10;

/// Highest round index a room may report.
pub const MAX_ROUND: i32 = 100_000;

/// Most players a room can seat (typing races seat eight).
pub const MAX_PLAYERS: usize = 8;

/// Every game offered in Macro. Spellings match the web catalog and the
/// `game_kind` Postgres enum.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumString,
    strum::EnumIter,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GameKind {
    /// Two players; ranked by matches won.
    Pong,
    /// Solo; score is points from bricks broken.
    BrickBreaker,
    /// Solo; score is points from apples eaten.
    Snake,
    /// Solo; score is points from cleared lines and drops.
    FallingBlocks,
    /// Solo; score is points from invaders shot down.
    Invaders,
    /// Solo; score is pipes passed.
    Flappy,
    /// Solo; score is the sum of merged tiles.
    TwentyFortyEight,
    /// Solo; score is the clear time in milliseconds, lower is better.
    Minesweeper,
    /// Two players; ranked by wins.
    TicTacToe,
    /// Two players; ranked by wins.
    ConnectFour,
    /// Two to four players; ranked by wins.
    DotsAndBoxes,
    /// One to eight players; score is words per minute.
    TypingRace,
}

/// How a game ranks its players.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum GameScoring {
    /// Each player's highest score.
    HighScore,
    /// Each player's lowest score, such as a clear time.
    LowScore,
    /// Rounds won outright.
    Wins,
}

impl GameKind {
    /// How this game ranks its players.
    pub fn scoring(self) -> GameScoring {
        match self {
            Self::BrickBreaker
            | Self::Snake
            | Self::FallingBlocks
            | Self::Invaders
            | Self::Flappy
            | Self::TwentyFortyEight
            | Self::TypingRace => GameScoring::HighScore,
            Self::Minesweeper => GameScoring::LowScore,
            Self::Pong | Self::TicTacToe | Self::ConnectFour | Self::DotsAndBoxes => {
                GameScoring::Wins
            }
        }
    }

    /// Scores a finished run can plausibly reach; `None` for win-ranked games.
    pub fn score_range(self) -> Option<RangeInclusive<i64>> {
        match self {
            // Levels repeat without end; far beyond a long session.
            Self::BrickBreaker | Self::Invaders => Some(0..=1_000_000),
            // 10 points per apple on a 20×20 board.
            Self::Snake => Some(0..=4_000),
            // Line clears multiply by level, so strong players score high.
            Self::FallingBlocks => Some(0..=10_000_000),
            Self::Flappy => Some(0..=100_000),
            // Above the theoretical maximum of a 4×4 board.
            Self::TwentyFortyEight => Some(0..=4_000_000),
            // A clear takes at least a click; a day is the most we keep.
            Self::Minesweeper => Some(1..=86_400_000),
            Self::TypingRace => Some(0..=300),
            Self::Pong | Self::TicTacToe | Self::ConnectFour | Self::DotsAndBoxes => None,
        }
    }

    /// Whether `candidate` beats `current` under this game's ranking.
    pub fn is_better(self, candidate: i64, current: i64) -> bool {
        match self.scoring() {
            GameScoring::LowScore => candidate < current,
            GameScoring::HighScore | GameScoring::Wins => candidate > current,
        }
    }
}

/// Whose results a leaderboard ranks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeaderboardScope {
    /// The current members of a verified team.
    Team(Uuid),
    /// A player without a team sees only their own results.
    User(MacroUserIdStr<'static>),
}

impl LeaderboardScope {
    /// Team whose members are ranked, if any.
    pub fn team_id(&self) -> Option<Uuid> {
        match self {
            Self::Team(id) => Some(*id),
            Self::User(_) => None,
        }
    }
}

/// Authorized leaderboard scope and the authenticated viewer.
#[derive(Debug)]
pub struct GamesReceipt {
    scope: LeaderboardScope,
    user_id: MacroUserIdStr<'static>,
}

impl GamesReceipt {
    /// Rank the viewer's team from a verified team receipt, otherwise only the
    /// viewer. The receipt must belong to that viewer.
    pub fn from_access(
        user_id: MacroUserIdStr<'static>,
        receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<Self, GamesError> {
        let scope = match receipt {
            Some(receipt) => {
                if receipt.entity().entity_type != EntityType::Team
                    || receipt
                        .get_authenticated_user()
                        .map_err(|_| GamesError::Unauthorized)?
                        != &user_id
                {
                    return Err(GamesError::Unauthorized);
                }
                let team_id = Uuid::parse_str(&receipt.entity().entity_id)
                    .map_err(|_| GamesError::Unauthorized)?;
                LeaderboardScope::Team(team_id)
            }
            None => LeaderboardScope::User(user_id.clone()),
        };
        Ok(Self { scope, user_id })
    }

    /// Authorized scope for this call.
    pub fn scope(&self) -> &LeaderboardScope {
        &self.scope
    }

    /// Authenticated viewer making the call.
    pub fn user_id(&self) -> &MacroUserIdStr<'static> {
        &self.user_id
    }

    /// Test-only receipt without an access check.
    #[cfg(test)]
    pub(crate) fn dangerously_internal(scope: LeaderboardScope, user_id: &str) -> Self {
        Self {
            scope,
            user_id: MacroUserIdStr::try_from(user_id.to_owned()).expect("valid user id"),
        }
    }
}

/// A player's persisted best result in one high-score game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestScore {
    /// The player.
    pub user_id: MacroUserIdStr<'static>,
    /// The game.
    pub kind: GameKind,
    /// Their best score under the game's ranking.
    pub score: i64,
    /// When the best score was set.
    pub achieved_at: DateTime<Utc>,
}

/// Rounds a player has won outright in one game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WinTally {
    /// The player.
    pub user_id: MacroUserIdStr<'static>,
    /// The game.
    pub kind: GameKind,
    /// Rounds won.
    pub wins: i64,
    /// When the latest win was recorded.
    pub last_won_at: DateTime<Utc>,
}

/// One ranked leaderboard row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    /// The player.
    pub user_id: MacroUserIdStr<'static>,
    /// 1-based position; ties share the earlier player's position order.
    pub rank: u32,
    /// Best score, or number of wins for win-ranked games.
    pub value: i64,
    /// When the score was set, or the latest win.
    pub at: DateTime<Utc>,
}

/// The ranking of one game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GameLeaderboard {
    /// The game.
    pub kind: GameKind,
    /// How `value` ranks.
    pub scoring: GameScoring,
    /// The best players, at most [`LEADERBOARD_SIZE`].
    pub entries: Vec<LeaderboardEntry>,
    /// The viewer's own row, including when it falls outside `entries`.
    pub viewer: Option<LeaderboardEntry>,
}

/// Every game's leaderboard for the viewer's team, or for the viewer alone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GameLeaderboards {
    /// The ranked team; `None` when the viewer has no team.
    pub team_id: Option<Uuid>,
    /// One leaderboard per game, in catalog order.
    pub games: Vec<GameLeaderboard>,
}

/// Outcome of submitting a finished run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ScoreSubmission {
    /// The player's best score after this run.
    pub best: i64,
    /// When `best` was set.
    pub achieved_at: DateTime<Utc>,
    /// Whether this run set a new personal best.
    pub improved: bool,
}

/// A finished round reported by one of its players.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoundReport {
    /// The game played in the room.
    pub kind: GameKind,
    /// Zero-based round index within the room.
    pub round: i32,
    /// The outright winner; `None` for a draw or a shared win.
    pub winner: Option<MacroUserIdStr<'static>>,
    /// Everyone seated for the round.
    pub players: Vec<MacroUserIdStr<'static>>,
}

/// A validated round, ready to persist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewRoundResult {
    /// Row id (UUIDv7) for the round, used if this report makes it count.
    pub id: Uuid,
    /// The player reporting the round.
    pub reporter: MacroUserIdStr<'static>,
    /// The game room.
    pub document_id: String,
    /// Zero-based round index within the room.
    pub round: i32,
    /// The game played.
    pub kind: GameKind,
    /// The outright winner, if any.
    pub winner: Option<MacroUserIdStr<'static>>,
}

/// What persisting a round did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoundWrite {
    /// This report agreed with another player's, so the round now counts.
    Recorded,
    /// The report is stored; the round counts once another of its players
    /// reports the same result.
    Pending,
    /// The round already counts.
    AlreadyRecorded,
    /// The room or a player no longer exists.
    UnknownReference,
}

/// Outcome of reporting a finished round.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct RoundRecorded {
    /// Whether this report made the round count. A round counts once two of
    /// its players report the same result, so the first report returns false.
    pub recorded: bool,
}

/// Errors returned by the games service.
#[derive(Debug, thiserror::Error)]
pub enum GamesError {
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The caller may not perform this action.
    #[error("you do not have access to this game")]
    Unauthorized,
    /// Any other internal error.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
