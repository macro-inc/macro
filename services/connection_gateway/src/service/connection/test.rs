use super::*;
use crate::model::tracking::EntityConnectionExt;

struct UnusedRepo;

#[async_trait]
impl ConnectionRepo for UnusedRepo {
    async fn insert_connection_entry(
        &self,
        _connection: UserEntityConnection<'_>,
    ) -> anyhow::Result<StoredConnectionEntity> {
        unimplemented!()
    }

    async fn get_entries_by_entity(
        &self,
        _entity: &Entity<'_>,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn get_entries_by_connection_id(
        &self,
        _connection_id: &str,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn get_connection(&self, _connection_id: &str) -> anyhow::Result<StoredConnectionEntity> {
        unimplemented!()
    }

    async fn get_entry_for_connection_entity(
        &self,
        _entity: EntityConnection<'_>,
    ) -> anyhow::Result<Option<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn remove_all_entries_for_by_connection_id(
        &self,
        _connection_id: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn remove_entity(&self, _entity: &EntityConnection<'_>) -> anyhow::Result<()> {
        unimplemented!()
    }

    async fn update_last_entity_ping(
        &self,
        _entity: &EntityConnection<'_>,
        _timestamp: u64,
    ) -> anyhow::Result<Option<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn update_user_connection_last_ping(
        &self,
        _connection_id: &str,
        _user: &str,
        _timestamp: u64,
    ) -> anyhow::Result<()> {
        unimplemented!()
    }
}

#[tokio::test(start_paused = true)]
async fn a_connection_with_capacity_takes_the_message() {
    let manager = ConnectionManager::new(UnusedRepo);
    let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
    let forwarder = tokio::spawn(std::future::pending::<()>());
    manager.connections.insert(
        "connection".to_owned(),
        Connection {
            sender,
            abort_handle: forwarder.abort_handle(),
        },
    );

    manager
        .send_message(
            "connection",
            Message::new("test".to_owned(), "first".to_owned()),
        )
        .await
        .unwrap();

    assert!(receiver.recv().await.is_some(), "the message must arrive");
    assert!(
        manager.connections.get("connection").is_some(),
        "a healthy connection must be kept"
    );
}

#[tokio::test(start_paused = true)]
async fn a_saturated_connection_is_dropped_rather_than_waited_on() {
    let manager = ConnectionManager::new(UnusedRepo);
    // Held for the whole test: dropping it would close the channel, which is
    // the already-handled case. This one stays open, full, and never read.
    let (sender, _receiver) = tokio::sync::mpsc::channel(1);
    sender
        .send(OutgoingMessage::Message(Message::new(
            "test".to_owned(),
            "first".to_owned(),
        )))
        .await
        .unwrap();
    let forwarder = tokio::spawn(std::future::pending::<()>());
    manager.connections.insert(
        "connection".to_owned(),
        Connection {
            sender,
            abort_handle: forwarder.abort_handle(),
        },
    );

    // Time only moves here when something awaits it, so a zero elapsed is
    // what "the publisher never waits" looks like.
    let started = tokio::time::Instant::now();
    let result = manager
        .send_message(
            "connection",
            Message::new("test".to_owned(), "second".to_owned()),
        )
        .await;

    assert_eq!(
        started.elapsed(),
        std::time::Duration::ZERO,
        "a publisher must never wait on a consumer"
    );
    assert!(result.is_err(), "a full queue must refuse the message");
    assert!(
        manager.connections.get("connection").is_none(),
        "the saturated connection must be dropped"
    );
    assert!(
        forwarder.await.unwrap_err().is_cancelled(),
        "its forwarder must be aborted"
    );
}

#[tokio::test(start_paused = true)]
async fn removing_a_connection_twice_does_not_wrap_the_count() {
    let manager = ConnectionManager::new(UnusedRepo);
    let (sender, _receiver) = tokio::sync::mpsc::channel(1);
    let forwarder = tokio::spawn(std::future::pending::<()>());
    manager.connections.insert(
        "connection".to_owned(),
        Connection {
            sender,
            abort_handle: forwarder.abort_handle(),
        },
    );
    manager
        .connection_count
        .store(1, std::sync::atomic::Ordering::SeqCst);

    // A refused send removes it, then the socket handler removes it again
    // when it notices the forwarder has ended.
    manager.remove_connection("connection").await.unwrap();
    manager.remove_connection("connection").await.unwrap();

    assert_eq!(
        manager
            .connection_count
            .load(std::sync::atomic::Ordering::SeqCst),
        0,
        "only the removal that took the entry may decrement the count"
    );
}

#[tokio::test(start_paused = true)]
async fn binary_delivery_drops_a_full_connection_without_blocking_the_relay() {
    let manager = ConnectionManager::new(UnusedRepo);
    let (sender, _receiver) = tokio::sync::mpsc::channel(1);
    sender.try_send(OutgoingMessage::Binary(vec![1])).unwrap();
    let forwarder = tokio::spawn(std::future::pending::<()>());
    manager.connections.insert(
        "connection".to_owned(),
        Connection {
            sender,
            abort_handle: forwarder.abort_handle(),
        },
    );

    let result = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        manager.send_binary("connection", vec![2]),
    )
    .await
    .expect("a stalled client must not block other clients' sync replies");
    assert!(result.is_err());
    assert!(!manager.has_connection("connection"));
    assert!(forwarder.await.unwrap_err().is_cancelled());
}

/// Holds no entity entries, so every entity ping misses, and records what
/// the manager writes in response.
#[derive(Default)]
struct EmptyEntityRepo {
    inserted: std::sync::Mutex<Vec<StoredConnectionEntity>>,
    user_pings: std::sync::Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl ConnectionRepo for EmptyEntityRepo {
    async fn insert_connection_entry(
        &self,
        connection: UserEntityConnection<'_>,
    ) -> anyhow::Result<StoredConnectionEntity> {
        let stored = StoredConnectionEntity::from(connection);
        self.inserted.lock().unwrap().push(stored.clone());
        Ok(stored)
    }

    async fn get_entries_by_entity(
        &self,
        _entity: &Entity<'_>,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn get_entries_by_connection_id(
        &self,
        _connection_id: &str,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn get_connection(&self, _connection_id: &str) -> anyhow::Result<StoredConnectionEntity> {
        unimplemented!()
    }

    async fn get_entry_for_connection_entity(
        &self,
        _entity: EntityConnection<'_>,
    ) -> anyhow::Result<Option<StoredConnectionEntity>> {
        unimplemented!()
    }

    async fn remove_all_entries_for_by_connection_id(
        &self,
        _connection_id: &str,
    ) -> anyhow::Result<()> {
        unimplemented!()
    }

    async fn remove_entity(&self, _entity: &EntityConnection<'_>) -> anyhow::Result<()> {
        unimplemented!()
    }

    async fn update_last_entity_ping(
        &self,
        _entity: &EntityConnection<'_>,
        _timestamp: u64,
    ) -> anyhow::Result<Option<StoredConnectionEntity>> {
        Ok(None)
    }

    async fn update_user_connection_last_ping(
        &self,
        connection_id: &str,
        user: &str,
        _timestamp: u64,
    ) -> anyhow::Result<()> {
        self.user_pings
            .lock()
            .unwrap()
            .push((connection_id.to_owned(), user.to_owned()));
        Ok(())
    }
}

#[tokio::test]
async fn a_ping_for_an_entity_with_no_entry_recreates_it() {
    let repo = Arc::new(EmptyEntityRepo::default());
    let manager = ConnectionManager {
        connections: Arc::new(DashMap::new()),
        connection_count: Arc::new(AtomicUsize::new(0)),
        persistence: repo.clone(),
    };

    manager
        .refresh_connection_entity(
            model_entity::EntityType::Document
                .with_entity_str("document-id")
                .with_connection_str("connection-id")
                .with_user_str("macro|viewer@example.com"),
        )
        .await
        .unwrap();

    let inserted = repo.inserted.lock().unwrap();
    assert_eq!(inserted.len(), 1, "the missing entry must be written back");
    assert_eq!(inserted[0].pk, "#document#document-id");
    assert_eq!(inserted[0].sk, "connection-id");
    assert_eq!(inserted[0].user_id, "macro|viewer@example.com");
    assert_eq!(
        *repo.user_pings.lock().unwrap(),
        vec![(
            "connection-id".to_owned(),
            "macro|viewer@example.com".to_owned()
        )]
    );
}
