//! Per-socket FIFO network with black holes, abrupt breaks and explicit frame faults.
use crate::{clock::delay, *};
use doc_sync_core::SessionId;
use rand::Rng;
use std::collections::{BTreeMap, BTreeSet};
use sync_protocol::framing::Reassembler;
use sync_server_core::domain::socket::WebSocketId;

#[derive(Clone, Debug)]
pub(crate) enum Packet {
    Binary(Vec<u8>),
    Text(String),
}
#[derive(Clone, Debug)]
pub(crate) struct Delivery {
    pub packet: Packet,
    pub kind: FrameKind,
    pub corrupted: bool,
    pub frames: u16,
}
pub(crate) type LinkKey = (ClientName, SessionId, u32);
pub(crate) struct Link {
    pub socket: Option<WebSocketId>,
    pub open: bool,
    pub doc: DocIx,
    pub claims: Option<crate::model::TokenGrant>,
    pub token_valid: bool,
    pub tails: [u64; 2],
    pub up: Reassembler,
    pub down: Reassembler,
    pub up_kind: FrameKind,
    pub down_kind: FrameKind,
    pub frames: [Vec<Vec<u8>>; 2],
}
struct DropRule {
    client: ClientName,
    direction: Direction,
    kind: Option<FrameKind>,
    left: u8,
}
/// Browser-like ordered socket links, including independent generations.
pub struct SimNetwork {
    pub(crate) links: BTreeMap<LinkKey, Link>,
    pub(crate) router_frames: BTreeMap<(LinkKey, Direction, String), Vec<Vec<u8>>>,
    pub(crate) partitions: BTreeSet<ClientName>,
    pub(crate) offline: BTreeSet<ClientName>,
    pub(crate) profile: NetProfile,
    drops: Vec<DropRule>,
    corrupt: BTreeSet<(ClientName, Direction)>,
}
impl SimNetwork {
    /// Empty links with the configured latency and failure probabilities.
    pub fn new(profile: NetProfile) -> Self {
        Self {
            links: BTreeMap::new(),
            router_frames: BTreeMap::new(),
            partitions: BTreeSet::new(),
            offline: BTreeSet::new(),
            profile,
            drops: Vec::new(),
            corrupt: BTreeSet::new(),
        }
    }
    pub(crate) fn fault(&mut self, fault: NetStep) -> Option<ClientName> {
        match fault {
            NetStep::Partition(client) => {
                self.partitions.insert(client);
            }
            NetStep::Heal(client) => {
                self.partitions.remove(&client);
            }
            NetStep::Break(client) => return Some(client),
            NetStep::LoseAcks { client, count } => self.drops.push(DropRule {
                client,
                direction: Direction::ToClient,
                kind: Some(FrameKind::Ack),
                left: count,
            }),
            NetStep::DropNext {
                client,
                direction,
                kind,
                frames,
            } => self.drops.push(DropRule {
                client,
                direction,
                kind,
                left: frames,
            }),
            NetStep::CorruptNext { client, direction } => {
                self.corrupt.insert((client, direction));
            }
            NetStep::Profile(profile) => self.profile = profile,
        }
        None
    }
    pub(crate) fn heal(&mut self) {
        self.partitions.clear();
        self.offline.clear();
        self.drops.clear();
        self.corrupt.clear();
        self.profile = NetProfile::calm();
    }
    pub(crate) fn corrupt_message(
        &mut self,
        key: &LinkKey,
        direction: Direction,
        frames: &mut Vec<Vec<u8>>,
    ) -> bool {
        if !self.corrupt.contains(&(key.0.clone(), direction)) {
            return false;
        }
        let mut whole = vec![1];
        whole.extend(
            frames
                .iter()
                .flat_map(|frame| frame.iter().skip(1).copied()),
        );
        let Some(corrupt) = corrupt_update(&whole, direction) else {
            return false;
        };
        self.corrupt.remove(&(key.0.clone(), direction));
        let chunk = frames
            .iter()
            .map(|frame| frame.len().saturating_sub(1))
            .max()
            .unwrap_or(1)
            .max(1);
        *frames = sync_protocol::framing::into_frames(&corrupt[1..], chunk);
        true
    }
    pub(crate) fn transit(
        &mut self,
        key: &LinkKey,
        direction: Direction,
        kind: FrameKind,
        now: u64,
        rng: &mut impl Rng,
    ) -> Transit {
        if self.partitions.contains(&key.0) || self.offline.contains(&key.0) {
            return Transit::Dropped;
        }
        if self.profile.break_per_frame > 0.0
            && rng.random_bool(self.profile.break_per_frame.clamp(0.0, 1.0))
        {
            return Transit::Broken;
        }
        if let Some(rule) = self.drops.iter_mut().find(|r| {
            r.left > 0
                && r.client == key.0
                && r.direction == direction
                && r.kind.is_none_or(|filter| filter == kind)
        }) {
            rule.left -= 1;
            return Transit::Dropped;
        }
        let Some(link) = self.links.get_mut(key) else {
            return Transit::Dropped;
        };
        if !link.open {
            return Transit::Dropped;
        }
        let index = if direction == Direction::ToServer {
            0
        } else {
            1
        };
        let at = now
            .saturating_add(delay(self.profile.latency, rng))
            .max(link.tails[index].saturating_add(1));
        link.tails[index] = at;
        Transit::Deliver { at }
    }
}
pub(crate) enum Transit {
    Dropped,
    Broken,
    Deliver { at: u64 },
}
pub(crate) fn kind(bytes: &[u8], direction: Direction) -> FrameKind {
    use bebop::Record;
    if direction == Direction::ToServer {
        match sync_protocol::FromPeer::deserialize(bytes) {
            Ok(sync_protocol::FromPeer::PeerRegisterId { .. }) => FrameKind::RegisterId,
            Ok(sync_protocol::FromPeer::PeerUpdate { .. }) => FrameKind::Update,
            Ok(sync_protocol::FromPeer::PeerCommentUpdate { .. }) => FrameKind::CommentUpdate,
            Ok(sync_protocol::FromPeer::PeerAwareness { .. }) => FrameKind::Awareness,
            Ok(sync_protocol::FromPeer::PeerRequestSince { .. }) => FrameKind::RequestSince,
            Ok(sync_protocol::FromPeer::PeerRequestSnapshot { .. }) => FrameKind::RequestSnapshot,
            _ => FrameKind::Unknown,
        }
    } else {
        match sync_protocol::FromRemote::deserialize(bytes) {
            Ok(sync_protocol::FromRemote::RemoteInitialSync { .. }) => FrameKind::InitialSync,
            Ok(sync_protocol::FromRemote::RemoteUpdate { .. }) => FrameKind::RemoteUpdate,
            Ok(sync_protocol::FromRemote::RemoteUpdateAck { .. }) => FrameKind::Ack,
            Ok(sync_protocol::FromRemote::RemoteAwareness { .. }) => FrameKind::Awareness,
            Ok(sync_protocol::FromRemote::RemoteUpdateSince { .. }) => FrameKind::UpdateSince,
            Ok(sync_protocol::FromRemote::RemoteSnapshot { .. }) => FrameKind::Snapshot,
            _ => FrameKind::Unknown,
        }
    }
}
fn corrupt_update(frame: &[u8], direction: Direction) -> Option<Vec<u8>> {
    use bebop::{Record, SliceWrapper};
    if frame.first() != Some(&1) {
        return None;
    }
    let bytes = frame.get(1..)?;
    let mut result = vec![1];
    let corrupt = [0u8];
    if direction == Direction::ToServer {
        if let Ok(sync_protocol::FromPeer::PeerUpdate { id, .. }) =
            sync_protocol::FromPeer::deserialize(bytes)
        {
            let updates = vec![SliceWrapper::from_cooked(&corrupt)];
            sync_protocol::FromPeer::PeerUpdate { id, updates }
                .serialize(&mut result)
                .ok()?;
        } else {
            return None;
        }
    } else {
        let message = match sync_protocol::FromRemote::deserialize(bytes).ok()? {
            sync_protocol::FromRemote::RemoteUpdate { .. } => {
                sync_protocol::FromRemote::RemoteUpdate {
                    update: SliceWrapper::from_cooked(&corrupt),
                }
            }
            sync_protocol::FromRemote::RemoteSnapshot { .. } => {
                sync_protocol::FromRemote::RemoteSnapshot {
                    snapshot: SliceWrapper::from_cooked(&corrupt),
                }
            }
            sync_protocol::FromRemote::RemoteUpdateSince { vv, .. } => {
                sync_protocol::FromRemote::RemoteUpdateSince {
                    update: SliceWrapper::from_cooked(&corrupt),
                    vv,
                }
            }
            sync_protocol::FromRemote::RemoteInitialSync { awareness, .. } => {
                sync_protocol::FromRemote::RemoteInitialSync {
                    snapshot: SliceWrapper::from_cooked(&corrupt),
                    awareness,
                }
            }
            _ => return None,
        };
        message.serialize(&mut result).ok()?;
    }
    Some(result)
}
