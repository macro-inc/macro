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
async fn a_saturated_connection_reports_slow_without_cancelling_the_send() {
    let manager = ConnectionManager::new(UnusedRepo);
    let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
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

    let send = tokio::spawn({
        let manager = manager.clone();
        async move {
            manager
                .send_message(
                    "connection",
                    Message::new("test".to_owned(), "second".to_owned()),
                )
                .await
        }
    });
    tokio::task::yield_now().await;
    tokio::time::advance(SLOW_WEBSOCKET_OPERATION_THRESHOLD).await;
    assert!(!send.is_finished(), "telemetry must not cancel the send");

    receiver.recv().await.unwrap();
    send.await.unwrap().unwrap();
}
