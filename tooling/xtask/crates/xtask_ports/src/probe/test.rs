use std::net::TcpListener;
use std::time::Duration;

use super::*;

#[test]
fn a_port_with_a_listener_is_neither_bindable_nor_free_to_connect_past() {
    // The OS picks a port that is free right now, so this holds on a busy box.
    let listener = TcpListener::bind("0.0.0.0:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    assert!(!bindable(port));
    assert!(accepting(port, Duration::from_millis(500)));
}

/// Dev servers often bind loopback only; a connect still finds them.
#[test]
fn a_loopback_listener_is_found_by_a_connect() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    assert!(accepting(port, Duration::from_millis(500)));
}
