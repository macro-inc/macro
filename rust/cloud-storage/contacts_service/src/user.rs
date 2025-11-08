use crate::graph;
use crate::graph::{Edge, Vertex};
use model::contacts::ConnectionsMessage;
use model::document::ID;
use std::collections::{HashMap, HashSet};

pub type User = ID;

pub fn create_user(id: &str) -> User {
    User { id: id.to_string() }
}

#[allow(dead_code)]
#[derive(Default, Debug)]
pub struct Group {
    pub participants: HashSet<Vertex<User>>,
}

pub type Connection<'a> = Edge<'a, User>;
pub type UserVertex = Vertex<User>;

impl Group {
    pub fn append<'a, 'b>(&'a self, user: &'b Vertex<User>) -> Vec<Connection<'b>>
    where
        'a: 'b,
    {
        graph::append(&self.participants, user)
    }

    #[allow(dead_code)]
    pub fn generate(&self) -> Vec<Connection<'_>> {
        graph::generate(&self.participants)
    }

    pub fn new(group: &[String]) -> Self {
        Self::default().append_participants(group)
    }

    pub fn append_participants(mut self, group: &[String]) -> Group {
        for user in group {
            self.participants.insert(Vertex::new(create_user(user)));
        }
        self
    }
}

pub fn create_connections_message(group: &Group, connections: &[Connection]) -> ConnectionsMessage {
    let mut users = vec![];
    let mut user_to_index: HashMap<String, usize> = HashMap::new();

    for user in &group.participants {
        let id = user.data.id.clone();
        let pos = users.len();
        users.push(id);
        user_to_index.insert(users[pos].clone(), pos);
    }

    let mut connection_references = vec![];

    for con in connections {
        let user_a = &con.a.data.id;
        let user_b = &con.b.data.id;

        // TODO: error handling
        let user_a_index = if let Some(idx) = user_to_index.get(user_a) {
            idx
        } else {
            panic!("Could not find user '{}'", user_a);
        };
        let user_b_index = user_to_index.get(user_b).unwrap();
        connection_references.push((*user_a_index, *user_b_index));
    }

    ConnectionsMessage {
        users,
        connections: connection_references,
    }
}

pub async fn unpack_users(msg: &ConnectionsMessage) -> Vec<Vertex<User>> {
    let mut vertex_list = vec![];

    for user in &msg.users {
        let vtx = Vertex::new(User {
            id: user.to_string(),
        });
        vertex_list.push(vtx);
    }

    vertex_list
}

pub async fn unpack_connections<'a, 'b>(
    msg: &'a ConnectionsMessage,
    users: &'b [Vertex<User>],
) -> Vec<Connection<'b>>
where
    'a: 'b,
{
    let mut connections = vec![];

    for con in &msg.connections {
        connections.push(Connection {
            a: &users[con.0],
            b: &users[con.1],
        })
    }

    connections
}

#[cfg(test)]
async fn unpack<'a, 'b>(
    msg: &'a ConnectionsMessage,
    users: &'b Vec<UserVertex>,
) -> (Group, Vec<Connection<'b>>)
where
    'a: 'b,
{
    let mut group = Group::default();
    for user in users {
        group.participants.insert(user.clone());
    }

    let connections = unpack_connections(msg, users).await;

    (group, connections)
}

#[allow(dead_code)]
impl UserVertex {
    pub fn generate(name: &str) -> Self {
        Vertex::new(create_user(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_test_users() -> Vec<Vertex<User>> {
        let ulist: Vec<Vertex<User>> = [
            ("oceanus", "ff038d36-1aef-461a-8aa8-34001fa1abad"),
            ("tethys", "5ab8c770-f2cb-4c6c-bc08-ae64569e324c"),
            ("hyperion", "d44caada-98c0-49eb-ab20-6851b824983a"),
            ("theia", "79a5557b-7827-4e2e-a6ae-f0935cdb762e"),
            ("coeus", "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc"),
            ("phoebe", "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d"),
            ("cornus", "9effe035-bb12-4fcc-b479-800e1c2551a8"),
            ("rhea", "ae2c090c-e478-4454-a001-3df458bf1fe4"),
            ("mnemosyne", "b4e6267e-83c4-427d-88f4-40483f4b97e6"),
            ("themis", "f5263664-b82f-41f5-bd4c-65e445f43e54"),
            ("crius", "083a6148-26c6-4a59-9106-dbfb82579edc"),
            ("iapetus", "6be3aef7-0701-4f0c-be6e-750f23ae953c"),
        ]
        .iter()
        .map(|(_, uuid)| {
            Vertex::new(User {
                id: uuid.to_string(),
            })
        })
        .collect();

        ulist
    }

    #[test]
    fn test_group() {
        let mut g = Group::default();
        let users = generate_test_users();
        let bob = Vertex::new(User {
            id: "52D09596-7F05-4956-B64C-977AB9E334F9".to_string(),
        });

        let nusers = users.len();
        // Populate group with some users
        for user in users {
            g.participants.insert(user);
        }

        // append a new user
        let new_connections = g.append(&bob);

        assert_eq!(new_connections.len(), nusers);
    }

    #[test]
    // sanity test for group.generate(), which wraps graph::generate()
    fn test_group_generate() {
        let mut g = Group::default();
        let users = generate_test_users();

        let nusers = users.len();
        let nconnections = nusers * (nusers - 1) / 2;

        // Populate group with some users
        for user in users {
            g.participants.insert(user);
        }

        let connections = g.generate();

        assert_eq!(connections.len(), nconnections);
    }

    #[test]
    // sanity test for creating ConnectionsMessage
    fn test_connections_message() {
        let mut g = Group::default();
        let users = generate_test_users();

        let nusers = users.len();
        let nconnections = nusers * (nusers - 1) / 2;

        // Populate group with some users
        for user in users {
            g.participants.insert(user);
        }
        let connections = g.generate();
        let msg = create_connections_message(&g, &connections);

        assert_eq!(msg.users.len(), nusers);
        assert_eq!(msg.connections.len(), nconnections);
    }
    #[tokio::test]
    // make sure ConnectionsMessage can unpack itself into
    // a Group and connetions
    async fn test_connections_message_unpack() {
        let mut g = Group::default();
        let users = generate_test_users();

        let nusers = users.len();
        let nconnections = nusers * (nusers - 1) / 2;

        // Populate group with some users
        for user in users {
            g.participants.insert(user);
        }
        let connections = g.generate();
        let msg = create_connections_message(&g, &connections);

        let new_users = unpack_users(&msg).await;
        let (new_group, new_connections) = unpack(&msg, &new_users).await;

        // Make sure all particiapnts are accounted for
        for user in &g.participants {
            assert!(
                new_group.participants.contains(user),
                "Could not find user {}",
                user.data.id
            );
        }

        assert_eq!(new_connections.len(), nconnections);
    }
}
