use super::*;
use crate::domain::models::Invalidation;
use crate::domain::test_support::{FakeLog, user};
use channels::domain::broker_events::{ChannelMacroEvent, ChannelParticipantRemovedMetadata};
use channels::domain::models::ChannelType;
use email::domain::events::{EmailEventOrigin, EmailMacroEvent, ThreadSpamChangedMetadata};
use event_exposure::{Audience, EntityType};
use std::sync::atomic::{AtomicBool, Ordering};
use teams::domain::events::{TeamMacroEvent, TeamMemberRemovedMetadata};
use teams::domain::model::TeamRole;
use uuid::Uuid;

#[derive(Default)]
struct Switches {
    killed: AtomicBool,
    email: AtomicBool,
}

impl WriterSwitches for Switches {
    async fn writer_enabled(&self) -> bool {
        !self.killed.load(Ordering::SeqCst)
    }

    async fn email_enabled(&self) -> bool {
        self.email.load(Ordering::SeqCst)
    }
}

const CHANNEL: Uuid = Uuid::from_u128(0xc4a);
const TEAM: Uuid = Uuid::from_u128(0x7ea);

fn participant_removed() -> LogMacroEvent {
    LogMacroEvent::ChannelMacroEvent(ChannelMacroEvent::participant_removed(
        ChannelParticipantRemovedMetadata {
            channel_id: CHANNEL,
            channel_type: ChannelType::Private,
            removed_by: user("admin@example.com"),
            removed_user_ids: vec![user("removed@example.com")],
        },
    ))
}

#[tokio::test]
async fn a_public_event_is_appended_with_its_audience_and_the_access_it_changes() {
    let log = FakeLog::default();
    let writer = LogWriter::new(Arc::new(log.clone()), Switches::default());

    let outcome = writer
        .write("macro.channels", &participant_removed())
        .await
        .unwrap();

    assert!(matches!(outcome, WriteOutcome::Appended(_)));
    let entries = log.entries.lock().unwrap();
    let record = &entries[0].1;
    let public = record.event.as_ref().expect("public");
    assert_eq!(public.event.event_name, "channel.participant_removed");
    assert_eq!(public.event.entity_id, CHANNEL.to_string());
    assert!(matches!(
        public.audience,
        Audience::Entity { .. } | Audience::Any(_)
    ));
    assert_eq!(
        record.invalidations,
        vec![Invalidation::Entity {
            entity_type: EntityType::Channel,
            entity_id: CHANNEL.to_string(),
        }]
    );
}

#[tokio::test]
async fn a_public_event_that_changes_access_is_appended_once_with_its_invalidation() {
    let log = FakeLog::default();
    let writer = LogWriter::new(Arc::new(log.clone()), Switches::default());
    let removed =
        LogMacroEvent::TeamMacroEvent(TeamMacroEvent::member_removed(TeamMemberRemovedMetadata {
            team_id: TEAM,
            member_id: user("member@example.com"),
            removed_by: user("owner@example.com"),
            role: TeamRole::Member,
        }));

    writer.write("macro.teams", &removed).await.unwrap();

    let entries = log.entries.lock().unwrap();
    assert_eq!(entries.len(), 1);
    let public = entries[0].1.event.as_ref().expect("public");
    assert_eq!(public.event.event_name, "team.member_removed");
    assert_eq!(
        entries[0].1.invalidations,
        vec![Invalidation::Team {
            team_id: TEAM,
            user_id: Some(user("member@example.com")),
        }]
    );
}

fn email_event() -> LogMacroEvent {
    LogMacroEvent::EmailMacroEvent(EmailMacroEvent::thread_spam_changed(
        ThreadSpamChangedMetadata {
            link_id: Uuid::from_u128(0x11),
            owner: user("owner@example.com"),
            actor: None,
            thread_id: Uuid::from_u128(0x7d),
            spam: true,
            origin: EmailEventOrigin::ProviderSync,
        },
    ))
}

#[tokio::test]
async fn email_is_appended_only_with_its_switch_on() {
    let log = FakeLog::default();
    let switches = Switches::default();
    let writer = LogWriter::new(Arc::new(log.clone()), switches);

    let outcome = writer.write("macro.email", &email_event()).await.unwrap();

    assert_eq!(outcome, WriteOutcome::Skipped("email_disabled"));
    assert!(log.entries.lock().unwrap().is_empty());

    let switches = Switches::default();
    switches.email.store(true, Ordering::SeqCst);
    let writer = LogWriter::new(Arc::new(log.clone()), switches);

    let outcome = writer.write("macro.email", &email_event()).await.unwrap();

    assert!(matches!(outcome, WriteOutcome::Appended(_)));
    let entries = log.entries.lock().unwrap();
    let public = entries[0].1.event.as_ref().expect("public");
    assert_eq!(public.event.event_name, "email.thread_spam_changed");
}

#[tokio::test]
async fn the_kill_switch_stops_appending() {
    let log = FakeLog::default();
    let switches = Switches::default();
    switches.killed.store(true, Ordering::SeqCst);
    let writer = LogWriter::new(Arc::new(log.clone()), switches);

    let outcome = writer
        .write("macro.channels", &participant_removed())
        .await
        .unwrap();

    assert_eq!(outcome, WriteOutcome::Skipped("killed"));
    assert!(log.entries.lock().unwrap().is_empty());
}
