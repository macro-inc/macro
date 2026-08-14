//! Encode/decode helpers for the multiplex envelope.
//!
//! The wire types are the bebop `ToRouter` / `FromRouter` unions from the
//! sync-service schema; this module owns the borrow-to-owned boundary so the
//! rest of the router never touches lifetimes or `bebop::Record` directly.

#[cfg(test)]
mod test;

use bebop::{Record, SliceWrapper, SubRecord};
use sync_service_bebop_schema::{FromRouter, ToRouter};

/// A decoded client envelope, owned.
#[derive(Debug, PartialEq, Eq)]
pub enum ClientEnvelope {
    /// Start syncing a document; `token` is the document-permission JWT,
    /// passed through to the downstream unverified.
    Subscribe {
        /// The document id.
        doc: String,
        /// The document-permission token.
        token: String,
    },
    /// Stop syncing a document.
    Unsubscribe {
        /// The document id.
        doc: String,
    },
    /// One inner sync frame (a serialized `FromPeer`), untouched.
    Frame {
        /// The document id.
        doc: String,
        /// The inner payload.
        payload: Vec<u8>,
    },
}

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
    let envelope =
        ToRouter::deserialize(bytes).map_err(|error| EnvelopeError::Decode(error.to_string()))?;
    Ok(match envelope {
        ToRouter::RouterSubscribe { doc_id, token } => ClientEnvelope::Subscribe {
            doc: doc_id.to_string(),
            token: token.to_string(),
        },
        ToRouter::RouterUnsubscribe { doc_id } => ClientEnvelope::Unsubscribe {
            doc: doc_id.to_string(),
        },
        ToRouter::RouterFrame { doc_id, payload } => ClientEnvelope::Frame {
            doc: doc_id.to_string(),
            payload: payload.to_vec(),
        },
        ToRouter::Unknown => return Err(EnvelopeError::Unknown),
    })
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
