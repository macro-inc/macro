use super::*;
use crate::domain::jid::is_group_jid;
use chrono::Utc;

#[test]
fn unnamed_groups_are_called_after_their_other_members() {
    let me = "15550000001@s.whatsapp.net";
    let person = |jid: &str, name: Option<&str>| Participant {
        identity: Identity {
            jid: jid.into(),
            alternate_jid: None,
            display_name: name.map(Into::into),
        },
        admin: false,
    };
    let mut group = GroupInfo {
        jid: "120363000000000001@g.us".into(),
        name: "  ".into(),
        participants: vec![
            person(me, Some("Me")),
            person("15550000002@s.whatsapp.net", Some("Ana")),
            person("15550000003@s.whatsapp.net", None),
            person("15550000004@s.whatsapp.net", Some("Cy")),
            person("99@lid", None),
        ],
        announce: false,
        disappearing_seconds: None,
        community_parent: false,
        community_jid: None,
        community_announcements: false,
        observed_at: Utc::now(),
    };
    assert_eq!(group.display_name(me), "Ana, +15550000003, +2");
    group.participants.truncate(3);
    assert_eq!(group.display_name(me), "Ana, +15550000003");
    group.participants.truncate(1);
    assert_eq!(group.display_name(me), "WhatsApp group");
    group.name = "Family".into();
    assert_eq!(group.display_name(me), "Family");
}

#[test]
fn group_jids_are_validated_by_shape() {
    assert!(is_group_jid("120363000000000001@g.us"));
    assert!(is_group_jid("15551234567-1600000000@g.us"));
    assert!(!is_group_jid("15551234567@s.whatsapp.net"));
    assert!(!is_group_jid("@g.us"));
    assert!(!is_group_jid("abc@g.us"));
}

#[test]
fn communities_name_their_groups_and_only_the_community_itself_is_closed() {
    let me = "15550000001@s.whatsapp.net";
    let parent = GroupInfo {
        jid: "120363000000000010@g.us".into(),
        name: "Neighbours".into(),
        participants: vec![Participant {
            identity: Identity {
                jid: me.into(),
                alternate_jid: None,
                display_name: None,
            },
            admin: false,
        }],
        announce: false,
        disappearing_seconds: None,
        community_parent: true,
        community_jid: None,
        community_announcements: false,
        observed_at: Utc::now(),
    };
    assert!(!parent.can_post(me), "a community has no chat of its own");
    assert_eq!(parent.community(None), None);

    let subgroup = GroupInfo {
        jid: "120363000000000012@g.us".into(),
        name: "Garden".into(),
        community_parent: false,
        community_jid: Some(parent.jid.clone()),
        disappearing_seconds: Some(86_400),
        ..parent.clone()
    };
    assert!(subgroup.can_post(me), "disappearing messages don't block");
    assert_eq!(
        subgroup.community(Some(&parent)),
        Some(CommunityReference {
            id: parent.jid.clone(),
            name: "Neighbours".into(),
            announcements: false,
        })
    );
    assert_eq!(
        subgroup.community(None).map(|community| community.name),
        Some("WhatsApp community".into()),
        "a community missing from the list still names itself"
    );
}
