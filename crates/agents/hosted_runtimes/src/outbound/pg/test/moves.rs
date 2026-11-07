use super::*;
use crate::domain::moves::{ComputerMoves, MoveStage, StartMoveError};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_move_holds_capacity_on_its_target_and_flips_in_one_transaction(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let source = host(&repo, "move-source", 32, 0, 3).await;
    let computer = bought(&repo, 1).await;
    assert_eq!(computer.host, source.id);
    changed(&repo, computer.id, Event::InstanceStarted, now()).await;
    let running = changed(&repo, computer.id, Event::MacrodConnected, now()).await;
    assert_eq!(running.state.phase, Phase::Running);
    let target = host(&repo, "move-target", 32, 0, 3).await;
    let sold_on = |allocations: &[HostAllocation], id: HostId| {
        allocations
            .iter()
            .find(|allocation| allocation.host.id == id)
            .unwrap()
            .sold_units
    };
    let before = repo.allocation().await.unwrap();
    assert_eq!(sold_on(&before, target.id), 0);

    let moved = repo
        .create_move(computer.id, source.id, target.id, "internal")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(moved.stage, MoveStage::Seeding);
    assert_eq!(moved.ticket.as_ref().unwrap().expose().len(), 64);
    // One open move per computer.
    assert_eq!(
        repo.create_move(computer.id, source.id, target.id, "internal")
            .await
            .unwrap(),
        Err(StartMoveError::AlreadyMoving)
    );
    // Both hosts count it while it moves.
    let moving = repo.allocation().await.unwrap();
    assert_eq!(sold_on(&moving, source.id), sold_on(&before, source.id));
    assert_eq!(sold_on(&moving, target.id), computer.resources.units());

    let mut cutting_over = moved.clone();
    cutting_over.stage = MoveStage::CuttingOver;
    cutting_over.rounds = 2;
    cutting_over.was_running = Some(true);
    repo.update_move(&cutting_over, now()).await.unwrap();
    assert!(repo.held(computer.id).await.unwrap());
    assert_eq!(
        repo.held_on(target.id).await.unwrap(),
        std::collections::HashSet::from([computer.id])
    );

    repo.flip(&cutting_over, target.id, MoveStage::Verifying, now())
        .await
        .unwrap();
    let flipped = repo.get(computer.id).await.unwrap().unwrap();
    let flipped = flipped.healthy().unwrap();
    assert_eq!(flipped.host, target.id);
    assert_eq!(flipped.state.phase, Phase::Booting);
    assert!(!repo.held(computer.id).await.unwrap());
    let restart = sqlx::query_scalar!(
        "SELECT effect FROM hosted_runtime_effect WHERE computer_id = $1 ORDER BY id DESC LIMIT 1",
        computer.id.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_value::<Effect>(restart).unwrap(),
        Effect::Restart { host: target.id }
    );
    let open = repo.open_moves().await.unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].stage, MoveStage::Verifying);
    assert_eq!(open[0].flipped_at, Some(now()));
    // After the flip it holds the source until the move finishes.
    let verifying = repo.allocation().await.unwrap();
    assert_eq!(sold_on(&verifying, source.id), computer.resources.units());

    let mut committed = open[0].clone();
    committed.stage = MoveStage::Committed;
    repo.update_move(&committed, now()).await.unwrap();
    assert!(repo.open_moves().await.unwrap().is_empty());
    let history = repo.moves_of(computer.id).await.unwrap();
    assert_eq!(history[0].stage, MoveStage::Committed);
    assert!(history[0].ticket.is_none());
    let finished = repo.allocation().await.unwrap();
    assert_eq!(sold_on(&finished, source.id), 0);
}
