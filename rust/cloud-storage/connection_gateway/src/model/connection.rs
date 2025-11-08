use crate::{config::Config, context::ApiContext};
use model::user::UserContext;
use model_entity::{EntityType, UserEntityConnection};
use std::time::{SystemTime, UNIX_EPOCH};
use utoipa::ToSchema;

use super::message::OutgoingMessage;
use tokio::{sync::mpsc::Sender, task::AbortHandle};

pub struct Connection {
    pub sender: Sender<OutgoingMessage>,
    pub abort_handle: AbortHandle,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, ToSchema)]
pub struct StoredConnectionEntity {
    #[serde(rename = "PK")]
    pub pk: String,
    #[serde(rename = "SK")]
    pub sk: String,
    /// type of the entity
    pub entity_type: EntityType,
    /// id of the entity
    pub entity_id: String,
    /// id of the connection
    pub connection_id: String,
    /// timestamp when the connection was initiated
    pub created_at: u64,
    /// user id to whom the conneciton belongs to
    pub user_id: String,
    /// the timestamp of the last ping
    pub last_ping: Option<u64>,
}

impl StoredConnectionEntity {
    pub fn is_active_in_threshold(&self, threshold: Option<u64>) -> bool {
        let current_timestamp: u64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        match (threshold, self.last_ping) {
            // There is a threshold and the last ping is older than the threshold
            (Some(t), Some(last_ping)) => (current_timestamp - last_ping) < t,
            // There is no threshold compare the current timestamp with the created_at
            (Some(t), None) => (current_timestamp - self.created_at) < t,
            // No threshold then just return true
            _ => true,
        }
    }
}

impl<'a> From<UserEntityConnection<'a>> for StoredConnectionEntity {
    fn from(new_connection: UserEntityConnection<'a>) -> Self {
        Self {
            pk: format!(
                "#{}#{}",
                new_connection.extra.extra.entity_type, new_connection.extra.extra.entity_id
            ),
            sk: new_connection.extra.connection_id.to_string(),
            entity_type: new_connection.extra.extra.entity_type,
            entity_id: new_connection.extra.extra.entity_id.into_owned(),
            connection_id: new_connection.extra.connection_id.into_owned(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            user_id: new_connection.user_id.into_owned(),
            last_ping: None,
        }
    }
}

#[derive(Clone, Copy)]
pub struct ConnectionContext<'c> {
    pub api_context: &'c ApiContext,
    pub config: &'c Config,
    pub user_context: &'c UserContext,
    pub connection_id: &'c str,
}

impl AsRef<ApiContext> for ConnectionContext<'_> {
    fn as_ref(&self) -> &ApiContext {
        self.api_context
    }
}

impl AsRef<Config> for ConnectionContext<'_> {
    fn as_ref(&self) -> &Config {
        self.config
    }
}
