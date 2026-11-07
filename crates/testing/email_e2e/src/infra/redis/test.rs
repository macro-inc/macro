use super::selects;

/// A database with a client on it is not handed out; `db=1` is not `db=12`.
#[test]
fn a_database_a_client_is_connected_to_is_in_use() {
    let clients = "id=3 addr=127.0.0.1:50000 laddr=127.0.0.1:6379 fd=8 name= db=0 sub=0\n\
                   id=4 addr=127.0.0.1:50001 laddr=127.0.0.1:6379 fd=9 name= db=12 sub=0\n";

    assert!(selects(clients, 12));
    assert!(selects(clients, 0));
    assert!(!selects(clients, 1));
    assert!(!selects(clients, 2));
}
