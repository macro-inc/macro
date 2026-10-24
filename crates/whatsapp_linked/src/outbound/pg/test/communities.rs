//! Groups with disappearing messages and the groups of a community are added,
//! kept and sent to like any other group; only the community itself can't be.

use super::*;

const WEEK: u32 = 7 * 24 * 60 * 60;
const COMMUNITY: &str = "120363000000000010@g.us";
const ANNOUNCEMENTS: &str = "120363000000000011@g.us";
const SUBGROUP: &str = "120363000000000012@g.us";

fn named(jid: &str, name: &str, members: &[&str]) -> GroupInfo {
    GroupInfo {
        jid: jid.to_owned(),
        name: name.to_owned(),
        ..group(members)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disappearing_and_community_groups_are_added_like_any_other(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let members = [ALICE_JID, CUSTOMER_JID];
    let disappearing = GroupInfo {
        disappearing_seconds: Some(WEEK),
        ..named(GROUP, "Vanishing", &members)
    };
    let community = GroupInfo {
        community_parent: true,
        ..named(COMMUNITY, "Neighbours", &members)
    };
    let announcements = GroupInfo {
        community_jid: Some(COMMUNITY.to_owned()),
        community_announcements: true,
        announce: true,
        ..named(ANNOUNCEMENTS, "Neighbours", &members)
    };
    let subgroup = GroupInfo {
        community_jid: Some(COMMUNITY.to_owned()),
        ..named(SUBGROUP, "Garden", &members)
    };
    session
        .update_groups(
            alice,
            &[disappearing, community, announcements, subgroup],
            true,
        )
        .await
        .unwrap();

    let chats = linked.chats(ALICE).await.unwrap().chats;
    let listed = |jid: &str| {
        let chat = chats.iter().find(|chat| chat.jid == jid).unwrap();
        (
            chat.can_add,
            chat.cannot_add_reason.clone(),
            chat.community.clone(),
        )
    };
    let neighbours = |announcements| CommunityReference {
        id: COMMUNITY.to_owned(),
        name: "Neighbours".to_owned(),
        announcements,
    };
    assert_eq!(listed(GROUP), (true, None, None));
    assert_eq!(
        listed(COMMUNITY),
        (false, Some(cannot_add::COMMUNITY.to_owned()), None)
    );
    assert_eq!(listed(ANNOUNCEMENTS), (true, None, Some(neighbours(true))));
    assert_eq!(listed(SUBGROUP), (true, None, Some(neighbours(false))));

    let adopt = |jid: &str| {
        let request = AdoptGroup {
            group_jid: jid.to_owned(),
        };
        let linked = &linked;
        async move { linked.adopt(ALICE, &request, SendAuthority::Human).await }
    };
    assert!(matches!(
        adopt(COMMUNITY).await.unwrap_err().current_context(),
        LinkedError::Invalid(reason) if *reason == cannot_add::COMMUNITY
    ));
    let detail = |binding: Binding| {
        let linked = &linked;
        async move {
            linked
                .group_detail(&receipt::<MessageView>(ALICE, binding.id))
                .await
                .unwrap()
        }
    };

    let vanishing = adopt(GROUP).await.unwrap();
    let shown = detail(vanishing.clone()).await;
    assert_eq!(shown.disappearing_seconds, Some(WEEK));
    assert_eq!(shown.community, None);
    assert!(shown.group.can_send);

    let garden = detail(adopt(SUBGROUP).await.unwrap()).await;
    assert_eq!(garden.community, Some(neighbours(false)));
    assert_eq!(garden.disappearing_seconds, None);
    assert!(garden.group.can_send);

    // Everyone reads the announcement group; only admins post.
    let notices = detail(adopt(ANNOUNCEMENTS).await.unwrap()).await;
    assert_eq!(notices.community, Some(neighbours(true)));
    assert_eq!(
        notices.group.send_reason,
        Some(ReplyBlock::NotAllowedInGroup)
    );

    // A message in the disappearing group is kept like any other.
    assert_eq!(
        session
            .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0GONE", "see you"))
            .await
            .unwrap(),
        IngestOutcome::Applied
    );
    let kept = linked
        .messages(&receipt::<MessageView>(ALICE, vanishing.id), None, 10)
        .await
        .unwrap()
        .messages;
    assert_eq!(
        kept.iter()
            .map(|message| message.body.as_str())
            .collect::<Vec<_>>(),
        ["see you"]
    );

    // Macro's sends carry the group's timer.
    linked
        .send_reply(
            &receipt::<MessageWrite>(ALICE, vanishing.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "noted".into(),
                    mentions: vec![],
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let claimed = session.claim_sends(alice, 8).await.unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].disappearing_seconds, Some(WEEK));
}
