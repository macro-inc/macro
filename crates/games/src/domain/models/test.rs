use std::str::FromStr;

use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use strum::IntoEnumIterator;
use uuid::Uuid;

use super::{GameKind, GameScoring, GamesError, GamesReceipt, LeaderboardScope};

const ANN: &str = "macro|ann@macro.com";

fn ann() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(ANN.to_owned()).unwrap()
}

#[test]
fn every_kind_has_its_catalog_and_database_spelling() {
    let spellings: Vec<String> = GameKind::iter().map(|kind| kind.to_string()).collect();
    assert_eq!(
        spellings,
        [
            "pong",
            "brick_breaker",
            "snake",
            "falling_blocks",
            "invaders",
            "flappy",
            "twenty_forty_eight",
            "minesweeper",
            "tic_tac_toe",
            "connect_four",
            "dots_and_boxes",
            "typing_race",
        ]
    );
    for kind in GameKind::iter() {
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, format!("\"{kind}\""));
        assert_eq!(GameKind::from_str(&kind.to_string()).unwrap(), kind);
    }
}

#[test]
fn only_score_ranked_games_accept_scores() {
    for kind in GameKind::iter() {
        assert_eq!(
            kind.score_range().is_some(),
            kind.scoring() != GameScoring::Wins,
            "{kind}"
        );
    }
    assert!(GameKind::Minesweeper.is_better(30_000, 45_000));
    assert!(GameKind::Snake.is_better(450, 300));
}

#[test]
fn a_team_receipt_scopes_the_leaderboard_to_that_team() {
    let team_id = Uuid::now_v7();
    let receipt = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        ann(),
        &team_id.to_string(),
        EntityType::Team,
    );
    let games = GamesReceipt::from_access(ann(), Some(receipt)).unwrap();
    assert_eq!(games.scope(), &LeaderboardScope::Team(team_id));

    let solo = GamesReceipt::from_access(ann(), None).unwrap();
    assert_eq!(solo.scope(), &LeaderboardScope::User(ann()));
}

#[test]
fn a_receipt_for_someone_else_or_another_entity_is_rejected() {
    let team_id = Uuid::now_v7().to_string();
    let other = MacroUserIdStr::try_from("macro|bob@macro.com".to_owned()).unwrap();
    let foreign = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        other,
        &team_id,
        EntityType::Team,
    );
    assert!(matches!(
        GamesReceipt::from_access(ann(), Some(foreign)),
        Err(GamesError::Unauthorized)
    ));
    let document = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        ann(),
        &team_id,
        EntityType::Document,
    );
    assert!(matches!(
        GamesReceipt::from_access(ann(), Some(document)),
        Err(GamesError::Unauthorized)
    ));
}
