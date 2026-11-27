use super::*;
use chrono::TimeZone;

fn mid(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_owned()).unwrap()
}

fn at(day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 6, day, 0, 0, 0).unwrap()
}

fn channel(id: u128, channel_type: ChannelType) -> ChannelRecord {
    ChannelRecord {
        id: Uuid::from_u128(id),
        channel_type,
        support_name: false,
    }
}

fn member(channel: u128, user: &str, joined: u32, left: Option<u32>) -> ChannelMember {
    ChannelMember {
        channel_id: Uuid::from_u128(channel),
        user: mid(user),
        joined_at: at(joined),
        left_at: left.map(at),
    }
}

/// Every (owner, contact) row the writes add, sorted and deduplicated.
fn rows(directory: &ChannelDirectory, writes: &[InteractionWrite]) -> Vec<(String, String)> {
    let mut rows = BTreeSet::new();
    for write in writes {
        let (users, peers) = directory.resolve(write);
        for user in &users {
            for peer in peers.iter().filter(|peer| *peer != user) {
                rows.insert((user.to_string(), peer.to_string()));
                rows.insert((peer.to_string(), user.to_string()));
            }
        }
    }
    rows.into_iter().collect()
}

use std::collections::BTreeSet;

#[test]
fn shared_channel_writes_pair_every_two_members_once_in_bounded_chunks() {
    let mut loader = ChannelLoader::default();
    let members: Vec<_> = (0..23)
        .map(|n| member(1, &format!("macro|u{n:02}@example.com"), 1, None))
        .collect();
    loader.add_channels(
        vec![channel(1, ChannelType::Public)],
        members,
        &HashSet::new(),
    );
    let directory = loader.finish();

    let writes: Vec<_> = directory.interaction_writes(None).flatten().collect();

    assert!(
        writes
            .iter()
            .all(|w| w.users.len() <= USERS_PER_WRITE && w.peers.len() <= PEERS_PER_WRITE)
    );
    assert_eq!(rows(&directory, &writes).len(), 23 * 22);
    // Triangular chunks: each unordered pair is attempted once, plus pairs
    // inside a users chunk, which appear in both orders.
    let attempted: u64 = writes.iter().map(InteractionWrite::attempted_rows).sum();
    assert!(attempted < 2 * 23 * 22, "attempted {attempted}");
}

#[test]
fn dms_and_support_channels_pair_nobody_through_the_channel_pass() {
    let roster = HashSet::from([mid("macro|support@macro.com")]);
    let mut support = channel(2, ChannelType::Private);
    support.support_name = true;
    let mut loader = ChannelLoader::default();
    loader.add_channels(
        vec![channel(1, ChannelType::DirectMessage), support],
        vec![
            member(1, "macro|a@example.com", 1, None),
            member(1, "macro|b@example.com", 1, None),
            member(2, "macro|new@example.com", 1, None),
            member(2, "macro|support@macro.com", 1, None),
        ],
        &roster,
    );
    let directory = loader.finish();

    assert_eq!(directory.interaction_writes(None).flatten().count(), 0);
    assert_eq!(
        directory.relation(
            &mid("macro|new@example.com"),
            &mid("macro|support@macro.com")
        ),
        ChannelRelation {
            support_channel: true,
            ..ChannelRelation::default()
        }
    );
}

#[test]
fn a_support_name_without_a_roster_address_is_an_ordinary_channel() {
    let mut named = channel(1, ChannelType::Private);
    named.support_name = true;
    let mut loader = ChannelLoader::default();
    loader.add_channels(
        vec![named],
        vec![
            member(1, "macro|a@example.com", 1, None),
            member(1, "macro|b@example.com", 1, None),
        ],
        &HashSet::from([mid("macro|support@macro.com")]),
    );
    let directory = loader.finish();

    assert_eq!(directory.channel_counts(), (1, 0, 0, 0));
    assert_eq!(directory.interaction_writes(None).flatten().count(), 1);
}

#[test]
fn a_dm_counts_only_once_one_of_them_sent_a_message() {
    let mut loader = ChannelLoader::default();
    loader.add_channels(
        vec![
            channel(1, ChannelType::DirectMessage),
            channel(2, ChannelType::DirectMessage),
        ],
        vec![
            member(1, "macro|a@example.com", 1, None),
            member(1, "macro|b@example.com", 1, None),
            member(2, "macro|a@example.com", 1, None),
            member(2, "macro|c@example.com", 1, None),
        ],
        &HashSet::new(),
    );
    loader.mark_person_messages(&[Uuid::from_u128(1)]);
    let directory = loader.finish();

    let writes = directory.direct_message_writes();
    assert_eq!(
        rows(&directory, &writes),
        vec![
            (
                "macro|a@example.com".to_owned(),
                "macro|b@example.com".to_owned()
            ),
            (
                "macro|b@example.com".to_owned(),
                "macro|a@example.com".to_owned()
            ),
        ]
    );
    let a = mid("macro|a@example.com");
    assert_eq!(
        directory
            .relation(&a, &mid("macro|b@example.com"))
            .direct_message,
        Some(true)
    );
    assert_eq!(
        directory
            .relation(&a, &mid("macro|c@example.com"))
            .direct_message,
        Some(false)
    );
}

#[test]
fn members_pair_only_when_their_memberships_overlapped() {
    let mut loader = ChannelLoader::default();
    loader.add_channels(
        vec![channel(1, ChannelType::Team)],
        vec![
            member(1, "macro|early@example.com", 1, Some(3)),
            member(1, "macro|current@example.com", 2, None),
            member(1, "macro|late@example.com", 5, None),
        ],
        &HashSet::new(),
    );
    let directory = loader.finish();

    let writes: Vec<_> = directory.interaction_writes(None).flatten().collect();
    let rows = rows(&directory, &writes);
    assert!(rows.contains(&(
        "macro|early@example.com".to_owned(),
        "macro|current@example.com".to_owned()
    )));
    assert!(rows.contains(&(
        "macro|current@example.com".to_owned(),
        "macro|late@example.com".to_owned()
    )));
    assert!(!rows.contains(&(
        "macro|early@example.com".to_owned(),
        "macro|late@example.com".to_owned()
    )));
    assert!(
        !directory
            .relation(
                &mid("macro|early@example.com"),
                &mid("macro|late@example.com")
            )
            .shared_channel
    );
}

#[test]
fn after_pairs_only_people_who_joined_since_with_every_member() {
    let mut loader = ChannelLoader::default();
    loader.add_channels(
        vec![channel(1, ChannelType::Private)],
        vec![
            member(1, "macro|a@example.com", 1, None),
            member(1, "macro|b@example.com", 1, None),
            member(1, "macro|new@example.com", 10, None),
        ],
        &HashSet::new(),
    );
    let directory = loader.finish();

    let writes: Vec<_> = directory
        .interaction_writes(Some(at(5)))
        .flatten()
        .collect();
    assert_eq!(
        rows(&directory, &writes),
        vec![
            (
                "macro|a@example.com".to_owned(),
                "macro|new@example.com".to_owned()
            ),
            (
                "macro|b@example.com".to_owned(),
                "macro|new@example.com".to_owned()
            ),
            (
                "macro|new@example.com".to_owned(),
                "macro|a@example.com".to_owned()
            ),
            (
                "macro|new@example.com".to_owned(),
                "macro|b@example.com".to_owned()
            ),
        ]
    );
}

#[test]
fn the_snapshot_pairs_people_who_left_and_skips_dms() {
    let mut loader = ChannelLoader::default();
    loader.add_channels(
        vec![
            channel(1, ChannelType::Private),
            channel(2, ChannelType::DirectMessage),
        ],
        vec![
            member(1, "macro|stayed@example.com", 1, None),
            member(2, "macro|x@example.com", 1, None),
            member(2, "macro|y@example.com", 1, None),
        ],
        &HashSet::new(),
    );
    loader.add_snapshots(vec![
        ChannelSnapshot {
            id: 1,
            channel_id: Uuid::from_u128(1),
            taken_at: at(1),
            users: vec![
                mid("macro|stayed@example.com"),
                mid("macro|gone@example.com"),
            ],
        },
        ChannelSnapshot {
            id: 2,
            channel_id: Uuid::from_u128(2),
            taken_at: at(1),
            users: vec![mid("macro|x@example.com"), mid("macro|y@example.com")],
        },
    ]);
    let directory = loader.finish();

    let writes: Vec<_> = directory.interaction_writes(None).flatten().collect();
    assert_eq!(
        rows(&directory, &writes),
        vec![
            (
                "macro|gone@example.com".to_owned(),
                "macro|stayed@example.com".to_owned()
            ),
            (
                "macro|stayed@example.com".to_owned(),
                "macro|gone@example.com".to_owned()
            ),
        ]
    );
    assert!(
        directory
            .relation(
                &mid("macro|gone@example.com"),
                &mid("macro|stayed@example.com")
            )
            .shared_channel
    );
    assert!(
        !directory
            .relation(&mid("macro|x@example.com"), &mid("macro|y@example.com"))
            .shared_channel
    );

    let projection = directory.projections();
    assert_eq!(projection.len(), 1);
    assert_eq!((projection[0].rows, projection[0].snapshot_rows), (0, 2));

    // A snapshot from before `after` is not re-read.
    assert_eq!(
        directory.interaction_writes(Some(at(2))).flatten().count(),
        0
    );
}
