//! Fan-out per audience class: who receives an event, who stops receiving
//! when access changes, and how much access work one event costs.

use crate::domain::models::{
    Invalidation, LogRecord, PrincipalKind, StreamPrincipal, WebhookScope,
};
use crate::domain::ports::TeamRole;
use crate::domain::test_support::*;
use event_exposure::{Audience, EntityType, MinTeamRole};
use std::sync::atomic::Ordering;
use uuid::Uuid;

const TEAM: Uuid = Uuid::from_u128(0x7ea7);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x07e7);
const BOT: Uuid = Uuid::from_u128(0xb07);

/// A bot acting for `acting`; `owned` when `acting` owns it (a team bot
/// acting for a member never is).
fn bot(acting: &macro_user_id::user_id::MacroUserIdStr<'static>, owned: bool) -> StreamPrincipal {
    StreamPrincipal {
        kind: PrincipalKind::Bot {
            bot_id: BOT,
            user: acting.clone(),
            owned_by_user: owned,
        },
        credential_id: "bot-token".to_owned(),
    }
}

#[tokio::test(start_paused = true)]
async fn an_entity_event_reaches_accessors_and_nobody_else() {
    let harness = Harness::default();
    let owner = user("owner@example.com");
    let stranger = user("stranger@example.com");
    harness
        .access
        .grant(EntityType::Document, DOC, owner.as_ref());
    let mut owner_stream = harness
        .open(
            person(&owner),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .unwrap();
    // A link-share viewer is not an accessor: they are absent from the set.
    let mut stranger_stream = harness
        .open(
            person(&stranger),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("document.updated", "document", DOC),
            entity(EntityType::Document, DOC),
        ))
        .await;

    assert_eq!(
        owner_stream.next_event_name().await.as_deref(),
        Some("document.updated")
    );
    assert_eq!(stranger_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_revoked_accessor_stops_receiving_once_the_revocation_is_logged() {
    let harness = Harness::default();
    let member = user("member@example.com");
    harness
        .access
        .grant(EntityType::Channel, CHANNEL, member.as_ref());
    let mut stream = harness
        .open(
            person(&member),
            WebhookScope::User,
            filter(&["message.posted"]),
            None,
        )
        .await
        .unwrap();
    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;
    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("message.posted")
    );

    harness
        .access
        .revoke(EntityType::Channel, CHANNEL, member.as_ref());
    harness
        .publish(LogRecord {
            event: None,
            invalidations: vec![Invalidation::Entity {
                entity_type: EntityType::Channel,
                entity_id: CHANNEL.to_owned(),
            }],
        })
        .await;
    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;

    assert_eq!(stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_removed_participant_still_receives_their_removal() {
    let harness = Harness::default();
    let removed = user("removed@example.com");
    let mut stream = harness
        .open(
            person(&removed),
            WebhookScope::User,
            filter(&["channel.participant_removed", "message.posted"]),
            None,
        )
        .await
        .unwrap();

    // The grant is already gone when the event is consumed.
    let mut removal = public(
        event("channel.participant_removed", "channel", CHANNEL),
        Audience::Any(vec![
            entity(EntityType::Channel, CHANNEL),
            Audience::Snapshot {
                user_ids: vec![removed.clone()],
            },
        ]),
    );
    removal.invalidations = vec![Invalidation::Entity {
        entity_type: EntityType::Channel,
        entity_id: CHANNEL.to_owned(),
    }];
    harness.publish(removal).await;
    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;

    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("channel.participant_removed")
    );
    assert_eq!(stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_recipient_event_reaches_only_its_recipient_and_never_a_borrowed_bot() {
    let harness = Harness::default();
    let callee = user("callee@example.com");
    let other = user("other@example.com");
    let recipient = Audience::Recipient {
        user_id: callee.clone(),
    };
    let mut callee_stream = harness
        .open(
            person(&callee),
            WebhookScope::User,
            filter(&["call.ringing"]),
            None,
        )
        .await
        .unwrap();
    let mut other_stream = harness
        .open(
            person(&other),
            WebhookScope::User,
            filter(&["call.ringing"]),
            None,
        )
        .await
        .unwrap();
    let mut borrowed_bot = harness
        .open(
            bot(&callee, false),
            WebhookScope::User,
            filter(&["call.ringing"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(event("call.ringing", "call", DOC), recipient))
        .await;

    assert_eq!(
        callee_stream.next_event_name().await.as_deref(),
        Some("call.ringing")
    );
    assert_eq!(other_stream.next_event_name().await, None);
    assert_eq!(borrowed_bot.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn an_owner_event_reaches_the_owner_and_their_own_bot() {
    let harness = Harness::default();
    let owner = user("owner@example.com");
    let other = user("other@example.com");
    let mut owned_bot = harness
        .open(
            bot(&owner, true),
            WebhookScope::User,
            filter(&["agent_session.deleted"]),
            None,
        )
        .await
        .unwrap();
    let mut team_scope = harness
        .open(
            person(&owner),
            WebhookScope::User,
            filter(&["agent_session.deleted"]),
            None,
        )
        .await
        .unwrap();
    let mut other_stream = harness
        .open(
            person(&other),
            WebhookScope::User,
            filter(&["agent_session.deleted"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("agent_session.deleted", "agent_session", DOC),
            Audience::Owner {
                user_id: owner.clone(),
            },
        ))
        .await;

    assert_eq!(
        owned_bot.next_event_name().await.as_deref(),
        Some("agent_session.deleted")
    );
    assert_eq!(
        team_scope.next_event_name().await.as_deref(),
        Some("agent_session.deleted")
    );
    assert_eq!(other_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_team_event_reaches_members_and_admin_events_only_admins() {
    let harness = Harness::default();
    let admin = user("admin@example.com");
    let member = user("member@example.com");
    let outsider = user("outsider@example.com");
    harness.teams.add(TEAM, &admin, TeamRole::Admin);
    harness.teams.add(TEAM, &member, TeamRole::Member);
    let names = &["team.updated", "team.invite_created"];
    let mut admin_stream = harness
        .open(person(&admin), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut member_stream = harness
        .open(person(&member), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut outsider_stream = harness
        .open(person(&outsider), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut bot_stream = harness
        .open(bot(&member, false), WebhookScope::User, filter(names), None)
        .await
        .unwrap();

    harness
        .publish(public(
            event("team.updated", "team", &TEAM.to_string()),
            Audience::Team {
                team_id: TEAM,
                min_role: MinTeamRole::Member,
            },
        ))
        .await;
    harness
        .publish(public(
            event("team.invite_created", "team", &TEAM.to_string()),
            Audience::Team {
                team_id: TEAM,
                min_role: MinTeamRole::Admin,
            },
        ))
        .await;

    assert_eq!(
        admin_stream.next_event_name().await.as_deref(),
        Some("team.updated")
    );
    assert_eq!(
        admin_stream.next_event_name().await.as_deref(),
        Some("team.invite_created")
    );
    assert_eq!(
        member_stream.next_event_name().await.as_deref(),
        Some("team.updated")
    );
    assert_eq!(member_stream.next_event_name().await, None);
    assert_eq!(outsider_stream.next_event_name().await, None);
    assert_eq!(
        bot_stream.next_event_name().await.as_deref(),
        Some("team.updated")
    );
    assert_eq!(bot_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_member_removed_from_a_team_stops_receiving_its_events() {
    let harness = Harness::default();
    let member = user("member@example.com");
    harness.teams.add(TEAM, &member, TeamRole::Member);
    let team = Audience::Team {
        team_id: TEAM,
        min_role: MinTeamRole::Member,
    };
    let mut stream = harness
        .open(
            person(&member),
            WebhookScope::User,
            filter(&["team.updated"]),
            None,
        )
        .await
        .unwrap();
    harness
        .publish(public(
            event("team.updated", "team", &TEAM.to_string()),
            team.clone(),
        ))
        .await;
    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("team.updated")
    );

    harness.teams.remove(TEAM, &member);
    harness
        .publish(LogRecord {
            event: None,
            invalidations: vec![Invalidation::Team {
                team_id: TEAM,
                user_id: Some(member.clone()),
            }],
        })
        .await;
    harness
        .publish(public(
            event("team.updated", "team", &TEAM.to_string()),
            team,
        ))
        .await;

    assert_eq!(stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_teams_of_event_reaches_streams_of_the_users_teams() {
    let harness = Harness::default();
    let subject = user("subject@example.com");
    let teammate = user("teammate@example.com");
    let elsewhere = user("elsewhere@example.com");
    harness.teams.add(TEAM, &subject, TeamRole::Member);
    harness.teams.add(TEAM, &teammate, TeamRole::Member);
    harness.teams.add(OTHER_TEAM, &elsewhere, TeamRole::Owner);
    let mut teammate_stream = harness
        .open(
            person(&teammate),
            WebhookScope::Team,
            filter(&["user.picture_changed"]),
            None,
        )
        .await
        .unwrap();
    let mut elsewhere_stream = harness
        .open(
            person(&elsewhere),
            WebhookScope::Team,
            filter(&["user.picture_changed"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("user.picture_changed", "user", subject.as_ref()),
            Audience::TeamsOf {
                user_id: subject.clone(),
            },
        ))
        .await;

    assert_eq!(
        teammate_stream.next_event_name().await.as_deref(),
        Some("user.picture_changed")
    );
    assert_eq!(elsewhere_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_contacts_of_event_reaches_the_user_and_their_contacts_only() {
    let harness = Harness::default();
    let subject = user("subject@example.com");
    let contact = user("contact@example.com");
    let stranger = user("stranger@example.com");
    harness.contacts.connect(&subject, &contact);
    let audience = Audience::ContactsOf {
        user_id: subject.clone(),
    };
    let names = &["user.picture_changed"];
    let mut subject_stream = harness
        .open(person(&subject), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut contact_stream = harness
        .open(person(&contact), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut stranger_stream = harness
        .open(person(&stranger), WebhookScope::User, filter(names), None)
        .await
        .unwrap();

    harness
        .publish(public(
            event("user.picture_changed", "user", subject.as_ref()),
            audience,
        ))
        .await;

    assert_eq!(
        subject_stream.next_event_name().await.as_deref(),
        Some("user.picture_changed")
    );
    assert_eq!(
        contact_stream.next_event_name().await.as_deref(),
        Some("user.picture_changed")
    );
    assert_eq!(stranger_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_workspace_event_reaches_only_the_matching_workspace_stream() {
    let harness = Harness::default();
    let owner = user("owner@example.com");
    let teammate = user("teammate@example.com");
    harness.teams.add(TEAM, &owner, TeamRole::Owner);
    harness.teams.add(TEAM, &teammate, TeamRole::Member);
    let names = &["webhook.created"];
    let mut personal = harness
        .open(person(&owner), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut team_stream = harness
        .open(person(&teammate), WebhookScope::Team, filter(names), None)
        .await
        .unwrap();
    let mut teammate_personal = harness
        .open(person(&teammate), WebhookScope::User, filter(names), None)
        .await
        .unwrap();

    harness
        .publish(public(
            event("webhook.created", "webhook", "wh_personal"),
            Audience::Workspace {
                workspace_id: owner.as_ref().to_owned(),
            },
        ))
        .await;
    harness
        .publish(public(
            event("webhook.created", "webhook", "wh_team"),
            Audience::Workspace {
                workspace_id: TEAM.to_string(),
            },
        ))
        .await;

    assert_eq!(
        personal.next_event_name().await.as_deref(),
        Some("webhook.created")
    );
    assert_eq!(personal.next_event_name().await, None);
    assert_eq!(
        team_stream.next_event_name().await.as_deref(),
        Some("webhook.created")
    );
    assert_eq!(team_stream.next_event_name().await, None);
    assert_eq!(teammate_personal.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_bot_listens_as_its_acting_user_without_their_personal_events() {
    let harness = Harness::default();
    let member = user("member@example.com");
    harness
        .access
        .grant(EntityType::Document, DOC, member.as_ref());
    let mut stream = harness
        .open(
            bot(&member, false),
            WebhookScope::User,
            filter(&["document.updated", "call.ringing", "webhook.created"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("document.updated", "document", DOC),
            entity(EntityType::Document, DOC),
        ))
        .await;
    harness
        .publish(public(
            event("call.ringing", "call", DOC),
            Audience::Recipient {
                user_id: member.clone(),
            },
        ))
        .await;

    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("document.updated")
    );
    assert_eq!(stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn an_account_manager_never_receives_webhook_lifecycle() {
    let harness = Harness::default();
    let managed = user("managed@example.com");
    let manager = StreamPrincipal {
        kind: PrincipalKind::AccountManager {
            user: managed.clone(),
        },
        credential_id: "manager-key".to_owned(),
    };
    harness
        .access
        .grant(EntityType::Document, DOC, managed.as_ref());
    let mut stream = harness
        .open(
            manager,
            WebhookScope::User,
            filter(&["webhook.created", "document.updated"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("webhook.created", "webhook", "wh_1"),
            Audience::Workspace {
                workspace_id: managed.as_ref().to_owned(),
            },
        ))
        .await;
    harness
        .publish(public(
            event("document.updated", "document", DOC),
            entity(EntityType::Document, DOC),
        ))
        .await;

    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("document.updated")
    );
    assert_eq!(stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn many_listeners_cost_one_accessor_lookup_and_few_cost_exact_checks() {
    let harness = Harness::default();
    let mut streams = Vec::new();
    for index in 0..20 {
        let listener = user(&format!("listener{index}@example.com"));
        harness
            .access
            .grant(EntityType::Channel, CHANNEL, listener.as_ref());
        streams.push(
            harness
                .open(
                    person(&listener),
                    WebhookScope::User,
                    filter(&["message.posted"]),
                    None,
                )
                .await
                .unwrap(),
        );
    }

    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;
    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;

    assert_eq!(
        harness.access.list_calls.load(Ordering::SeqCst),
        1,
        "cached for the second event"
    );
    assert_eq!(harness.access.exact_calls.load(Ordering::SeqCst), 0);
    for stream in &mut streams {
        assert_eq!(
            stream.next_event_name().await.as_deref(),
            Some("message.posted")
        );
    }

    let few = Harness::default();
    let one = user("one@example.com");
    few.access.grant(EntityType::Channel, CHANNEL, one.as_ref());
    let mut stream = few
        .open(
            person(&one),
            WebhookScope::User,
            filter(&["message.posted"]),
            None,
        )
        .await
        .unwrap();
    few.publish(public(
        event("message.posted", "channel", CHANNEL),
        entity(EntityType::Channel, CHANNEL),
    ))
    .await;

    assert_eq!(few.access.list_calls.load(Ordering::SeqCst), 0);
    assert_eq!(few.access.exact_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("message.posted")
    );
}

#[tokio::test(start_paused = true)]
async fn an_event_no_stream_filters_for_costs_no_access_lookup() {
    let harness = Harness::default();
    let listener = user("listener@example.com");
    let _stream = harness
        .open(
            person(&listener),
            WebhookScope::User,
            filter(&["document.created"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;

    assert_eq!(harness.access.list_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.access.exact_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn a_failed_access_lookup_drops_the_event_and_keeps_the_stream() {
    let harness = Harness::default();
    let listener = user("listener@example.com");
    let mut stream = harness
        .open(
            person(&listener),
            WebhookScope::User,
            filter(&["message.posted"]),
            None,
        )
        .await
        .unwrap();
    harness.access.state.lock().unwrap().fail = true;

    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;

    assert_eq!(stream.next_event_name().await, None);

    harness.access.state.lock().unwrap().fail = false;
    harness
        .access
        .grant(EntityType::Channel, CHANNEL, listener.as_ref());
    harness
        .publish(public(
            event("message.posted", "channel", CHANNEL),
            entity(EntityType::Channel, CHANNEL),
        ))
        .await;
    assert_eq!(
        stream.next_event_name().await.as_deref(),
        Some("message.posted")
    );
}

#[tokio::test(start_paused = true)]
async fn a_deleted_bot_loses_its_streams() {
    let harness = Harness::default();
    let acting = user("acting@example.com");
    let mut stream = harness
        .open(
            bot(&acting, true),
            WebhookScope::User,
            filter(&["team.updated"]),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(LogRecord {
            event: None,
            invalidations: vec![Invalidation::BotDeleted { bot_id: BOT }],
        })
        .await;

    match stream.next_now().await {
        Some(crate::domain::models::StreamItem::Control(control)) => assert_eq!(
            control,
            crate::domain::models::ControlEvent::Revoked {
                reason: "bot_deleted"
            }
        ),
        other => panic!("expected a revoked control event, got {other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn a_github_installation_event_reaches_only_claimants() {
    let harness = Harness::default();
    let claimant = user("claimant@example.com");
    let teammate_without_link = user("unlinked@example.com");
    harness.github.claim(&claimant, "4242");
    let names = &["github_webhook.received"];
    let mut claimant_stream = harness
        .open(person(&claimant), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut other_stream = harness
        .open(
            person(&teammate_without_link),
            WebhookScope::User,
            filter(names),
            None,
        )
        .await
        .unwrap();

    harness
        .publish(public(
            event("github_webhook.received", "github_installation", "4242"),
            Audience::GithubInstallation {
                installation_id: "4242".to_owned(),
            },
        ))
        .await;

    assert_eq!(
        claimant_stream.next_event_name().await.as_deref(),
        Some("github_webhook.received")
    );
    assert_eq!(other_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn an_entity_at_least_event_reaches_only_accessors_at_that_level() {
    use event_exposure::MinAccessLevel;
    let harness = Harness::default();
    let editor = user("editor@example.com");
    let viewer = user("viewer@example.com");
    let form = "0193b3a0-0000-7000-8000-0000000f0f00";
    harness
        .access
        .grant(EntityType::Form, form, editor.as_ref());
    harness
        .access
        .grant(EntityType::Form, form, viewer.as_ref());
    harness.access.set_level(
        EntityType::Form,
        form,
        editor.as_ref(),
        MinAccessLevel::Edit,
    );
    let names = &["form.response_submitted"];
    let mut editor_stream = harness
        .open(person(&editor), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut viewer_stream = harness
        .open(person(&viewer), WebhookScope::User, filter(names), None)
        .await
        .unwrap();

    harness
        .publish(public(
            event("form.response_submitted", "form", form),
            Audience::EntityAtLeast {
                entity_type: EntityType::Form,
                entity_id: form.to_owned(),
                min_level: MinAccessLevel::Edit,
            },
        ))
        .await;

    assert_eq!(
        editor_stream.next_event_name().await.as_deref(),
        Some("form.response_submitted")
    );
    assert_eq!(viewer_stream.next_event_name().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_recipient_nested_in_any_still_excludes_a_borrowed_bot() {
    let harness = Harness::default();
    let first = user("first@example.com");
    let second = user("second@example.com");
    let audience = Audience::Any(vec![
        Audience::Recipient {
            user_id: first.clone(),
        },
        Audience::Recipient {
            user_id: second.clone(),
        },
    ]);
    let names = &["notification.created"];
    let mut person_stream = harness
        .open(person(&first), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut owned_bot = harness
        .open(bot(&second, true), WebhookScope::User, filter(names), None)
        .await
        .unwrap();
    let mut borrowed_bot = harness
        .open(bot(&first, false), WebhookScope::User, filter(names), None)
        .await
        .unwrap();

    harness
        .publish(public(
            event("notification.created", "notification", DOC),
            audience,
        ))
        .await;

    assert_eq!(
        person_stream.next_event_name().await.as_deref(),
        Some("notification.created")
    );
    assert_eq!(
        owned_bot.next_event_name().await.as_deref(),
        Some("notification.created")
    );
    assert_eq!(borrowed_bot.next_event_name().await, None);
}
