//! Every channel's Macro members, held in memory so the audit can ask whether
//! two people share a channel without a join per legacy edge, and so each
//! channel's `interacted` pairs can be planned. Participant rows number in the
//! hundreds of thousands, so this fits in memory comfortably.

use crate::domain::models::backfill::{ChannelMember, ChannelRecord, ChannelSnapshot, ChannelType};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Users per interaction write, the producers' chunk.
pub const USERS_PER_WRITE: usize = 10;
/// Peers per interaction write, the producers' chunk. With
/// [`USERS_PER_WRITE`] a write adds at most 10,000 rows.
pub const PEERS_PER_WRITE: usize = 500;

/// How a channel counts toward `interacted`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChannelKind {
    /// Not a DM and not a signup support channel: its members are paired.
    Shared(ChannelType),
    /// A signup support channel: never paired.
    Support,
    /// A DM: its two people are paired once one of them sent a message.
    DirectMessage,
}

/// A member, interned.
#[derive(Clone, Copy, Debug)]
struct Member {
    user: u32,
    joined_at: DateTime<Utc>,
    left_at: Option<DateTime<Utc>>,
}

impl Member {
    fn overlaps(&self, other: &Member) -> bool {
        let self_end = self.left_at.unwrap_or(DateTime::<Utc>::MAX_UTC);
        let other_end = other.left_at.unwrap_or(DateTime::<Utc>::MAX_UTC);
        self.joined_at <= other_end && other.joined_at <= self_end
    }
}

struct Channel {
    id: Uuid,
    kind: ChannelKind,
    members: Vec<Member>,
    person_message: bool,
}

struct Snapshot {
    channel: u32,
    taken_at: DateTime<Utc>,
    users: Vec<u32>,
}

/// One planned `record_interactions` call: every user gains every peer and
/// the reverse. It holds interned users, so a large channel's plan stays
/// small; [`ChannelDirectory::resolve`] names them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InteractionWrite {
    /// The channel the pairs come from.
    pub channel_id: Uuid,
    /// At most [`USERS_PER_WRITE`] users.
    users: Vec<u32>,
    /// At most [`PEERS_PER_WRITE`] peers.
    peers: Vec<u32>,
}

impl InteractionWrite {
    /// Rows the write can add: each user with each other peer, both ways.
    pub fn attempted_rows(&self) -> u64 {
        let pairs: u64 = self
            .users
            .iter()
            .map(|user| self.peers.iter().filter(|peer| *peer != user).count() as u64)
            .sum();
        pairs * 2
    }
}

/// What two people's channels say about them.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ChannelRelation {
    /// Both were members of a shared channel at the same time, or the
    /// snapshot lists both for one.
    pub shared_channel: bool,
    /// Both are in a signup support channel.
    pub support_channel: bool,
    /// They have a DM: `Some(true)` when one of them sent a message in it.
    pub direct_message: Option<bool>,
}

/// One channel's projected `interacted` rows, for the audit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChannelProjection {
    /// The channel.
    pub channel_id: Uuid,
    /// Its type.
    pub channel_type: ChannelType,
    /// Macro members with a participant row.
    pub members: u64,
    /// Rows its participants produce: members × (members − 1).
    pub rows: u64,
    /// Further rows from people only the snapshot lists.
    pub snapshot_rows: u64,
}

/// Every channel's Macro members and the April 2026 snapshot. Built by
/// [`ChannelLoader`].
#[derive(Default)]
pub struct ChannelDirectory {
    ids: Vec<MacroUserIdStr<'static>>,
    users: HashMap<MacroUserIdStr<'static>, u32>,
    channels: Vec<Channel>,
    channel_index: HashMap<Uuid, u32>,
    /// Per user, (channel, member position) sorted by channel.
    memberships: Vec<Vec<(u32, u32)>>,
    snapshots: Vec<Snapshot>,
    /// Per user, the shared channels a snapshot lists them in, sorted.
    snapshot_memberships: Vec<Vec<u32>>,
}

/// Collects channels, members, snapshots and DM history page by page, then
/// indexes them.
#[derive(Default)]
pub struct ChannelLoader(ChannelDirectory);

impl ChannelLoader {
    fn intern(&mut self, user: MacroUserIdStr<'static>) -> u32 {
        if let Some(index) = self.0.users.get(&user) {
            return *index;
        }

        let directory = &mut self.0;
        let index = directory.ids.len() as u32;
        directory.ids.push(user.clone());
        directory.users.insert(user, index);
        directory.memberships.push(Vec::new());
        directory.snapshot_memberships.push(Vec::new());
        index
    }

    /// Add a page of channels with their members. A private channel named
    /// like a support channel is one only when it holds a roster address.
    pub fn add_channels(
        &mut self,
        channels: Vec<ChannelRecord>,
        members: Vec<ChannelMember>,
        support_roster: &HashSet<MacroUserIdStr<'static>>,
    ) {
        let mut by_channel: HashMap<Uuid, Vec<ChannelMember>> = HashMap::new();
        for member in members {
            by_channel
                .entry(member.channel_id)
                .or_default()
                .push(member);
        }

        for record in channels {
            let members = by_channel.remove(&record.id).unwrap_or_default();
            let holds_roster = members.iter().any(|m| support_roster.contains(&m.user));
            let kind = match record.channel_type {
                ChannelType::DirectMessage => ChannelKind::DirectMessage,
                _ if record.support_name && holds_roster => ChannelKind::Support,
                channel_type => ChannelKind::Shared(channel_type),
            };

            let channel = self.0.channels.len() as u32;
            let members: Vec<Member> = members
                .into_iter()
                .map(|member| Member {
                    user: self.intern(member.user),
                    joined_at: member.joined_at,
                    left_at: member.left_at,
                })
                .collect();
            for (position, member) in members.iter().enumerate() {
                self.0.memberships[member.user as usize].push((channel, position as u32));
            }

            self.0.channel_index.insert(record.id, channel);
            self.0.channels.push(Channel {
                id: record.id,
                kind,
                members,
                person_message: false,
            });
        }
    }

    /// Add a page of snapshot rows. Only shared channels' snapshots pair
    /// anyone, and a channel deleted since it was loaded is skipped.
    pub fn add_snapshots(&mut self, snapshots: Vec<ChannelSnapshot>) {
        for snapshot in snapshots {
            let Some(&channel) = self.0.channel_index.get(&snapshot.channel_id) else {
                continue;
            };
            if !matches!(
                self.0.channels[channel as usize].kind,
                ChannelKind::Shared(_)
            ) {
                continue;
            }

            let users: HashSet<_> = snapshot.users.into_iter().collect();
            let users: Vec<u32> = users.into_iter().map(|user| self.intern(user)).collect();
            for user in &users {
                self.0.snapshot_memberships[*user as usize].push(channel);
            }
            self.0.snapshots.push(Snapshot {
                channel,
                taken_at: snapshot.taken_at,
                users,
            });
        }
    }

    /// The DMs whose message history still has to be read.
    pub fn direct_message_ids(&self) -> Vec<Uuid> {
        self.0
            .channels
            .iter()
            .filter(|channel| channel.kind == ChannelKind::DirectMessage)
            .map(|channel| channel.id)
            .collect()
    }

    /// Mark DMs where one of the two sent a message.
    pub fn mark_person_messages(&mut self, direct_messages: &[Uuid]) {
        for id in direct_messages {
            if let Some(&channel) = self.0.channel_index.get(id) {
                self.0.channels[channel as usize].person_message = true;
            }
        }
    }

    /// Index what was loaded for lookups.
    pub fn finish(mut self) -> ChannelDirectory {
        for memberships in &mut self.0.memberships {
            memberships.sort_unstable();
        }
        for memberships in &mut self.0.snapshot_memberships {
            memberships.sort_unstable();
            memberships.dedup();
        }
        self.0
    }
}

impl ChannelDirectory {
    /// Channels loaded, by kind: (shared, support, DMs, DMs with a message).
    pub fn channel_counts(&self) -> (u64, u64, u64, u64) {
        let mut counts = (0, 0, 0, 0);
        for channel in &self.channels {
            match channel.kind {
                ChannelKind::Shared(_) => counts.0 += 1,
                ChannelKind::Support => counts.1 += 1,
                ChannelKind::DirectMessage => {
                    counts.2 += 1;
                    if channel.person_message {
                        counts.3 += 1;
                    }
                }
            }
        }
        counts
    }

    /// Participant rows and snapshot rows loaded.
    pub fn member_counts(&self) -> (u64, u64) {
        let members = self.channels.iter().map(|c| c.members.len() as u64).sum();
        (members, self.snapshots.len() as u64)
    }

    /// What `a`'s and `b`'s channels say about them. Walks the person in
    /// fewer channels and looks each one up in the other's, so a support
    /// roster member in every signup's channel costs little.
    pub fn relation(
        &self,
        a: &MacroUserIdStr<'static>,
        b: &MacroUserIdStr<'static>,
    ) -> ChannelRelation {
        let mut relation = ChannelRelation::default();
        let (Some(&a), Some(&b)) = (self.users.get(a), self.users.get(b)) else {
            return relation;
        };

        let (fewer, more) =
            smaller_first(&self.memberships[a as usize], &self.memberships[b as usize]);
        for &(channel, position) in fewer {
            let Ok(found) = more.binary_search_by_key(&channel, |&(c, _)| c) else {
                continue;
            };
            let other_position = more[found].1;
            let channel = &self.channels[channel as usize];
            match channel.kind {
                ChannelKind::Shared(_) => {
                    let first = &channel.members[position as usize];
                    let second = &channel.members[other_position as usize];
                    if first.overlaps(second) {
                        relation.shared_channel = true;
                    }
                }
                ChannelKind::Support => relation.support_channel = true,
                ChannelKind::DirectMessage => {
                    let sent = relation.direct_message.unwrap_or(false) || channel.person_message;
                    relation.direct_message = Some(sent);
                }
            }
        }

        if !relation.shared_channel {
            let (fewer, more) = smaller_first(
                &self.snapshot_memberships[a as usize],
                &self.snapshot_memberships[b as usize],
            );
            relation.shared_channel = fewer.iter().any(|c| more.binary_search(c).is_ok());
        }
        relation
    }

    /// Each shared channel's projected rows, before anything is written.
    /// Rows are counted per channel; a pair in two channels counts twice.
    pub fn projections(&self) -> Vec<ChannelProjection> {
        let mut snapshot_rows: HashMap<u32, u64> = HashMap::new();
        for snapshot in &self.snapshots {
            let current = self.current_members(snapshot.channel);
            let shared = snapshot
                .users
                .iter()
                .filter(|u| current.contains(u))
                .count() as u64;
            let listed = snapshot.users.len() as u64;
            let rows = pair_rows(listed) - pair_rows(shared);
            *snapshot_rows.entry(snapshot.channel).or_default() += rows;
        }

        self.channels
            .iter()
            .enumerate()
            .filter_map(|(index, channel)| {
                let ChannelKind::Shared(channel_type) = channel.kind else {
                    return None;
                };
                let members = channel.members.len() as u64;
                Some(ChannelProjection {
                    channel_id: channel.id,
                    channel_type,
                    members,
                    rows: pair_rows(members),
                    snapshot_rows: snapshot_rows.get(&(index as u32)).copied().unwrap_or(0),
                })
            })
            .collect()
    }

    fn current_members(&self, channel: u32) -> HashSet<u32> {
        self.channels[channel as usize]
            .members
            .iter()
            .filter(|member| member.left_at.is_none())
            .map(|member| member.user)
            .collect()
    }

    /// The `record_interactions` calls that write each shared channel's
    /// pairs, one channel at a time so only one channel's plan is held.
    ///
    /// Current members (no `left_at`) all overlap, so each chunk of them is
    /// paired with itself and every later member: every pair is written once,
    /// in one direction's chunk. A member with `left_at` is paired with the
    /// members whose time overlapped theirs. A snapshot adds the pairs of
    /// people it lists who are no longer members.
    ///
    /// With `after`, only pairs with someone who joined at or after it are
    /// written, and only snapshots taken at or after it are read.
    pub fn interaction_writes(
        &self,
        after: Option<DateTime<Utc>>,
    ) -> impl Iterator<Item = Vec<InteractionWrite>> + '_ {
        self.channels
            .iter()
            .enumerate()
            .filter(|(_, channel)| matches!(channel.kind, ChannelKind::Shared(_)))
            .map(move |(index, channel)| self.writes_for(index as u32, channel, after))
    }

    fn writes_for(
        &self,
        index: u32,
        channel: &Channel,
        after: Option<DateTime<Utc>>,
    ) -> Vec<InteractionWrite> {
        let mut writes = Vec::new();
        self.channel_writes(channel, after, &mut writes);

        for snapshot in self.snapshots.iter().filter(|s| s.channel == index) {
            if after.is_some_and(|after| snapshot.taken_at < after) {
                continue;
            }
            let current = self.current_members(snapshot.channel);
            let gone: Vec<u32> = snapshot
                .users
                .iter()
                .copied()
                .filter(|user| !current.contains(user))
                .collect();
            push_writes(channel.id, &gone, &snapshot.users, &mut writes);
        }
        writes
    }

    /// The users and peers of a write, by id.
    pub fn resolve(
        &self,
        write: &InteractionWrite,
    ) -> (Vec<MacroUserIdStr<'static>>, Vec<MacroUserIdStr<'static>>) {
        let name = |users: &[u32]| {
            users
                .iter()
                .map(|u| self.ids[*u as usize].clone())
                .collect()
        };
        (name(&write.users), name(&write.peers))
    }

    fn channel_writes(
        &self,
        channel: &Channel,
        after: Option<DateTime<Utc>>,
        writes: &mut Vec<InteractionWrite>,
    ) {
        let joined_since = |member: &Member| after.is_none_or(|after| member.joined_at >= after);

        let mut current: Vec<&Member> = channel
            .members
            .iter()
            .filter(|member| member.left_at.is_none())
            .collect();
        current.sort_by_key(|member| member.user);
        let current_users: Vec<u32> = current.iter().map(|member| member.user).collect();

        if after.is_none() {
            // Triangular: chunk i is paired with members from i on.
            for start in (0..current_users.len()).step_by(USERS_PER_WRITE) {
                let end = (start + USERS_PER_WRITE).min(current_users.len());
                push_peer_chunks(
                    channel.id,
                    &current_users[start..end],
                    &current_users[start..],
                    writes,
                );
            }
        } else {
            let joined: Vec<u32> = current
                .iter()
                .filter(|member| joined_since(member))
                .map(|member| member.user)
                .collect();
            push_writes(channel.id, &joined, &current_users, writes);
        }

        for left in channel
            .members
            .iter()
            .filter(|member| member.left_at.is_some())
        {
            let peers: Vec<u32> = channel
                .members
                .iter()
                .filter(|peer| peer.user != left.user && peer.overlaps(left))
                .filter(|peer| joined_since(left) || joined_since(peer))
                .map(|peer| peer.user)
                .collect();
            push_peer_chunks(channel.id, &[left.user], &peers, writes);
        }
    }

    /// The pairs from DMs where one of the two sent a message, as one write
    /// each.
    pub fn direct_message_writes(&self) -> Vec<InteractionWrite> {
        self.channels
            .iter()
            .filter(|channel| channel.kind == ChannelKind::DirectMessage && channel.person_message)
            .filter_map(|channel| match channel.members.as_slice() {
                [first, second] if first.user != second.user => Some(InteractionWrite {
                    channel_id: channel.id,
                    users: vec![first.user],
                    peers: vec![second.user],
                }),
                _ => None,
            })
            .collect()
    }
}

fn push_writes(channel_id: Uuid, users: &[u32], peers: &[u32], writes: &mut Vec<InteractionWrite>) {
    for users in users.chunks(USERS_PER_WRITE) {
        push_peer_chunks(channel_id, users, peers, writes);
    }
}

fn push_peer_chunks(
    channel_id: Uuid,
    users: &[u32],
    peers: &[u32],
    writes: &mut Vec<InteractionWrite>,
) {
    for peers in peers.chunks(PEERS_PER_WRITE) {
        // A user paired only with themselves adds nothing.
        if users.is_empty() || (peers.len() == 1 && users == peers) {
            continue;
        }
        writes.push(InteractionWrite {
            channel_id,
            users: users.to_vec(),
            peers: peers.to_vec(),
        });
    }
}

fn smaller_first<'a, T>(a: &'a [T], b: &'a [T]) -> (&'a [T], &'a [T]) {
    if a.len() <= b.len() { (a, b) } else { (b, a) }
}

/// Directed rows among `n` people who all gain each other.
fn pair_rows(n: u64) -> u64 {
    n * n.saturating_sub(1)
}
