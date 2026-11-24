use super::*;
use crate::{WritePassStep, WritePasses, write_passes};

/// A refetch without thread 1's capsule, so the Mail pass merges what
/// storage holds for it.
fn partial() -> Value {
    let mut seed = seed();
    seed["user"]["soup"]["items"][0]
        .as_object_mut()
        .unwrap()
        .remove("cacheProjection");
    seed
}

/// The seed with thread 1 moved to another account and owner, with other facts.
fn moved_seed() -> Value {
    let mut seed = seed();
    let thread = &mut seed["user"]["soup"]["items"][0];
    thread["linkId"] = json!(id(1001));
    thread["ownerId"] = json!("macro|other@example.com");
    thread["cacheProjection"] = json!(capsule(1, false));
    thread["isSignal"] = json!(true);
    thread["latestInboundMessageTs"] = json!("2025-02-02T00:00:00.000002Z");
    seed
}

async fn finish<S>(
    passes: &mut WritePasses,
    engine: &mut Engine<S>,
    response: &WriteResponse<'_>,
) -> (usize, Vec<ProjectionMutation>)
where
    S: PredicateIndexStorage,
    for<'a> cache_core::engine::PassReads<'a, S>: cache_core::store::DurableRead<Error = S::Error>,
{
    let mut steps = 0;
    loop {
        steps += 1;
        if let WritePassStep::Done(projections) = passes.step(engine, response).await.unwrap() {
            return (steps, projections);
        }
    }
}

#[test]
fn stepped_passes_match_one_call_and_start_over_after_a_commit() {
    pollster::block_on(async {
        let storage = cache_turso::TursoStorage::open_in_memory("write-passes-stepping").unwrap();
        let mut engine = Engine::new(storage);
        write(&mut engine, QUERY, &seed()).await;
        let (vars, data) = (Map::new(), partial());
        let response = WriteResponse::new(
            cache_core::meta::bundled_schema_ref(),
            QUERY,
            None,
            &vars,
            &data,
        );

        let whole = write_passes(&mut engine, &response, true, Vec::new())
            .await
            .unwrap();
        let mut passes = WritePasses::new(true, Vec::new());
        let (steps, stepped) = finish(&mut passes, &mut engine, &response).await;
        assert_eq!((steps, passes.restarts()), (3, 0), "one pass per step");
        assert_eq!(stepped, whole);

        let mut passes = WritePasses::new(true, Vec::new());
        assert!(matches!(
            passes.step(&mut engine, &response).await.unwrap(),
            WritePassStep::Pending
        ));
        write(&mut engine, QUERY, &moved_seed()).await;
        let (_, resumed) = finish(&mut passes, &mut engine, &response).await;
        assert_eq!(passes.restarts(), 1, "the commit moved the position");
        let fresh = write_passes(&mut engine, &response, true, Vec::new())
            .await
            .unwrap();
        assert_eq!(resumed, fresh);
    });
}

#[test]
fn storage_without_a_position_runs_every_pass_in_one_step() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::default());
        write(&mut engine, QUERY, &seed()).await;
        let (vars, data) = (Map::new(), partial());
        let response = WriteResponse::new(
            cache_core::meta::bundled_schema_ref(),
            PARTIAL,
            None,
            &vars,
            &data,
        );
        let mut passes = WritePasses::new(true, Vec::new());
        let (steps, _) = finish(&mut passes, &mut engine, &response).await;
        assert_eq!(steps, 1);
    });
}

#[test]
fn passes_that_keep_starting_over_run_whole_as_before() {
    pollster::block_on(async {
        let storage = cache_turso::TursoStorage::open_in_memory("write-passes-restarts").unwrap();
        let mut engine = Engine::new(storage);
        write(&mut engine, QUERY, &seed()).await;
        let (vars, data) = (Map::new(), partial());
        let response = WriteResponse::new(
            cache_core::meta::bundled_schema_ref(),
            QUERY,
            None,
            &vars,
            &data,
        );

        // A commit after every step: each step finds the position moved.
        let mut passes = WritePasses::new(true, Vec::new());
        let seeds = [moved_seed(), seed(), moved_seed()];
        let mut done = None;
        for data in &seeds {
            match passes.step(&mut engine, &response).await.unwrap() {
                WritePassStep::Pending => write(&mut engine, QUERY, data).await,
                WritePassStep::Done(projections) => {
                    done = Some(projections);
                    break;
                }
            }
        }
        assert!(done.is_none(), "every step so far found a commit");
        let (steps, projections) = finish(&mut passes, &mut engine, &response).await;
        // One step finds the last commit and starts over a second time; the
        // next runs every pass at once.
        assert_eq!((steps, passes.restarts()), (2, 2));
        let fresh = write_passes(&mut engine, &response, true, Vec::new())
            .await
            .unwrap();
        assert_eq!(projections, fresh);
    });
}
