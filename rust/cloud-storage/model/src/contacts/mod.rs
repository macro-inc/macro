use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct ConnectionsMessage {
    pub users: Vec<String>,
    pub connections: Vec<(usize, usize)>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AddParticipantsMessageBody {
    pub participants: Vec<String>,
    pub group: Vec<String>,
    pub group_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateGroupMessageBody {
    pub group: Vec<String>,
    pub group_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "body")]
pub enum Message {
    #[serde(rename = "add_connection")]
    AddConnection(ConnectionsMessage),
    #[serde(rename = "add_participants")]
    AddParticipants(AddParticipantsMessageBody),
    #[serde(rename = "create_group")]
    CreateGroup(CreateGroupMessageBody),
}
