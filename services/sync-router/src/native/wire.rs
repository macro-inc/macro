//! Mapping between the bebop sync frames (`FromPeer` / `FromRemote`) and the
//! machine's [`ClientFrame`] / [`ServerFrame`] models.
//!
//! The DO path passes these payloads through opaquely; the native path is the
//! remote end, so it decodes what clients send and encodes what the machine
//! replies.

#[cfg(test)]
mod test;

use bebop::{Record, SliceWrapper, SubRecord};
use sync_machine::model::{ClientFrame, ServerFrame};
use sync_service_bebop_schema::{FromRemote, owned};

/// Decode a client's inner sync frame. `None` for bytes that don't parse or
/// use an unknown discriminator — the caller drops the frame (matching the
/// wasm service, which ignores unparseable messages).
pub fn decode_from_peer(bytes: &[u8]) -> Option<ClientFrame> {
    // bebop's generated union deserializer `debug_assert!`s that an unconsumed
    // frame over-read (`i > len`), so a frame whose declared length merely
    // exceeds its body panics in debug builds instead of returning
    // `CorruptFrame`. Contain it here: a bad frame costs one dropped frame, not
    // the route's whole pump task.
    let frame = std::panic::catch_unwind(|| owned::FromPeer::deserialize(bytes))
        .ok()?
        .ok()?;
    Some(match frame {
        owned::FromPeer::Unknown => return None,
        owned::FromPeer::PeerUpdate { updates, id } => ClientFrame::Update { updates, id },
        owned::FromPeer::PeerAwareness { awareness } => {
            ClientFrame::Presence { payload: awareness }
        }
        owned::FromPeer::PeerRequestSince { vv } => ClientFrame::RequestSince { cursor: vv },
        owned::FromPeer::PeerRequestSnapshot {} => ClientFrame::RequestSnapshot,
        owned::FromPeer::PeerRegisterId { peerid } => ClientFrame::RegisterPeer { peer_id: peerid },
    })
}

/// Encode a machine reply as a serialized `FromRemote`.
pub fn encode_from_remote(frame: &ServerFrame) -> Vec<u8> {
    let wire = match frame {
        ServerFrame::InitialSync { snapshot, presence } => FromRemote::RemoteInitialSync {
            snapshot: SliceWrapper::Raw(snapshot),
            awareness: SliceWrapper::Raw(presence),
        },
        ServerFrame::Update { update } => FromRemote::RemoteUpdate {
            update: SliceWrapper::Raw(update),
        },
        ServerFrame::Presence { payload } => FromRemote::RemoteAwareness {
            awareness: SliceWrapper::Raw(payload),
        },
        ServerFrame::Snapshot { snapshot } => FromRemote::RemoteSnapshot {
            snapshot: SliceWrapper::Raw(snapshot),
        },
        ServerFrame::Ack { id } => FromRemote::RemoteUpdateAck { id },
        ServerFrame::Since { update, cursor } => FromRemote::RemoteUpdateSince {
            update: SliceWrapper::Raw(update),
            vv: SliceWrapper::Raw(cursor),
        },
    };
    let mut buffer = Vec::with_capacity(wire.serialized_size());
    wire.serialize(&mut buffer)
        .expect("serializing FromRemote into a Vec cannot fail");
    buffer
}
