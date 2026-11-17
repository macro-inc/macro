use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use rustix::process::{Resource, getrlimit};

use super::{
    OPEN_FILES, PORT_ATTEMPTS, free_port, local_listener, port_backoff, raise_open_file_limit,
    resources,
};

/// The waits double from half a second, and the last try comes 7.5 s after
/// the first.
#[test]
fn the_waits_between_tries_double() {
    let waits: Vec<Duration> = (1..PORT_ATTEMPTS).map(port_backoff).collect();
    assert_eq!(
        waits,
        [500, 1000, 2000, 4000].map(Duration::from_millis).to_vec()
    );
}

/// Once raised, the limit stays, and raising it again changes nothing. Where
/// the hard limit is lower, raising it fails.
#[test]
fn the_open_file_limit_is_raised_once() {
    if getrlimit(Resource::Nofile)
        .maximum
        .is_some_and(|hard| hard < OPEN_FILES)
    {
        raise_open_file_limit().unwrap_err();
        return;
    }
    raise_open_file_limit().unwrap();
    let limit = getrlimit(Resource::Nofile).current;
    assert!(limit.is_none_or(|limit| limit >= OPEN_FILES), "{limit:?}");
    assert_eq!(raise_open_file_limit().unwrap(), None);
}

/// A free port can be listened on by a service on every address.
#[tokio::test]
async fn a_free_port_is_free_on_every_address() {
    let port = free_port().await.unwrap();
    std::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port))).unwrap();
}

/// A local listener accepts on 127.0.0.1.
#[tokio::test]
async fn a_local_listener_accepts_on_loopback() {
    let listener = local_listener().await.unwrap();
    let address = listener.local_addr().unwrap();
    assert_eq!(address.ip(), Ipv4Addr::LOCALHOST);
    let (connected, accepted) =
        tokio::join!(tokio::net::TcpStream::connect(address), listener.accept());
    connected.unwrap();
    accepted.unwrap();
}

/// What a failed start reports names the open files and the TCP sockets.
#[test]
fn the_resources_name_files_sockets_and_ports() {
    let resources = resources();
    for part in ["open files of the stack's process", "TCP:", "local ports "] {
        assert!(
            resources.contains(part),
            "{part} is missing from {resources}"
        );
    }
}
