use crate::user::{
    Connection, Group, UserVertex, create_connections_message, create_user, unpack_connections,
    unpack_users,
};
use contacts_db_client::create_connections;
use model::contacts::{
    AddParticipantsMessageBody, ConnectionsMessage, CreateGroupMessageBody, Message,
};
use sqlx::{Pool, Postgres};
use sqs_worker::SQSWorker;
use std::collections::HashSet;
use tracing::instrument;

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

pub async fn create_group(body: &CreateGroupMessageBody) -> Vec<(String, String)> {
    let group = Group::new(&body.group);

    group
        .generate()
        .into_iter()
        .map(|e| (e.a.data.id.to_lowercase(), e.b.data.id.to_lowercase()))
        .collect()
}

#[derive(Debug)]
pub struct MessageQueue {
    sqs: SQSWorker,
    db: Pool<Postgres>,
}

async fn connections_message_handler(conmsg: &ConnectionsMessage, queue: &MessageQueue) {
    let users = unpack_users(conmsg).await;
    let connections = unpack_connections(conmsg, &users).await;
    let db = &queue.db;

    tracing::info!("Writing connections to DB");
    let mut transaction = db.begin().await.unwrap();
    let connection_pairs: Vec<(String, String)> = connections
        .into_iter()
        .map(|e| (e.a.data.id.to_string(), e.b.data.id.to_string()))
        .collect();
    let _ = create_connections(&mut transaction, connection_pairs)
        .await
        .inspect_err(|e| {
            tracing::error!("couldn't create connections: {:?}", e);
        });
    let _ = transaction.commit().await.inspect_err(|e| {
        tracing::error!("transaction error: {:?}", e);
    });
}

#[instrument(level = "info", skip(queue))]
async fn add_participants_handler(body: &AddParticipantsMessageBody, queue: &MessageQueue) {
    tracing::info!("adding participants");
    let db = &queue.db;
    let connection_pairs = add_participants(body).await;
    let mut transaction = db.begin().await.unwrap();
    let _ = create_connections(&mut transaction, connection_pairs)
        .await
        .inspect_err(|e| {
            tracing::error!("couldn't create connections: {:?}", e);
        });
    let _ = transaction.commit().await.inspect_err(|e| {
        tracing::error!("transaction error: {:?}", e);
    });
}

#[instrument(level = "info", skip(queue))]
async fn create_group_handler(body: &CreateGroupMessageBody, queue: &MessageQueue) {
    tracing::info!("creating group");
    let db = &queue.db;
    let connection_pairs = create_group(body).await;
    let mut transaction = db.begin().await.unwrap();
    let _ = create_connections(&mut transaction, connection_pairs)
        .await
        .inspect_err(|e| {
            tracing::error!("couldn't create connections: {:?}", e);
        });
    let _ = transaction.commit().await.inspect_err(|e| {
        tracing::error!("transaction error: {:?}", e);
    });
}

#[cfg(test)]
fn connections_message_from_message(msg: Message) -> Option<ConnectionsMessage> {
    match msg {
        Message::AddConnection(con) => Some(con),
        _ => None,
    }
}

fn message_from_json(body: &str) -> Option<Message> {
    serde_json::from_str(body).ok()
}

async fn message_from_sqs(msg: &aws_sdk_sqs::types::Message) -> Option<Message> {
    if let Some(body) = msg.body.as_ref() {
        message_from_json(body)
    } else {
        None
    }
}

pub async fn process(msg: &Message, queue: &MessageQueue) -> anyhow::Result<()> {
    match msg {
        Message::AddConnection(con) => connections_message_handler(con, queue).await,
        Message::AddParticipants(body) => add_participants_handler(body, queue).await,
        Message::CreateGroup(body) => create_group_handler(body, queue).await,
    };
    Ok(())
}

#[allow(dead_code)]
impl MessageQueue {
    pub fn new(sqs: SQSWorker, db: Pool<Postgres>) -> MessageQueue {
        MessageQueue { sqs, db }
    }

    #[instrument(level = "info", skip(self))]
    pub async fn poll(&mut self) {
        let sqs = &self.sqs;
        tracing::info!("initiated notification worker");
        loop {
            tracing::trace!("polling for messages");
            match sqs.receive_messages().await {
                Ok(messages) => {
                    if messages.is_empty() {
                        tracing::trace!("no messages found");
                        continue;
                    }
                    for message in messages {
                        match self.process_message(&message).await {
                            Ok(_) => (),
                            Err(e) => {
                                tracing::error!(error=?e, "error processing message");
                            }
                        };
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, "error receiving messages");
                }
            }
        }
    }

    #[instrument(level = "info", skip(self, message))]
    pub async fn process_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> anyhow::Result<()> {
        self.parse_message(message).await?;
        self.cleanup_message(message).await?;
        Ok(())
    }

    #[allow(dead_code)]
    #[instrument(level = "info", skip(sqs_message, self))]
    pub async fn parse_message(
        &self,
        sqs_message: &aws_sdk_sqs::types::Message,
    ) -> anyhow::Result<()> {
        let message = message_from_sqs(sqs_message).await;
        if message.is_some() {
            let message = message.unwrap();
            let _ = process(&message, self).await;
        } else {
            tracing::info!("Message could not be processed properly");
        }
        Ok(())
    }

    async fn cleanup_message(&self, message: &aws_sdk_sqs::types::Message) -> anyhow::Result<()> {
        let sqs = &self.sqs;
        if let Some(receipt_handle) = message.receipt_handle.as_ref() {
            tracing::trace!(message_id=?message.message_id, message_receipt_handle=?receipt_handle, "deleting message");
            sqs.delete_message(receipt_handle).await?;
        }
        Ok(())
    }
}

#[allow(dead_code)]
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
mod tests {
    use super::*;
    use sqlx::PgPool;
    use std::collections::HashSet;

    async fn sqs_dummy() -> SQSWorker {
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await;
        let client = aws_sdk_sqs::Client::new(&config);
        SQSWorker::new(client, "nothing".to_string(), 1, 1)
    }

    #[test]
    fn test_deserialize_connections_message() {
        let input_json = include_str!("../tests/fixtures/add_connection.json");

        let message: Message = message_from_json(input_json).unwrap();
        let conn_msg = connections_message_from_message(message);
        assert!(conn_msg.is_some());
    }

    fn generate_sqs_message() -> aws_sdk_sqs::types::Message {
        let input_json = include_str!("../tests/fixtures/add_connection.json");
        aws_sdk_sqs::types::Message::builder()
            .set_body(Some(input_json.to_string()))
            .build()
    }

    #[tokio::test]
    async fn test_message_from_aws_sqs() {
        let sqs_message = generate_sqs_message();
        let message = message_from_sqs(&sqs_message).await;

        assert!(message.is_some(), "Could not parse body from sqs message");

        let conn_msg = connections_message_from_message(message.unwrap());
        assert!(conn_msg.is_some());
    }

    #[tokio::test]
    async fn test_add_user_to_group() {
        let group: Vec<String> = [
            "ff038d36-1aef-461a-8aa8-34001fa1abad",
            "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
            "d44caada-98c0-49eb-ab20-6851b824983a",
            "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
            "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
            "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
            "9effe035-bb12-4fcc-b479-800e1c2551a8",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let new_user = "ae2c090c-e478-4454-a001-3df458bf1fe4";

        let msg = add_user_to_group(&group, new_user).await;

        let msg: Message = serde_json::from_str(&msg).expect("could not parse JSON");

        let body = match msg {
            Message::AddConnection(body) => Some(body),
            _ => None,
        };

        assert!(body.is_some());

        let body = body.unwrap();

        assert_eq!(body.connections.len(), group.len());
    }

    #[tokio::test]
    async fn test_user_already_in_group() {
        let group: Vec<String> = [
            "ff038d36-1aef-461a-8aa8-34001fa1abad",
            "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
            "d44caada-98c0-49eb-ab20-6851b824983a",
            "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
            "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
            "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
            "9effe035-bb12-4fcc-b479-800e1c2551a8",
            "ae2c090c-e478-4454-a001-3df458bf1fe4",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let new_user = "ae2c090c-e478-4454-a001-3df458bf1fe4";

        let msg = add_user_to_group(&group, new_user).await;

        let msg: Message = serde_json::from_str(&msg).expect("could not parse JSON");

        let body = match msg {
            Message::AddConnection(body) => Some(body),
            _ => None,
        };

        assert!(body.is_some());

        let body = body.unwrap();

        assert_eq!(body.connections.len(), 0);
    }

    #[sqlx::test]
    #[ignore]
    async fn test_connections_message_handler(pool: PgPool) -> sqlx::Result<()> {
        let input_json = include_str!("../tests/fixtures/connections_message.json");

        let message: Message = message_from_json(input_json).unwrap();
        let db = pool.clone();
        let sqs = sqs_dummy().await;
        let queue = MessageQueue::new(sqs, db);
        match message {
            Message::AddConnection(con) => connections_message_handler(&con, &queue).await,
            _ => panic!("Message not matched properly"),
        };
        let user = "AE2C090C-E478-4454-A001-3DF458BF1FE4";
        let contacts = contacts_db_client::get_contacts(&pool, user).await;
        assert!(contacts.is_ok());
        let contacts = contacts.unwrap();
        dbg!(&contacts);
        assert_eq!(contacts.len(), 7);

        let expectations: HashSet<String> = [
            "FF038D36-1AEF-461A-8AA8-34001FA1ABAD",
            "C3F4D826-F8FD-478A-AA66-B5B6BB370CBC",
            "D44CAADA-98C0-49EB-AB20-6851B824983A",
            "5AB8C770-F2CB-4C6C-BC08-AE64569E324C",
            "79A5557B-7827-4E2E-A6AE-F0935CDB762E",
            "C3B1970F-18EE-4DFA-B5FB-E8240E28E51D",
            "9EFFE035-BB12-4FCC-B479-800E1C2551A8",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let reality: HashSet<String> = contacts.into_iter().collect();

        assert_eq!(&expectations, &reality);

        Ok(())
    }

    #[tokio::test]
    async fn test_add_participants_message_body() {
        // The full group: it's assumed the participants are in here already
        // And that this will always be a correct message
        let group = ["paul", "john", "ringo", "george"];
        // We've just add ringo and george to the group
        let participants = ["ringo", "george"];

        // one participant to group of 4 (including self): 3 new connections
        // two new participants: 3 new connections, plus 2
        // (make sure to account for redundant connection)
        let expected_nconnections = 5;

        let body = AddParticipantsMessageBody {
            group: group.into_iter().map(String::from).collect(),
            participants: participants.into_iter().map(String::from).collect(),
            group_id: None,
        };

        let connections = add_participants(&body).await;

        assert_eq!(connections.len(), expected_nconnections);
    }

    async fn add_participants_handler_tester(
        pool: PgPool,
        body: AddParticipantsMessageBody,
    ) -> sqlx::Result<()> {
        let message: Message = Message::AddParticipants(body);
        let db = pool.clone();
        let sqs = sqs_dummy().await;
        let queue = MessageQueue::new(sqs, db);
        match message {
            Message::AddParticipants(body) => add_participants_handler(&body, &queue).await,
            _ => panic!("Message not matched properly"),
        };

        let user = "ringo";
        let contacts = contacts_db_client::get_contacts(&pool, user).await;

        assert!(contacts.is_ok());
        let contacts = contacts.unwrap();
        dbg!(&contacts);

        assert_eq!(contacts.len(), 3);

        let expectations: HashSet<String> = ["john", "paul", "george"]
            .into_iter()
            .map(String::from)
            .collect();

        let reality: HashSet<String> = contacts.into_iter().collect();

        assert_eq!(&expectations, &reality);

        Ok(())
    }

    #[sqlx::test]
    #[ignore]
    async fn test_integration_add_participants_handler(pool: PgPool) -> sqlx::Result<()> {
        let group = ["paul", "john", "ringo", "george"];
        let participants = ["ringo", "george"];

        let body = AddParticipantsMessageBody {
            group: group.into_iter().map(String::from).collect(),
            participants: participants.into_iter().map(String::from).collect(),
            group_id: None,
        };
        add_participants_handler_tester(pool, body).await
    }

    // Add participants to the group, but the participants aren't in the group yet
    #[sqlx::test]
    #[ignore]
    async fn test_integration_add_participants_handler_pre_participants(
        pool: PgPool,
    ) -> sqlx::Result<()> {
        let group = ["paul", "john"];
        let participants = ["ringo", "george"];

        let body = AddParticipantsMessageBody {
            group: group.into_iter().map(String::from).collect(),
            participants: participants.into_iter().map(String::from).collect(),
            group_id: None,
        };

        add_participants_handler_tester(pool, body).await
    }

    #[tokio::test]
    async fn test_create_group_message_body() {
        let group = ["paul", "john", "ringo", "george"];
        let n = group.len();

        let expected_nconnections = n * (n - 1) / 2;

        let body = CreateGroupMessageBody {
            group: group.into_iter().map(String::from).collect(),
            group_id: None,
        };

        let connections = create_group(&body).await;

        assert_eq!(connections.len(), expected_nconnections);
    }

    #[sqlx::test]
    #[ignore]
    async fn test_integration_create_group_handler(pool: PgPool) -> sqlx::Result<()> {
        let group = ["paul", "john", "ringo", "george"];

        let body = CreateGroupMessageBody {
            group: group.into_iter().map(String::from).collect(),
            group_id: None,
        };

        let message: Message = Message::CreateGroup(body);
        let db = pool.clone();
        let sqs = sqs_dummy().await;
        let queue = MessageQueue::new(sqs, db);
        match message {
            Message::CreateGroup(body) => create_group_handler(&body, &queue).await,
            _ => panic!("Message not matched properly"),
        };

        let user = "paul";
        let contacts = contacts_db_client::get_contacts(&pool, user).await;

        assert!(contacts.is_ok());
        let contacts = contacts.unwrap();
        dbg!(&contacts);

        assert_eq!(contacts.len(), 3);

        let expectations: HashSet<String> = ["john", "ringo", "george"]
            .into_iter()
            .map(String::from)
            .collect();

        let reality: HashSet<String> = contacts.into_iter().collect();

        assert_eq!(&expectations, &reality);

        Ok(())
    }

    #[tokio::test]
    async fn test_add_participants_lowercase() {
        // full group, including new participants
        let full_group = [
            "macro|paul@macro.com",
            "macro|john@macro.com",
            "macro|ringo@macro.com",
            "macro|george@macro.com",
        ];
        // We've just add ringo and george to the group, but they case is different
        let new_participants = ["macro|Ringo@macro.com", "macro|George@macro.com"];

        let body = AddParticipantsMessageBody {
            group: full_group.into_iter().map(String::from).collect(),
            participants: new_participants.into_iter().map(String::from).collect(),
            group_id: None,
        };

        // one participant to group of 4 (including self): 3 new connections
        // two new participants: 3 new connections, plus 2
        // (make sure to account for redundant connection)
        let expected_nconnections = 5;

        let connections = add_participants(&body).await;
        assert_eq!(connections.len(), expected_nconnections);
    }
    #[tokio::test]
    async fn test_create_group_lowercase() {
        let group = [
            "macro|Paul@macro.com",
            "macro|john@macro.com",
            "macro|Ringo@macro.com",
            "macro|george@macro.com",
        ];
        let n = group.len();

        let body = CreateGroupMessageBody {
            group: group.into_iter().map(String::from).collect(),
            group_id: None,
        };

        let connections = create_group(&body).await;

        let expected: HashSet<String> = [
            "macro|paul@macro.com",
            "macro|john@macro.com",
            "macro|ringo@macro.com",
            "macro|george@macro.com",
        ]
        .to_vec()
        .into_iter()
        .map(|s| s.to_string())
        .collect();

        let mut reality: HashSet<String> = HashSet::new();

        for con in connections {
            reality.insert(con.0);
            reality.insert(con.1);
        }

        let reality: HashSet<String> = reality.into_iter().collect();

        assert_eq!(expected, reality);
    }
}
