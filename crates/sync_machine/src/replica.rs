//! The replicated-document abstraction the machine drives.

/// What the machine observed about one applied update.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Applied {
    /// Lexical node ids whose backing containers changed (the blame feed).
    pub touched_nodes: Vec<String>,
}

/// The replicated state. Loro is the eventual implementation; the machine
/// never names it, and pass 1 runs entirely on [`mock::MockReplica`].
///
/// All methods are pure CPU — no IO, no clocks. Snapshot/diff exports run
/// inline in pass 1.
// TODO(pass 2): move `snapshot`/`diff_since` behind an `Export` effect carrying
// a cheap fork, so multi-megabyte serialization happens off the driving thread.
pub trait Replica: Sized {
    /// Errors from decoding or applying payloads.
    type Error: core::fmt::Debug;

    /// Rebuild from stored snapshot bytes.
    fn load(snapshot: &[u8]) -> Result<Self, Self::Error>;

    /// A brand-new, empty document. Matches the deployed Durable Object,
    /// which is built with `create-default-state`: subscribing to a document
    /// with no stored snapshot materializes an empty one.
    fn empty() -> Self;

    /// Merge one peer's update; report what it touched.
    fn apply(&mut self, update: &[u8]) -> Result<Applied, Self::Error>;

    /// Export a full snapshot.
    fn snapshot(&self) -> Vec<u8>;

    /// Export everything a caller with `cursor` (an opaque version vector) is
    /// missing.
    fn diff_since(&self, cursor: &[u8]) -> Result<Vec<u8>, Self::Error>;

    /// Merge one peer's ephemeral presence payload (in production: a Loro
    /// `EphemeralStore` update). Invalid payloads are ignored.
    fn apply_presence(&mut self, payload: &[u8]);

    /// The combined presence state, for initial sync.
    fn presence_all(&self) -> Vec<u8>;

    /// Drop the given peers' presence; returns the removal delta to
    /// broadcast, or `None` when there was nothing to remove.
    fn remove_presence(&mut self, peer_ids: &[u64]) -> Option<Vec<u8>>;
}

#[cfg(feature = "loro")]
pub mod loro;

pub mod mock {
    //! A scriptable [`Replica`] for tests: records applies, serves canned
    //! exports, fails on demand.

    use super::{Applied, Replica};

    /// Payloads containing this byte sequence make [`MockReplica::apply`]
    /// fail, for exercising the poison-update path.
    pub const POISON: &[u8] = b"__poison__";

    /// See the module docs.
    #[derive(Debug, Default)]
    pub struct MockReplica {
        /// Every payload successfully applied, in order.
        pub applied: Vec<Vec<u8>>,
        /// The snapshot this replica was loaded from, if any.
        pub loaded_from: Option<Vec<u8>>,
        /// Presence payloads merged so far.
        pub presence: Vec<Vec<u8>>,
    }

    /// Errors surfaced by the mock.
    #[derive(Debug, thiserror::Error)]
    pub enum MockError {
        /// The payload contained [`POISON`].
        #[error("poison update")]
        Poison,
    }

    impl Replica for MockReplica {
        type Error = MockError;

        fn load(snapshot: &[u8]) -> Result<Self, Self::Error> {
            Ok(Self {
                applied: Vec::new(),
                loaded_from: Some(snapshot.to_vec()),
                presence: Vec::new(),
            })
        }

        fn empty() -> Self {
            Self::default()
        }

        fn apply(&mut self, update: &[u8]) -> Result<Applied, Self::Error> {
            if update.windows(POISON.len()).any(|window| window == POISON) {
                return Err(MockError::Poison);
            }
            self.applied.push(update.to_vec());
            // Deterministic fake blame: one node per applied payload.
            Ok(Applied {
                touched_nodes: vec![format!("node-{}", self.applied.len())],
            })
        }

        fn snapshot(&self) -> Vec<u8> {
            // A legible fake: the load source plus every applied payload.
            let mut out = b"snap[".to_vec();
            if let Some(loaded) = &self.loaded_from {
                out.extend_from_slice(loaded);
            }
            for applied in &self.applied {
                out.push(b'|');
                out.extend_from_slice(applied);
            }
            out.push(b']');
            out
        }

        fn diff_since(&self, cursor: &[u8]) -> Result<Vec<u8>, Self::Error> {
            let mut out = b"diff-since[".to_vec();
            out.extend_from_slice(cursor);
            out.push(b']');
            Ok(out)
        }

        fn apply_presence(&mut self, payload: &[u8]) {
            self.presence.push(payload.to_vec());
        }

        fn presence_all(&self) -> Vec<u8> {
            let mut out = b"presence[".to_vec();
            for (index, payload) in self.presence.iter().enumerate() {
                if index > 0 {
                    out.push(b'|');
                }
                out.extend_from_slice(payload);
            }
            out.push(b']');
            out
        }

        fn remove_presence(&mut self, peer_ids: &[u64]) -> Option<Vec<u8>> {
            if peer_ids.is_empty() {
                return None;
            }
            let mut out = b"left[".to_vec();
            for (index, peer) in peer_ids.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                out.extend_from_slice(peer.to_string().as_bytes());
            }
            out.push(b']');
            Some(out)
        }
    }
}
