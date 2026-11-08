//! Generate the TypeScript host IPC from its Rust source of truth.
#[path = "../tests/support/peer_protocol.rs"]
mod peer_protocol;
fn main() {
    print!("{}", peer_protocol::typescript());
}
