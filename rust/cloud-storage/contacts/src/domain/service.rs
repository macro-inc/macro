use crate::domain::models::user::{
    Connection, Group, UserVertex, create_connections_message, create_user, unpack_connections,
    unpack_users,
};
use crate::domain::ports::{ContactsNotifier, ContactsRepository};
use crate::domain::models::messages::{AddParticipantsMessageBody, ConnectionsMessage, CreateGroupMessageBody, Message};
use std::collections::HashSet;
use tracing::instrument;

/// Domain service combining a repository and notifier to manage contacts.
pub struct ContactsDomainService<R, N> {
    /// The contacts repository for data persistence.
    pub repository: R,
    /// The notifier for real-time contact invalidation.
    pub notifier: N,
}

impl<R: ContactsRepository, N: ContactsNotifier> ContactsDomainService<R, N> {
    /// Queries a user's contacts from the repository.
    pub async fn query_contacts(&self, user_id: &str) -> Option<Vec<String>> {
        self.repository.get_contacts(user_id).await.ok()
    }

    /// Adds a single contact connection between two users.
    pub async fn add_contact(&self, caller: &str, recipient: &str) -> Result<(), anyhow::Error> {
        self.repository
            .create_connections(vec![(caller.to_string(), recipient.to_string())])
            .await
    }

    /// Processes an SQS message by routing it to the appropriate handler.
    pub async fn process_message(&self, msg: &Message) {
        match msg {
            Message::AddConnection(con) => self.connections_message_handler(con).await,
            Message::AddParticipants(body) => self.add_participants_handler(body).await,
            Message::CreateGroup(body) => self.create_group_handler(body).await,
        }
    }

    async fn connections_message_handler(&self, conmsg: &ConnectionsMessage) {
        let users = unpack_users(conmsg).await;
        let connections = unpack_connections(conmsg, &users).await;

        tracing::info!("Writing connections to DB");
        let connection_pairs: Vec<(String, String)> = connections
            .into_iter()
            .map(|e| (e.a.data.id.to_string(), e.b.data.id.to_string()))
            .collect();
        if let Err(e) = self.repository.create_connections(connection_pairs.clone()).await {
            tracing::error!(error=?e, "couldn't create connections");
            return;
        }

        self.notify_affected_users(&connection_pairs).await;
    }

    #[instrument(skip(self))]
    async fn add_participants_handler(&self, body: &AddParticipantsMessageBody) {
        tracing::info!("adding participants");
        let connection_pairs = add_participants(body).await;
        if let Err(e) = self.repository.create_connections(connection_pairs.clone()).await {
            tracing::error!(error=?e, "couldn't create connections");
            return;
        }

        self.notify_affected_users(&connection_pairs).await;
    }

    #[instrument(skip(self))]
    async fn create_group_handler(&self, body: &CreateGroupMessageBody) {
        tracing::info!("creating group");
        let connection_pairs = create_group(body).await;
        if let Err(e) = self.repository.create_connections(connection_pairs.clone()).await {
            tracing::error!(error=?e, "couldn't create connections");
            return;
        }

        self.notify_affected_users(&connection_pairs).await;
    }

    async fn notify_affected_users(&self, connection_pairs: &[(String, String)]) {
        let mut user_ids: HashSet<&str> = HashSet::new();
        for (user1, user2) in connection_pairs {
            user_ids.insert(user1);
            user_ids.insert(user2);
        }
        let user_ids: Vec<String> = user_ids.into_iter().map(String::from).collect();
        self.notifier.invalidate_contacts_for_users(&user_ids).await;
    }
}

/// Computes connection pairs when adding participants to an existing group.
pub async fn add_participants(body: &AddParticipantsMessageBody) -> Vec<(String, String)> {
    // make sure to tack on participants in case they aren't in the group body.
    // The underlying HashSet will ensure there are no duplicates
    let group = Group::new(&body.group).append_participants(&body.participants);
    let mut connections: HashSet<(String, String)> = HashSet::new();
    for participant in &body.participants {
        let user = UserVertex::generate(participant);
        for con in group.append(&user) {
            let pair = (con.a.data.id.to_lowercase(), con.b.data.id.to_lowercase());

            // HACK: skip self-connections
            if pair.0 != pair.1 {
                let pair = if pair.0 > pair.1 {
                    (pair.1, pair.0)
                } else {
                    pair
                };
                connections.insert(pair);
            }
        }
    }
    connections.into_iter().collect()
}

/// Generates all pairwise connections for a new group.
pub async fn create_group(body: &CreateGroupMessageBody) -> Vec<(String, String)> {
    let group = Group::new(&body.group);

    group
        .generate()
        .into_iter()
        .map(|e| (e.a.data.id.to_lowercase(), e.b.data.id.to_lowercase()))
        .collect()
}

/// Generates a serialized add_connection message for adding a single user to a group.
pub async fn add_user_to_group(group: &[String], user: &str) -> String {
    // Convert string list to group
    let mut group = Group::new(group);
    // Convert user string to user vertex
    let user: UserVertex = UserVertex::new(create_user(user));
    // Apply append operation
    let con: Vec<Connection> = if group.participants.contains(&user) {
        vec![]
    } else {
        // HACK: insert user before calling append, then remove self-referenced edge
        group.participants.insert(user.clone());
        group
            .append(&user)
            .into_iter()
            .filter(|e| e.a.data.id != e.b.data.id)
            .collect()
    };
    // Convert results to message
    let body = create_connections_message(&group, &con);
    let msg = Message::AddConnection(body);
    // Serialize message
    serde_json::to_string(&msg).unwrap()
}

#[cfg(test)]
mod test;
