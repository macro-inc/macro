//! Encode/decode helpers for the multiplex envelope.
//!
//! The wire types are the bebop `ToRouter` / `FromRouter` unions from the
//! sync-service schema. Decoding returns the generated *owned* variant
//! (`owned::ToRouter`) so the rest of the router never touches wire
//! lifetimes; encoding uses the borrowed variants for zero-copy serialize.

#[cfg(test)]
mod test;

use bebop::{Record, SliceWrapper, SubRecord};
use sync_service_bebop_schema::{FromRouter, owned};

/// A decoded client envelope: the generated owned `ToRouter`, with the
/// `Unknown` discriminator already rejected.
pub type ClientEnvelope = owned::ToRouter;

/// Errors from decoding a client envelope.
#[derive(Debug, thiserror::Error)]
pub enum EnvelopeError {
    /// The bytes were not a valid `ToRouter` frame.
    #[error("failed to decode ToRouter envelope: {0}")]
    Decode(String),
    /// The frame used a discriminator this build doesn't know.
    #[error("unknown ToRouter variant")]
    Unknown,
}

/// Decode a client's binary frame.
pub fn decode_client(bytes: &[u8]) -> Result<ClientEnvelope, EnvelopeError> {
    let envelope = owned::ToRouter::deserialize(bytes)
        .map_err(|error| EnvelopeError::Decode(error.to_string()))?;
    if matches!(envelope, owned::ToRouter::Unknown) {
        return Err(EnvelopeError::Unknown);
    }
    Ok(envelope)
}

fn encode(frame: &FromRouter<'_>) -> Vec<u8> {
    let mut buffer = Vec::with_capacity(frame.serialized_size());
    frame
        .serialize(&mut buffer)
        .expect("serializing FromRouter into a Vec cannot fail");
    buffer
}

/// The subscription is live (the downstream accepted the connection).
pub fn subscribed(doc: &str) -> Vec<u8> {
    encode(&FromRouter::RouterSubscribed { doc_id: doc })
}

/// The subscription was rejected or the dial failed.
pub fn subscribe_failed(doc: &str, reason: &str) -> Vec<u8> {
    encode(&FromRouter::RouterSubscribeFailed {
        doc_id: doc,
        reason,
    })
}

/// One inner sync frame (a serialized `FromRemote`) from the downstream.
pub fn doc_frame(doc: &str, payload: &[u8]) -> Vec<u8> {
    encode(&FromRouter::RouterDocFrame {
        doc_id: doc,
        payload: SliceWrapper::Raw(payload),
    })
}

/// The downstream connection closed; the client should re-subscribe.
pub fn doc_closed(doc: &str, reason: &str) -> Vec<u8> {
    encode(&FromRouter::RouterDocClosed {
        doc_id: doc,
        reason,
    })
}
