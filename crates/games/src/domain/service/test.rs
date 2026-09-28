use std::sync::Mutex;

use chrono::{DateTime, Duration, TimeZone, Utc};
use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::EditAccessLevel;
use strum::IntoEnumIterator;
use uuid::Uuid;

use super::GamesServiceImpl;
use crate::domain::models::{
    BestScore, GameKind, GameScoring, GamesError, GamesReceipt, LEADERBOARD_SIZE, LeaderboardScope,
    NewRoundResult, RoundReport, RoundWrite, WinTally,
};
use crate::domain::ports::{GamesRepo, GamesService};

const ANN: &str = "macro|ann@macro.com";
const BOB: &str = "macro|bob@macro.com";
const CAT: &str = "macro|cat@macro.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn at(minute: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap() + Duration::minutes(minute)
}

/// In-memory repository with the same semantics as the Postgres adapter.
#[derive(Default)]
struct FakeRepo {
    best: Mutex<Vec<BestScore>>,
    wins: Vec<WinTally>,
    reports: Mutex<Vec<NewRoundResult>>,
    rounds: Mutex<Vec<NewRoundResult>>,
}

impl GamesRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn best_scores(&self, _scope: &LeaderboardScope) -> anyhow::Result<Vec<BestScore>> {
        Ok(self.best.lock().unwrap().clone())
    }

    async fn win_tallies(&self, _scope: &LeaderboardScope) -> anyhow::Result<Vec<WinTally>> {
        Ok(self.wins.clone())
    }

    async fn record_best_score(
        &self,
        user_id: &MacroUserIdStr<'_>,
        kind: GameKind,
        score: i64,
    ) -> anyhow::Result<(BestScore, bool)> {
        let mut best = self.best.lock().unwrap();
        let existing = best
            .iter_mut()
            .find(|row| row.user_id.to_string() == user_id.to_string() && row.kind == kind);
        match existing {
            Some(row) if !kind.is_better(score, row.score) => Ok((row.clone(), false)),
            Some(row) => {
                row.score = score;
                Ok((row.clone(), true))
            }
            None => {
                let row = BestScore {
                    user_id: user(&user_id.to_string()),
                    kind,
                    score,
                    achieved_at: at(0),
                };
                best.push(row.clone());
                Ok((row, true))
            }
        }
    }

    async fn record_round(&self, round: &NewRoundResult) -> anyhow::Result<RoundWrite> {
        let same_round =
            |r: &NewRoundResult| r.document_id == round.document_id && r.round == round.round;
        let mut reports = self.reports.lock().unwrap();
        if !reports
            .iter()
            .any(|r| same_round(r) && r.reporter == round.reporter)
        {
            reports.push(round.clone());
        }
        let agreeing = reports
            .iter()
            .filter(|r| same_round(r) && r.kind == round.kind && r.winner == round.winner)
            .count();
        let mut rounds = self.rounds.lock().unwrap();
        if rounds.iter().any(same_round) {
            return Ok(RoundWrite::AlreadyRecorded);
        }
        if agreeing < 2 {
            return Ok(RoundWrite::Pending);
        }
        rounds.push(round.clone());
        Ok(RoundWrite::Recorded)
    }
}

fn best(id: &str, kind: GameKind, score: i64, minute: i64) -> BestScore {
    BestScore {
        user_id: user(id),
        kind,
        score,
        achieved_at: at(minute),
    }
}

fn room_receipt(reporter: &str) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(reporter),
        "room-1",
        EntityType::Document,
    )
}

fn report(kind: GameKind, round: i32, winner: Option<&str>, players: &[&str]) -> RoundReport {
    RoundReport {
        kind,
        round,
        winner: winner.map(user),
        players: players.iter().map(|id| user(id)).collect(),
    }
}

#[tokio::test]
async fn ranks_each_game_by_its_own_order_with_ties_to_the_earliest() {
    let repo = FakeRepo {
        best: Mutex::new(vec![
            best(ANN, GameKind::Snake, 300, 5),
            best(BOB, GameKind::Snake, 300, 2),
            best(CAT, GameKind::Snake, 120, 1),
            best(ANN, GameKind::Minesweeper, 41_000, 1),
            best(BOB, GameKind::Minesweeper, 38_500, 3),
        ]),
        wins: vec![
            WinTally {
                user_id: user(CAT),
                kind: GameKind::ConnectFour,
                wins: 4,
                last_won_at: at(9),
            },
            WinTally {
                user_id: user(ANN),
                kind: GameKind::ConnectFour,
                wins: 7,
                last_won_at: at(3),
            },
        ],
        ..FakeRepo::default()
    };
    let service = GamesServiceImpl::new(repo);
    let team_id = Uuid::now_v7();
    let receipt = GamesReceipt::dangerously_internal(LeaderboardScope::Team(team_id), CAT);
    let boards = service.leaderboards(&receipt).await.unwrap();

    assert_eq!(boards.team_id, Some(team_id));
    assert_eq!(boards.games.len(), GameKind::iter().count());
    let board = |kind: GameKind| boards.games.iter().find(|g| g.kind == kind).unwrap();
    let order = |kind: GameKind| {
        board(kind)
            .entries
            .iter()
            .map(|entry| (entry.user_id.to_string(), entry.rank, entry.value))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        order(GameKind::Snake),
        vec![
            (BOB.to_string(), 1, 300),
            (ANN.to_string(), 2, 300),
            (CAT.to_string(), 3, 120),
        ]
    );
    assert_eq!(board(GameKind::Minesweeper).scoring, GameScoring::LowScore);
    assert_eq!(
        order(GameKind::Minesweeper),
        vec![(BOB.to_string(), 1, 38_500), (ANN.to_string(), 2, 41_000)]
    );
    assert_eq!(
        order(GameKind::ConnectFour),
        vec![(ANN.to_string(), 1, 7), (CAT.to_string(), 2, 4)]
    );
    assert_eq!(
        board(GameKind::ConnectFour).viewer.as_ref().unwrap().rank,
        2
    );
    assert!(board(GameKind::TypingRace).entries.is_empty());
    assert!(board(GameKind::Minesweeper).viewer.is_none());
}

#[tokio::test]
async fn keeps_the_viewer_row_when_it_falls_outside_the_top() {
    let mut rows: Vec<BestScore> = (0..15)
        .map(|index| {
            best(
                &format!("macro|player{index}@macro.com"),
                GameKind::TwentyFortyEight,
                10_000 - index,
                0,
            )
        })
        .collect();
    rows.push(best(ANN, GameKind::TwentyFortyEight, 4, 0));
    let service = GamesServiceImpl::new(FakeRepo {
        best: Mutex::new(rows),
        ..FakeRepo::default()
    });
    let receipt = GamesReceipt::dangerously_internal(LeaderboardScope::Team(Uuid::now_v7()), ANN);
    let boards = service.leaderboards(&receipt).await.unwrap();
    let board = boards
        .games
        .iter()
        .find(|g| g.kind == GameKind::TwentyFortyEight)
        .unwrap();
    assert_eq!(board.entries.len(), LEADERBOARD_SIZE);
    assert_eq!(board.viewer.as_ref().unwrap().rank, 16);
}

#[tokio::test]
async fn submits_scores_within_each_games_bounds() {
    let service = GamesServiceImpl::new(FakeRepo::default());
    let first = service
        .submit_score(&user(ANN), GameKind::Snake, 250)
        .await
        .unwrap();
    assert!(first.improved);
    let worse = service
        .submit_score(&user(ANN), GameKind::Snake, 90)
        .await
        .unwrap();
    assert_eq!((worse.best, worse.improved), (250, false));

    for (kind, score) in [
        (GameKind::Snake, -10),
        (GameKind::TypingRace, 900),
        (GameKind::Minesweeper, 0),
        (GameKind::ConnectFour, 1),
    ] {
        assert!(
            matches!(
                service.submit_score(&user(ANN), kind, score).await,
                Err(GamesError::BadRequest(_))
            ),
            "{kind} {score}"
        );
    }
}

#[tokio::test]
async fn counts_a_round_once_two_of_its_players_agree() {
    let service = GamesServiceImpl::new(FakeRepo::default());
    let connect_four =
        |round, winner| report(GameKind::ConnectFour, round, Some(winner), &[ANN, BOB]);

    // Ann alone cannot make her win count, however often she reports it.
    for _ in 0..2 {
        let lone = service
            .report_round(room_receipt(ANN), connect_four(0, ANN))
            .await
            .unwrap();
        assert!(!lone.recorded);
    }
    // Bob saw himself win instead, so the round stays uncounted.
    let disputed = service
        .report_round(room_receipt(BOB), connect_four(0, BOB))
        .await
        .unwrap();
    assert!(!disputed.recorded);

    let first = service
        .report_round(room_receipt(ANN), connect_four(1, BOB))
        .await
        .unwrap();
    assert!(!first.recorded);
    let agreed = service
        .report_round(room_receipt(BOB), connect_four(1, BOB))
        .await
        .unwrap();
    assert!(agreed.recorded);
}

#[tokio::test]
async fn rejects_rounds_that_do_not_describe_a_real_match() {
    let service = GamesServiceImpl::new(FakeRepo::default());
    let cases = [
        // A spectator cannot report.
        (CAT, report(GameKind::TicTacToe, 0, Some(ANN), &[ANN, BOB])),
        // The winner must have played.
        (ANN, report(GameKind::TicTacToe, 0, Some(CAT), &[ANN, BOB])),
        // A match needs an opponent.
        (ANN, report(GameKind::TicTacToe, 0, Some(ANN), &[ANN])),
        // Players are listed once.
        (ANN, report(GameKind::TicTacToe, 0, None, &[ANN, ANN])),
        // Score games submit scores instead.
        (ANN, report(GameKind::Snake, 0, Some(ANN), &[ANN, BOB])),
        (ANN, report(GameKind::TicTacToe, -1, None, &[ANN, BOB])),
    ];
    for (reporter, round) in cases {
        let result = service.report_round(room_receipt(reporter), round).await;
        assert!(
            matches!(
                result,
                Err(GamesError::BadRequest(_) | GamesError::Unauthorized)
            ),
            "{result:?}"
        );
    }

    let project = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        user(ANN),
        "project-1",
        EntityType::Project,
    );
    assert!(matches!(
        service
            .report_round(project, report(GameKind::TicTacToe, 0, None, &[ANN, BOB]))
            .await,
        Err(GamesError::BadRequest(_))
    ));
}
