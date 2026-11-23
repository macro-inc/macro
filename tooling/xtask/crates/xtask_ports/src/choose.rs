//! Picking a free window and subnet block from what the machine holds.

use std::collections::{BTreeMap, BTreeSet};

use crate::layout::{Port, blocks_from, windows_from, windows_overlap};
use crate::net::{Ipv4Range, block_range};

#[cfg(test)]
mod test;

/// What stops a port window being used.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WindowBlocker {
    /// Another instance's window overlaps it.
    Instance(String),
    /// Something other than this instance is on one of its ports.
    Port(u16),
}

impl std::fmt::Display for WindowBlocker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WindowBlocker::Instance(name) => write!(f, "instance {name} holds it"),
            WindowBlocker::Port(port) => write!(f, "port {port} is in use"),
        }
    }
}

/// What a window has to avoid.
pub(crate) struct PortUse<'a> {
    /// Other instances' window bases.
    pub claimed: &'a BTreeMap<String, u16>,
    /// Host ports other containers publish. Docker can publish without a
    /// listening socket, so a bind probe alone wouldn't see them.
    pub published_by_others: &'a BTreeSet<u16>,
    /// Host ports this instance's own containers publish; these aren't conflicts.
    pub published_by_self: &'a BTreeSet<u16>,
    /// Whether a port can be bound right now.
    pub bindable: &'a dyn Fn(u16) -> bool,
}

impl PortUse<'_> {
    pub(crate) fn blocker(&self, base: u16) -> Option<WindowBlocker> {
        let overlapping = self
            .claimed
            .iter()
            .find(|(_, other)| windows_overlap(base, **other));
        if let Some((name, _)) = overlapping {
            return Some(WindowBlocker::Instance(name.clone()));
        }

        // After the overlap check on purpose: a probe's brief bind must never
        // touch a window another start has reserved.
        Port::all()
            .filter(|port| port.is_bound())
            .map(|port| base + port.offset())
            .filter(|port| !self.published_by_self.contains(port))
            .find(|port| self.published_by_others.contains(port) || !(self.bindable)(*port))
            .map(WindowBlocker::Port)
    }

    /// Whether `port` is held by something other than this instance.
    pub(crate) fn port_busy(&self, port: u16) -> bool {
        !self.published_by_self.contains(&port) && !(self.bindable)(port)
    }
}

/// The first usable window: `preferred` (what the instance already holds), then
/// the name's hashed bucket, then the following buckets. Probing from the hash
/// keeps the same name on the same ports unless something is really in the way.
pub(crate) fn choose_window(
    name: &str,
    preferred: Option<u16>,
    ports: &PortUse<'_>,
) -> Option<u16> {
    preferred
        .into_iter()
        .chain(windows_from(name))
        .find(|base| ports.blocker(*base).is_none())
}

/// The first subnet block overlapping nothing in `used` and not in `claimed`:
/// `preferred`, then the name's hashed block, then the following blocks.
pub(crate) fn choose_block(
    name: &str,
    preferred: Option<u8>,
    used: &[Ipv4Range],
    claimed: &BTreeSet<u8>,
) -> Option<u8> {
    preferred
        .into_iter()
        .chain(blocks_from(name))
        .find(|block| {
            let range = block_range(*block);
            !claimed.contains(block) && !used.iter().any(|other| other.overlaps(range))
        })
}
