use super::*;

fn test_user_ids() -> Vec<String> {
    [
        "ff038d36-1aef-461a-8aa8-34001fa1abad",
        "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
        "d44caada-98c0-49eb-ab20-6851b824983a",
        "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
        "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
        "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
        "9effe035-bb12-4fcc-b479-800e1c2551a8",
        "ae2c090c-e478-4454-a001-3df458bf1fe4",
        "b4e6267e-83c4-427d-88f4-40483f4b97e6",
        "f5263664-b82f-41f5-bd4c-65e445f43e54",
        "083a6148-26c6-4a59-9106-dbfb82579edc",
        "6be3aef7-0701-4f0c-be6e-750f23ae953c",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

#[test]
fn test_group_generate() {
    let users = test_user_ids();
    let n = users.len();
    let connections = Group::new(&users).generate();
    assert_eq!(connections.len(), n * (n - 1) / 2);
}
