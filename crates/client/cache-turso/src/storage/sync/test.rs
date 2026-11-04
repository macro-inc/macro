use super::*;
use pollster::block_on;

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn row(id: &str, state: &str) -> SyncLaneRow {
    SyncLaneRow {
        id: id.to_owned(),
        state: state.to_owned(),
    }
}

#[test]
fn lane_rows_and_members_persist_across_reopen_and_clear_with_the_cache() {
    block_on(async {
        let database = TursoMemoryDatabase::new("sync-state.db");
        let mut storage = database.open("scope").unwrap();
        storage
            .save_sync_lane(row("tasks", "{\"pages\":1}"), vec![key("A:1"), key("A:2")])
            .await
            .unwrap();
        storage
            .save_sync_lane(row("documents", "{}"), vec![key("A:2"), key("B:1")])
            .await
            .unwrap();
        // Re-saving replaces the row and keeps existing members.
        storage
            .save_sync_lane(row("tasks", "{\"pages\":2}"), vec![key("A:1")])
            .await
            .unwrap();
        storage.try_close().unwrap();

        let mut storage = database.open("scope").unwrap();
        assert_eq!(
            storage.load_sync_lanes().await.unwrap(),
            vec![row("documents", "{}"), row("tasks", "{\"pages\":2}")]
        );
        let lanes = ["tasks".to_owned(), "documents".to_owned()];
        assert_eq!(
            storage.load_sync_members(&lanes).await.unwrap(),
            vec![key("A:1"), key("A:2"), key("B:1")]
        );

        storage
            .remove_sync_members(&lanes[..1], &[key("A:2")])
            .await
            .unwrap();
        assert_eq!(
            storage.load_sync_members(&lanes[..1]).await.unwrap(),
            vec![key("A:1")]
        );
        assert_eq!(
            storage.load_sync_members(&lanes[1..]).await.unwrap(),
            vec![key("A:2"), key("B:1")]
        );

        storage.clear().await.unwrap();
        assert!(storage.load_sync_lanes().await.unwrap().is_empty());
        assert!(storage.load_sync_members(&lanes).await.unwrap().is_empty());
    });
}
