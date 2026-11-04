use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

#[derive(Clone, Default)]
struct Eligibility(Arc<AtomicBool>);

impl AgentDmAuthorizer for Eligibility {
    async fn authorize(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
    ) -> Result<(), ChannelMutationErr> {
        if self.0.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(ChannelMutationErr::Forbidden(
                "agent unavailable".to_owned(),
            ))
        }
    }
}

#[derive(Clone, Default)]
struct Repo(Arc<AtomicUsize>);

impl AgentDmRepo for Repo {
    async fn for_user(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<AgentDm>, ChannelMutationErr> {
        unreachable!("creation does not enumerate conversations")
    }
    async fn ensure(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<EnsuredAgentDm, ChannelMutationErr> {
        Ok(EnsuredAgentDm {
            dm: AgentDm {
                channel_id: Uuid::from_u128(42),
                user_id,
                bot_id,
            },
            created: self.0.fetch_add(1, Ordering::SeqCst) == 0,
        })
    }
}

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<ChannelEvent>>>);

impl ChannelEventDispatcher for Events {
    fn dispatch(&self, event: ChannelEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|person@example.com".to_owned()).unwrap()
}

#[tokio::test]
async fn reopening_reuses_the_dm_and_only_creation_notifies_the_human() {
    let eligibility = Eligibility::default();
    eligibility.0.store(true, Ordering::SeqCst);
    let events = Events::default();
    let service = AgentDmService::new(Repo::default(), eligibility, events.clone());
    let first = service
        .get_or_create(user(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    let second = service
        .get_or_create(user(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    assert_eq!(first.channel_id, second.channel_id);
    assert_eq!(first.action, GetOrCreateAction::Create);
    assert_eq!(second.action, GetOrCreateAction::Get);
    let events = events.0.lock().unwrap();
    assert!(
        matches!(events.as_slice(), [ChannelEvent::ChannelCreated { participant_user_ids, channel_type: ChannelType::DirectMessage, .. }] if participant_user_ids == &vec![user()])
    );
}

#[tokio::test]
async fn revoked_persona_access_cannot_restore_or_create_membership() {
    let eligibility = Eligibility::default();
    eligibility.0.store(true, Ordering::SeqCst);
    let repo = Repo::default();
    let events = Events::default();
    let service = AgentDmService::new(repo.clone(), eligibility.clone(), events.clone());
    service
        .get_or_create(user(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    eligibility.0.store(false, Ordering::SeqCst);
    assert!(matches!(
        service
            .get_or_create(user(), bot_id::MACRO_NEW_BOT_ID)
            .await,
        Err(ChannelMutationErr::Forbidden(_))
    ));
    assert_eq!(repo.0.load(Ordering::SeqCst), 1);
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn unavailable_persona_does_not_create_a_channel() {
    let repo = Repo::default();
    let events = Events::default();
    let service = AgentDmService::new(repo.clone(), Eligibility::default(), events.clone());
    assert!(
        service
            .get_or_create(user(), bot_id::MACRO_NEW_BOT_ID)
            .await
            .is_err()
    );
    assert_eq!(repo.0.load(Ordering::SeqCst), 0);
    assert!(events.0.lock().unwrap().is_empty());
}
