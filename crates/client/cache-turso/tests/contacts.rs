#![cfg(not(target_arch = "wasm32"))]

#[path = "common/contacts.rs"]
mod contacts;

use cache_core::engine::Engine;
use cache_turso::TursoFileDatabase;
use pollster::block_on;

#[test]
fn hydrated_contacts_search_and_materialize_after_reopen_without_viewer_pages() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("contacts.turso")).unwrap();
        // Smaller than one hydration page: staging must not depend on hot LRU size.
        let mut engine = Engine::with_capacity(database.open("contacts").unwrap(), 16);
        contacts::hydrate_contacts(&mut engine, 3).await;
        let generation = engine.current_storage_generation().await.unwrap();
        engine.into_storage().try_close().unwrap();
        let mut engine = Engine::with_capacity(database.open("contacts").unwrap(), 16);
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            generation
        );
        contacts::assert_contact_search(&mut engine, 1_500).await;
        contacts::assert_account_reset(&mut engine).await;
    });
}

#[test]
#[ignore = "100k normalized contact hydration and search measurement; run explicitly"]
fn hydrate_and_search_100k_contacts() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database =
            TursoFileDatabase::new(directory.path().join("contacts-100k.turso")).unwrap();
        let mut engine = Engine::with_capacity(database.open("contacts-100k").unwrap(), 16);
        let start = std::time::Instant::now();
        contacts::hydrate_contacts(&mut engine, 200).await;
        eprintln!("100k contacts hydrated in {:?}", start.elapsed());
        engine.into_storage().try_close().unwrap();
        let mut engine = Engine::with_capacity(database.open("contacts-100k").unwrap(), 16);
        let start = std::time::Instant::now();
        contacts::assert_contact_search(&mut engine, 100_000).await;
        eprintln!(
            "100k contacts: query/browse/materialization scenario in {:?}",
            start.elapsed()
        );
    });
}
