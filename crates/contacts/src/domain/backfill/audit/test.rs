use super::*;
use crate::domain::backfill::channels::ChannelLoader;
use crate::domain::models::backfill::{ChannelMember, ChannelRecord};
use chrono::{TimeZone, Utc};
use std::collections::HashSet;
use uuid::Uuid;

fn mid(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_owned()).unwrap()
}

fn edge(user1: &str, user2: &str) -> LegacyEdge {
    LegacyEdge {
        id: 1,
        user1: user1.to_owned(),
        user2: user2.to_owned(),
        ..LegacyEdge::default()
    }
}

#[test]
fn explained_evidence_wins_over_unexplained() {
    let shared = DirectionEvidence {
        channels: ChannelRelation {
            shared_channel: true,
            support_channel: true,
            direct_message: Some(false),
        },
        contact_inbox: true,
        ..DirectionEvidence::default()
    };
    assert_eq!(shared.class(), DirectionClass::SharedChannel);

    let empty_dm = DirectionEvidence {
        channels: ChannelRelation {
            support_channel: true,
            direct_message: Some(false),
            ..ChannelRelation::default()
        },
        referral: true,
        ..DirectionEvidence::default()
    };
    assert_eq!(empty_dm.class(), DirectionClass::EmptyDm);
    assert_eq!(
        DirectionEvidence::default().class(),
        DirectionClass::NoSurvivingRecord
    );
}

#[test]
fn an_import_explains_only_the_importers_direction() {
    let channels = ChannelLoader::default().finish();
    let mut audit = LegacyAudit::default();
    let mut imported = edge("macro|a@example.com", "macro|b@example.com");
    imported.user1_inbox_has_user2 = true;
    audit.add_edge(&imported, &channels);

    assert_eq!(
        (
            audit.edges,
            audit.directions,
            audit.explained,
            audit.unexplained
        ),
        (1, 2, 1, 1)
    );
    assert_eq!(
        audit.classes,
        BTreeMap::from([
            (DirectionClass::Inbox, 1),
            (DirectionClass::ReverseImport, 1)
        ])
    );
}

#[test]
fn channel_evidence_applies_to_both_directions_and_bad_ids_are_counted() {
    let mut loader = ChannelLoader::default();
    let joined = Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap();
    loader.add_channels(
        vec![ChannelRecord {
            id: Uuid::from_u128(1),
            channel_type: ChannelType::Public,
            support_name: false,
        }],
        ["macro|a@example.com", "macro|b@example.com"]
            .into_iter()
            .map(|user| ChannelMember {
                channel_id: Uuid::from_u128(1),
                user: mid(user),
                joined_at: joined,
                left_at: None,
            })
            .collect(),
        &HashSet::new(),
    );
    let channels = loader.finish();

    let mut audit = LegacyAudit::default();
    audit.add_edge(
        &edge("macro|A@example.com", "macro|b@example.com"),
        &channels,
    );
    audit.add_edge(&edge("macro|a@example.com", "not-a-user"), &channels);

    assert_eq!(
        audit.classes,
        BTreeMap::from([
            (DirectionClass::SharedChannel, 2),
            (DirectionClass::InvalidId, 2)
        ])
    );
    assert_eq!(audit.evidence.shared_channel, 2);

    let projection = InteractedProjection::new(&channels);
    assert_eq!(projection.channel_rows, 2);
    let bucket = projection
        .by_channel_size
        .iter()
        .find(|b| b.members == "2")
        .unwrap();
    assert_eq!((bucket.channels, bucket.rows), (1, 2));
    assert_eq!(projection.by_channel_size.last().unwrap().members, "5001+");
}
