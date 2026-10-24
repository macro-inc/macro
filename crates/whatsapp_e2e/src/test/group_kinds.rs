//! Groups with disappearing messages and the groups of a community, end to
//! end: added, kept and sent to like any other group; the community itself
//! can't be added.

use whatsapp_fake_server::GroupChange;
use whatsapp_linked::domain::models::{CommunityReference, LinkedError, ReplyBlock, cannot_add};
use whatsmeow::proto::wa_e2e::{ContextInfo, ExtendedTextMessage, FutureProofMessage, Message};

use super::*;

const WEEK: u32 = 7 * 24 * 60 * 60;

/// The context of an extended text the customer's phone received.
fn context(received: &whatsapp_fake_server::ReceivedMessage) -> Option<&ContextInfo> {
    received
        .message
        .extended_text_message
        .as_ref()
        .and_then(|extended| extended.context_info.as_deref())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_disappearing_group_is_kept_in_macro_and_macro_sends_disappear(pool: PgPool) {
    let world = World::new(pool).await;
    world.whatsapp.change_group(
        &world.group,
        Some(&world.customer),
        GroupChange::Disappearing(Some(WEEK)),
    );
    let replica = world.replica().await;
    let (_, binding) = world.alice_adopted().await;
    let detail = world
        .linked
        .group_detail(&receipt::<ViewAccessLevel>(ALICE, binding.id))
        .await
        .unwrap();
    assert_eq!(detail.disappearing_seconds, Some(WEEK));
    assert!(detail.group.can_send);

    // The customer's phone wraps its messages as disappearing.
    let gone = world
        .customer
        .send_message(
            &world.group,
            Message {
                ephemeral_message: Some(Box::new(FutureProofMessage {
                    message: Some(Box::new(Message {
                        extended_text_message: Some(Box::new(ExtendedTextMessage {
                            text: Some("this vanishes on phones".to_owned()),
                            context_info: Some(Box::new(ContextInfo {
                                expiration: Some(WEEK),
                                ..ContextInfo::default()
                            })),
                            ..ExtendedTextMessage::default()
                        })),
                        ..Message::default()
                    })),
                })),
                ..Message::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        world.timeline(&binding, &gone).await,
        ["this vanishes on phones"],
        "Macro keeps it"
    );

    let send = world.send(ALICE, &binding, "kept in Macro").await;
    let received = world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some("kept in Macro"))
        .await
        .expect("the customer's phone receives Alice's message");
    assert_eq!(
        context(&received).and_then(|context| context.expiration),
        Some(WEEK),
        "it disappears on phones like the group's own messages"
    );
    world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;

    // Turning it off reaches Macro live, and sends stop carrying a timer.
    world.whatsapp.change_group(
        &world.group,
        Some(&world.customer),
        GroupChange::Disappearing(None),
    );
    let off = wait_for_rows(&world.pool, TIMEOUT, || async {
        let detail = world
            .linked
            .group_detail(&receipt::<ViewAccessLevel>(ALICE, binding.id))
            .await
            .ok()?;
        detail.disappearing_seconds.is_none().then_some(())
    })
    .await;
    world.expect(off, "the timer is gone from the detail").await;
    world.send(ALICE, &binding, "plain again").await;
    let received = world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some("plain again"))
        .await
        .expect("the customer's phone receives the next message");
    assert_eq!(
        context(&received).and_then(|context| context.expiration),
        None
    );

    replica.drain(TIMEOUT).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_communitys_groups_are_added_and_used_but_not_the_community(pool: PgPool) {
    let world = World::new(pool).await;
    let members = [&world.customer, &world.alice];
    let (community, announcements) = world.whatsapp.create_community("Neighbours", &members);
    let garden = world
        .whatsapp
        .create_community_group(&community, "Garden", &members);
    let replica = world.replica().await;
    world.pair(ALICE, &world.alice).await;

    let garden_jid = garden.to_string();
    let chats = wait_for_rows(&world.pool, TIMEOUT, || async {
        let chats = world.linked.chats(ALICE).await.ok()?.chats;
        chats
            .iter()
            .any(|chat| chat.jid == garden_jid)
            .then_some(chats)
    })
    .await;
    let chats = world.expect(chats, "the replica lists the community").await;
    let listed = |jid: &Jid| {
        let chat = chats
            .iter()
            .find(|chat| chat.jid == jid.to_string())
            .expect("listed");
        (
            chat.can_add,
            chat.cannot_add_reason.clone(),
            chat.community.clone(),
        )
    };
    let neighbours = |announcements| CommunityReference {
        id: community.to_string(),
        name: "Neighbours".to_owned(),
        announcements,
    };
    assert_eq!(
        listed(&community),
        (false, Some(cannot_add::COMMUNITY.to_owned()), None)
    );
    assert_eq!(listed(&garden), (true, None, Some(neighbours(false))));
    assert_eq!(listed(&announcements), (true, None, Some(neighbours(true))));

    let adopt = |jid: &Jid| {
        let request = AdoptGroup {
            group_jid: jid.to_string(),
        };
        let linked = &world.linked;
        async move { linked.adopt(ALICE, &request, SendAuthority::Human).await }
    };
    assert!(matches!(
        adopt(&community).await.unwrap_err().current_context(),
        LinkedError::Invalid(reason) if *reason == cannot_add::COMMUNITY
    ));

    // A community's group works like any group, both ways.
    let binding = adopt(&garden).await.unwrap();
    let detail = world
        .linked
        .group_detail(&receipt::<ViewAccessLevel>(ALICE, binding.id))
        .await
        .unwrap();
    assert_eq!(detail.community, Some(neighbours(false)));
    assert!(detail.group.can_send);
    let tomatoes = world
        .customer
        .send_text(&garden, "tomatoes are ready")
        .await
        .unwrap();
    assert_eq!(
        world.timeline(&binding, &tomatoes).await,
        ["tomatoes are ready"]
    );
    let send = world.send(ALICE, &binding, "I'll take some").await;
    world
        .customer
        .wait_for_message(TIMEOUT, |message| message.text() == Some("I'll take some"))
        .await
        .expect("the customer's phone receives Alice's message");
    world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;

    // Everyone reads the announcement group; only its admins post.
    let notices = adopt(&announcements).await.unwrap();
    let detail = world
        .linked
        .group_detail(&receipt::<ViewAccessLevel>(ALICE, notices.id))
        .await
        .unwrap();
    assert_eq!(detail.community, Some(neighbours(true)));
    assert_eq!(
        detail.group.send_reason,
        Some(ReplyBlock::NotAllowedInGroup)
    );
    let notice = world
        .customer
        .send_text(&announcements, "street party on Sunday")
        .await
        .unwrap();
    assert_eq!(
        world.timeline(&notices, &notice).await,
        ["street party on Sunday"]
    );

    replica.drain(TIMEOUT).await.unwrap();
}
