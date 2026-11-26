//! A run applies frames only to the cache it began against.

use super::*;

fn tasks_plan() -> Plan {
    args(vec![lane(
        "tasks",
        TASKS,
        "soup",
        json!({"kind": "hydrate"}),
    )])
}

fn superseded<T: std::fmt::Debug>(result: Result<T, SyncWriteError<Infallible, Infallible>>) {
    assert!(
        matches!(
            result,
            Err(SyncWriteError::Stream(SyncStreamError::Superseded))
        ),
        "expected a superseded run, got {result:?}"
    );
}

#[test]
fn a_run_begun_before_a_clear_writes_nothing_after_it() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &tasks_plan()).await;
        engine.clear().await.unwrap();

        let stream = ndjson(&[soup_page("tasks", 0, &[1], None), lane_done("tasks", 1, 1)]);
        superseded(run_stream(&mut engine, &mut run, &stream).await);
        assert_eq!(present(&engine, &[task_key(1)]).await, [false]);
        assert!(engine.sync_lane_states().await.unwrap().is_empty());
    });
}

#[test]
fn a_run_begun_before_another_account_reset_the_cache_writes_nothing_after_it() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        screen_load(&mut engine, "viewer").await;
        let mut run = start(&mut engine, &tasks_plan()).await;
        run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[soup_page("tasks", 0, &[2], Some("c1"))]),
        )
        .await
        .unwrap();

        // A foreground response for another account resets the cache.
        screen_load(&mut engine, "someone-else").await;
        superseded(
            run_stream(
                &mut engine,
                &mut run,
                &ndjson(&[soup_page("tasks", 1, &[3], None), lane_done("tasks", 2, 2)]),
            )
            .await,
        );
        assert_eq!(present(&engine, &[task_key(3)]).await, [false]);
        // The reset wiped the lane's state; the run did not write it back.
        assert!(engine.sync_lane_states().await.unwrap().is_empty());
    });
}

#[test]
fn a_run_begun_before_an_external_reset_writes_nothing_after_it() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &tasks_plan()).await;
        engine.external_reset().unwrap();
        superseded(
            run_stream(
                &mut engine,
                &mut run,
                &ndjson(&[soup_page("tasks", 0, &[1], None)]),
            )
            .await,
        );
        assert_eq!(present(&engine, &[task_key(1)]).await, [false]);
    });
}

#[test]
fn a_run_begun_before_an_authority_transition_writes_nothing_after_it() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let before = engine.current_authority("session").await.unwrap();
        let mut run = start(&mut engine, &tasks_plan()).await;
        run_stream(
            &mut engine,
            &mut run,
            &ndjson(&[soup_page("tasks", 0, &[2], Some("c1"))]),
        )
        .await
        .unwrap();

        // A permission change retires records under a new generation.
        let after = engine
            .begin_authority_transition("session", before.generation, "denied".into(), true)
            .await
            .unwrap();
        assert_ne!(after.generation, before.generation);
        superseded(
            run_stream(
                &mut engine,
                &mut run,
                &ndjson(&[soup_page("tasks", 1, &[3], None), lane_done("tasks", 2, 2)]),
            )
            .await,
        );
        assert_eq!(present(&engine, &[task_key(3)]).await, [false]);
    });
}

#[test]
fn a_run_follows_the_generation_its_own_page_gave_the_authority() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        // A policy recorded before any response bound the account.
        let unbound = engine.current_authority("session").await.unwrap();
        engine
            .begin_authority_transition("session", unbound.generation, "allowed".into(), false)
            .await
            .unwrap();
        let mut run = start(&mut engine, &tasks_plan()).await;
        // The first page binds the account, which renews the generation
        // without resetting the cache.
        let stream = ndjson(&[
            soup_page("tasks", 0, &[2], Some("c1")),
            soup_page("tasks", 1, &[3], None),
            lane_done("tasks", 2, 2),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();

        let bound = engine.current_authority("session").await.unwrap();
        assert_ne!(bound.generation, unbound.generation);
        assert_eq!(
            present(&engine, &[task_key(2), task_key(3)]).await,
            [true, true]
        );
    });
}

#[test]
fn a_run_begun_before_the_cache_had_an_authority_adopts_its_first() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut run = start(&mut engine, &tasks_plan()).await;
        engine.current_authority("session").await.unwrap();
        let stream = ndjson(&[
            soup_page("tasks", 0, &[2], None),
            lane_done("tasks", 1, 1),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(present(&engine, &[task_key(2)]).await, [true]);
    });
}

#[test]
fn a_run_begun_after_a_clear_applies() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.clear().await.unwrap();
        let mut run = start(&mut engine, &tasks_plan()).await;
        let stream = ndjson(&[
            soup_page("tasks", 0, &[1], None),
            lane_done("tasks", 1, 1),
            end("complete"),
        ]);
        run_stream(&mut engine, &mut run, &stream).await.unwrap();
        assert_eq!(present(&engine, &[task_key(1)]).await, [true]);
    });
}
