use super::*;

fn generate_test_users() -> Vec<Vertex<User>> {
    [
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
    .map(|(_, uuid)| Vertex::new(User { id: uuid.to_string() }))
    .collect()
}

#[test]
fn test_group() {
    let mut g = Group::default();
    let users = generate_test_users();
    let bob = Vertex::new(User {
        id: "52D09596-7F05-4956-B64C-977AB9E334F9".to_string(),
    });

    let nusers = users.len();
    for user in users {
        g.participants.insert(user);
    }

    let new_connections = g.append(&bob);

    assert_eq!(new_connections.len(), nusers);
}

#[test]
fn test_group_generate() {
    let mut g = Group::default();
    let users = generate_test_users();

    let nusers = users.len();
    let nconnections = nusers * (nusers - 1) / 2;

    for user in users {
        g.participants.insert(user);
    }

    let connections = g.generate();

    assert_eq!(connections.len(), nconnections);
}
