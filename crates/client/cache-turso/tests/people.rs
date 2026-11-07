#![cfg(not(target_arch = "wasm32"))]
#[path = "common/people.rs"]
mod people;
use cache_turso::{TursoFileDatabase, TursoStorage};
use pollster::block_on;

#[test]
fn context_and_ranking_precede_limits_without_creating_membership() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("people-policy").unwrap();
        people::seed(&mut storage, 2_000).await;
        people::assert_policy(storage).await;
    });
}

#[test]
#[ignore = "100k context-aware person ranking measurement"]
fn people_policy_100k() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("people-policy.db")).unwrap();
        let mut storage = database.open("people-policy").unwrap();
        people::seed(&mut storage, 100_000).await;
        use cache_core::{
            engine::{Engine, HydrationScope},
            people::{ContextAction, ContextUpdate, PeopleMode, PeopleSearch, PeopleSearchResult},
        };
        let mut engine = Engine::new(storage);
        let scope = HydrationScope {
            contact_fence: None,
            identity: "macro|viewer@example.com".into(),
            storage_generation: engine.current_storage_generation().await.unwrap(),
        };
        let epoch = uuid::Uuid::now_v7();
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch,
                action: ContextAction::Begin {
                    previous_epoch: None,
                },
            })
            .await
            .unwrap();
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch,
                action: ContextAction::Commit,
            })
            .await
            .unwrap();
        for query in ["alpha", "p099999@example.com", "absent", "", "alpha"] {
            let start = std::time::Instant::now();
            let result = engine
                .search_people(&PeopleSearch {
                    scope: scope.clone(),
                    mode: PeopleMode::Command,
                    query: query.into(),
                    excluded: vec![],
                    sender_domain: None,
                    limit: 50,
                    now_ms: 2_000,
                    cursor: None,
                })
                .await
                .unwrap();
            let PeopleSearchResult::Page { people, .. } = result else {
                panic!("ready")
            };
            eprintln!(
                "100k person policy: query={query:?}, elapsed={:?}, winners={}",
                start.elapsed(),
                people.len()
            );
            assert!(people.len() <= 50);
        }
    });
}
