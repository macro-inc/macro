use crate::model::{
    connection::{Connection, StoredConnectionEntity},
    message::{Message, OutgoingMessage},
};
use anyhow::Result;
use axum::async_trait;
use dashmap::DashMap;
use model_entity::{Entity, EntityConnection, UserEntityConnection};
use std::{
    sync::{Arc, atomic::AtomicUsize},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{sync::mpsc::Sender, task::AbortHandle};

#[async_trait]
pub trait ConnectionGatewayPersistence: Send + Sync {
    /// Inserts a new [StoredConnectionEntity] into storage
    async fn insert_connection_entry(
        &self,
        connection: UserEntityConnection<'_>,
    ) -> anyhow::Result<StoredConnectionEntity>;

    /// Get a list of [StoredConnectionEntity] by an entity type and id
    /// Multiple connections can be associated with an entity
    async fn get_entries_by_entity(
        &self,
        entity: &Entity<'_>,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>>;

    /// Gets all entries for a given `connection_id`
    async fn get_entries_by_connection_id(
        &self,
        connection_id: &str,
    ) -> anyhow::Result<Vec<StoredConnectionEntity>>;

    /// Gets a connection by a connection_id
    /// This returns the top level connection item for a user
    /// so it would return a #user#<user_id> with connection_id
    async fn get_connection(&self, connection_id: &str) -> anyhow::Result<StoredConnectionEntity>;

    async fn get_entry_for_connection_entity(
        &self,
        entity: EntityConnection<'_>,
    ) -> anyhow::Result<Option<StoredConnectionEntity>>;

    /// Deletes all [StoredConnectionEntity] entries for a given `connection_id`
    async fn remove_all_entries_for_by_connection_id(
        &self,
        connection_id: &str,
    ) -> anyhow::Result<()>;

    /// Deletes a [StoredConnectionEntity] from the database
    async fn remove_entity(&self, entity: &EntityConnection<'_>) -> anyhow::Result<()>;

    /// Updates the last_ping timestamp for a given connection entity
    async fn update_last_entity_ping(
        &self,
        entity: &EntityConnection<'_>,
        timestamp: u64,
    ) -> anyhow::Result<StoredConnectionEntity>;

    /// Updates the last_ping timestamp for a given top level connection
    async fn update_user_connection_last_ping(
        &self,
        connection_id: &str,
        user: &str,
        timestamp: u64,
    ) -> anyhow::Result<()>;
}

#[derive(Clone)]
pub struct ConnectionManager {
    pub connections: Arc<DashMap<String, Connection>>,
    pub connection_count: Arc<AtomicUsize>,
    pub persistence: Arc<dyn ConnectionGatewayPersistence>,
}

impl ConnectionManager {
    pub fn new(persistence: impl ConnectionGatewayPersistence + 'static) -> Self {
        tracing::info!("creating new connection manager");
        Self {
            connections: Arc::new(DashMap::new()),
            connection_count: Arc::new(AtomicUsize::new(0)),
            persistence: Arc::new(persistence),
        }
    }

    /// Checks wether or not a given connection_id exists in the connection manager
    /// A connection_id might still exists in the database, but it is not handled by this instance
    /// of the connection manager.
    pub fn has_connection(&self, id: &str) -> bool {
        self.connections.contains_key(id)
    }

    /// Initiate a new connection for a user
    /// A connection represents a users activity in a single tab/session
    /// A connection_id is unique to a user, but it can be shared across multiple
    /// connection_entities that are associated with the same user.
    pub async fn add_connection(
        &self,
        connection: UserEntityConnection<'_>,
        sender: Sender<OutgoingMessage>,
        abort_handle: AbortHandle,
    ) -> Result<()> {
        if self
            .connections
            .contains_key(connection.extra.connection_id.as_ref())
        {
            tracing::warn!("connection already exists for connection id");
            return Ok(());
        }
        self.connections.insert(
            connection.extra.connection_id.to_string(),
            Connection {
                sender,
                abort_handle,
            },
        );
        self.connection_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        self.persistence.insert_connection_entry(connection).await?;

        Ok(())
    }

    /// Adds a new connection entity associated with a user connection
    /// A connection entity can represetn a users activity on a document, chat, channel etc...
    #[tracing::instrument(err, skip(self))]
    pub async fn add_connection_entity(
        &self,
        connection_entity: UserEntityConnection<'_>,
    ) -> Result<()> {
        self.persistence
            .insert_connection_entry(connection_entity)
            .await?;

        Ok(())
    }

    /// Removes all associated connection entities for the given connection id
    /// IMPORTANT: this removes all entities associated with the connection_id
    /// and not just a specific entity like document, chat, channel activity.
    pub async fn remove_connection(&self, connection_id: &str) -> Result<()> {
        // if the connection exists, then we kill the task
        // that forwards the messages to the websocket
        if let Some(connection) = self.connections.get(connection_id) {
            // Only abort the task if it has not already been aborted
            if !connection.abort_handle.is_finished() {
                connection.abort_handle.abort();
            }
        }
        self.connections.remove(connection_id);
        self.connection_count
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);

        self.persistence
            .remove_all_entries_for_by_connection_id(connection_id)
            .await?;

        Ok(())
    }

    /// Removes an individual entity associated with a connection_id and entity
    /// The actual connection_id associated with the user is not removed
    /// Just the single instance of the entity associated with a document, chat, channel etc...
    #[tracing::instrument(err, skip(self))]
    pub async fn remove_connection_entity(&self, entity: &EntityConnection<'_>) -> Result<()> {
        self.persistence.remove_entity(entity).await?;

        Ok(())
    }

    /// Updates the last_ping timestamp for a given connection entity
    /// This also propogates to the last_ping timestamp for the top level user connection
    #[tracing::instrument(err, skip(self))]
    pub async fn refresh_connection_entity(&self, entity: &EntityConnection<'_>) -> Result<()> {
        let updated_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let connection_id = entity.connection_id.clone();

        // Update the last_ping on the specific entity associated with the connection_id
        let entity = self
            .persistence
            .update_last_entity_ping(entity, updated_timestamp)
            .await?;

        // // Update the user connection last_ping
        self.persistence
            .update_user_connection_last_ping(&connection_id, &entity.user_id, updated_timestamp)
            .await?;

        Ok(())
    }

    /// Sends a message to a a connection
    /// If the connection is not found, or dropped, then we remove the connection id
    /// from the map, and should kill (TODO:) any remaining tasks associated with the connection
    pub async fn send_message(&self, id: &str, message: Message) -> Result<()> {
        let sender = match self.connections.get(id) {
            Some(connection) => connection.sender.clone(),
            None => return Err(anyhow::anyhow!("connection not found")),
        };

        if let Err(err) = sender.send(OutgoingMessage::Message(message)).await {
            self.remove_connection(id).await?;
            return Err(anyhow::anyhow!("failed to send message: {}", err));
        }

        Ok(())
    }

    pub fn get_entries_by_entity<'a>(
        &'a self,
        entity: &'a Entity<'a>,
    ) -> impl Future<Output = Result<Vec<StoredConnectionEntity>>> + 'a {
        self.persistence.get_entries_by_entity(entity)
    }
}
