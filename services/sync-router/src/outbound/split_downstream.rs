//! A [`DownstreamFactory`] that routes each document to either the Durable
//! Object downstream or the native machine downstream, per `SYNC_NATIVE_MODE`.
//!
//! The mode exists for the migration: `off` (everything stays on the DO),
//! `all` (everything native), or `prefix:<p>` (documents whose id starts with
//! `<p>` go native — handy for testing one document at a time).

#[cfg(test)]
mod test;

use crate::domain::models::{ConnectionId, DocId};
use crate::domain::ports::DownstreamFactory;
use tokio::sync::mpsc;

/// Which documents take the native path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncNativeMode {
    /// Everything goes to the Durable Object.
    Off,
    /// Everything goes to the native machines.
    All,
    /// Documents whose id starts with the prefix go native; the rest DO.
    Prefix(String),
}

impl SyncNativeMode {
    /// Parse `off` / `all` / `prefix:<p>`.
    pub fn parse(raw: &str) -> anyhow::Result<Self> {
        match raw {
            "off" => Ok(Self::Off),
            "all" => Ok(Self::All),
            _ => match raw.strip_prefix("prefix:") {
                Some(prefix) if !prefix.is_empty() => Ok(Self::Prefix(prefix.to_string())),
                _ => anyhow::bail!("SYNC_NATIVE_MODE must be off, all, or prefix:<p>, got {raw:?}"),
            },
        }
    }

    /// Does this document take the native path?
    pub fn is_native(&self, doc: &DocId) -> bool {
        match self {
            Self::Off => false,
            Self::All => true,
            Self::Prefix(prefix) => doc.as_str().starts_with(prefix),
        }
    }
}

/// See the module docs.
pub struct SplitDownstreamFactory<Durable, Native> {
    mode: SyncNativeMode,
    durable: Durable,
    native: Native,
}

impl<Durable, Native> SplitDownstreamFactory<Durable, Native> {
    /// Both factories stay alive for the whole process; `mode` picks per doc.
    pub fn new(mode: SyncNativeMode, durable: Durable, native: Native) -> Self {
        Self {
            mode,
            durable,
            native,
        }
    }
}

impl<Durable: DownstreamFactory, Native: DownstreamFactory> DownstreamFactory
    for SplitDownstreamFactory<Durable, Native>
{
    fn open(
        &self,
        conn: ConnectionId,
        doc: DocId,
        token: String,
        epoch: u64,
    ) -> mpsc::Sender<Vec<u8>> {
        if self.mode.is_native(&doc) {
            self.native.open(conn, doc, token, epoch)
        } else {
            self.durable.open(conn, doc, token, epoch)
        }
    }
}
