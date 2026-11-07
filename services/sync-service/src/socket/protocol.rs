use crate::socket::Socket;
use bebop::SliceWrapper;
use sync_protocol::FromRemote;
use worker::Result;
/// Sends the initial sync message to a single peer.
/// The initial sync message contains the snapshot of the current state of the document
pub fn send_initial_sync(socket: &Socket, snapshot: &[u8], awareness: &[u8]) -> Result<()> {
    socket.send(FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::Raw(snapshot),
        awareness: SliceWrapper::Raw(awareness),
    })
}
