use super::*;

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
    ) -> anyhow::Result<StoredConnectionEntity> {
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
