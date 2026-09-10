use super::*;
use crate::domain::{
    dm::ensure_dms_for_joining_member,
    events::ChannelEvent,
    models::{
        Activity, ActivityType, ChannelAttachment, ChannelAttachmentType, ChannelInfo,
        ChannelMetadata, ChannelParticipant, ChannelType, CreateChannelRequest,
        CreateEntityMentionOptions, CreatedChannel, EntityMention, GetOrCreateDmRequest,
        ParticipantRole, PatchChannelRequest, Sender,
    },
    ports::{ChannelEventDispatcher, ChannelRepo, MockChannelRepo},
};
use channel_sender::ChannelSender;
use chrono::Utc;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::{Arc, Mutex};

fn empty_repo() -> MockChannelRepo {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_channel_attachments()
        .returning(|_, _, _, _| Box::pin(async { Ok(vec![]) }));
    repo.expect_get_channel_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo
}

#[derive(Clone)]
struct FakeMutationRepo {
    state: Arc<Mutex<FakeMutationRepoState>>,
}

struct FakeMutationRepoState {
    channel_id: Uuid,
    channel_name: Option<String>,
    channel_type: ChannelType,
    channel_team_id: Option<Uuid>,
    user_team_id: Option<Uuid>,
    user_team_id_lookups: usize,
    join_code: Option<Uuid>,

    participants: Vec<ChannelParticipant>,
    participant_additions: usize,

    activity_upserts: usize,
    touched_channel_ids: Vec<Uuid>,
    fail_channel_touches: bool,
    removed_participants: Vec<String>,
    channel_patches: Vec<(PatchChannelRequest, Option<Uuid>)>,
}

impl FakeMutationRepo {
    fn new(channel_id: Uuid, sender: &str) -> Self {
        let now = Utc::now();
        Self {
            state: Arc::new(Mutex::new(FakeMutationRepoState {
                channel_id,
                channel_name: Some("Project".to_string()),
                channel_type: ChannelType::Private,
                channel_team_id: None,
                user_team_id: None,
                user_team_id_lookups: 0,
                join_code: None,

                participants: vec![
                    ChannelParticipant {
                        channel_id,
                        user_id: sender.to_string(),
                        role: ParticipantRole::Owner,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: "macro|recipient@test.com".to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                ],
                participant_additions: 0,

                activity_upserts: 0,
                touched_channel_ids: vec![],
                fail_channel_touches: false,
                removed_participants: vec![],
                channel_patches: vec![],
            })),
        }
    }
}

impl ChannelRepo for FakeMutationRepo {
    type Err = anyhow::Error;

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: &Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<ChannelAttachmentType>,
    ) -> Result<Vec<ChannelAttachment>, Self::Err> {
        Ok(vec![])
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, Self::Err> {
        Ok(self.state.lock().unwrap().participants.clone())
    }

    async fn get_attachment_references(
        &self,
        _entity_type: &str,
        _entity_id: &str,
        _user_id: &str,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, Self::Err> {
        Ok(vec![])
    }

    async fn get_channel_info(&self, channel_id: Uuid) -> Result<ChannelInfo, Self::Err> {
        let state = self.state.lock().unwrap();
        Ok(ChannelInfo {
            id: channel_id,
            name: state.channel_name.clone(),
            channel_type: state.channel_type,
            org_id: None,
            team_id: state.channel_team_id,
        })
    }

    async fn get_or_create_channel_join_code(&self, _channel_id: Uuid) -> Result<Uuid, Self::Err> {
        let mut state = self.state.lock().unwrap();
        let join_code = *state.join_code.get_or_insert_with(Uuid::new_v4);
        Ok(join_code)
    }

    async fn get_channel_info_by_join_code(
        &self,
        join_code: Uuid,
    ) -> Result<Option<ChannelInfo>, Self::Err> {
        let state = self.state.lock().unwrap();
        Ok((state.join_code == Some(join_code)).then(|| ChannelInfo {
            id: state.channel_id,
            name: state.channel_name.clone(),
            channel_type: state.channel_type,
            org_id: None,
            team_id: state.channel_team_id,
        }))
    }

    async fn get_channel_metadata(
        &self,
        _channel_id: Uuid,
        _viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<ChannelMetadata, Self::Err> {
        Ok(ChannelMetadata {
            channel_type: ChannelType::Private,
            channel_name: "Project".to_string(),
        })
    }

    async fn batch_get_channel_previews(
        &self,
        _channel_ids: &[String],
        _viewer_user_id: &str,
        _org_id: Option<i64>,
    ) -> Result<Vec<crate::domain::models::ChannelPreviewRow>, Self::Err> {
        Ok(vec![])
    }

    async fn resolve_channel_name(
        &self,
        _info: &ChannelInfo,
        _viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<String, Self::Err> {
        Ok("Project".to_string())
    }

    async fn user_has_team(&self, _user_id: String, _team_id: Uuid) -> Result<bool, Self::Err> {
        Ok(true)
    }

    async fn get_user_team_id(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<Uuid>, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.user_team_id_lookups += 1;
        Ok(state.user_team_id)
    }

    async fn create_channel(
        &self,
        owner_id: MacroUserIdStr<'_>,
        _org_id: Option<i64>,
        req: crate::domain::models::CreateChannelRequest,
    ) -> Result<CreatedChannel, Self::Err> {
        let state = self.state.lock().unwrap();
        let mut participant_user_ids = req.participants;
        participant_user_ids.insert(owner_id.into_owned());
        if req.auto_join_team {
            participant_user_ids.extend(
                state
                    .participants
                    .iter()
                    .map(|participant| macro_id(&participant.user_id)),
            );
        }
        let mut participant_user_ids: Vec<_> = participant_user_ids.into_iter().collect();
        participant_user_ids.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
        Ok(CreatedChannel {
            id: state.channel_id,
            participant_user_ids,
        })
    }

    async fn auto_join_by_team_id(
        &self,
        _team_id: &Uuid,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn leave_by_team_id(
        &self,
        _team_id: &Uuid,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Uuid>, Self::Err> {
        Ok(Vec::new())
    }

    async fn restore_by_channel_ids(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _channel_ids: &[Uuid],
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn maybe_get_dm(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _recipient_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(None)
    }

    async fn maybe_get_private_channel(
        &self,
        _participants: std::collections::HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(None)
    }

    async fn patch_channel(
        &self,
        _channel_id: Uuid,
        _user_id: String,
        team_id: Option<Uuid>,
        req: PatchChannelRequest,
    ) -> Result<(), Self::Err> {
        self.state
            .lock()
            .unwrap()
            .channel_patches
            .push((req, team_id));
        Ok(())
    }

    async fn delete_channel(&self, _channel_id: Uuid, _user_id: String) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn add_participant(
        &self,
        channel_id: Uuid,
        user_id: MacroUserIdStr<'_>,
        role: ParticipantRole,
    ) -> Result<bool, Self::Err> {
        let mut state = self.state.lock().unwrap();
        if let Some(participant) = state
            .participants
            .iter_mut()
            .find(|participant| participant.user_id == user_id.as_ref())
        {
            if participant.left_at.is_none() {
                return Ok(false);
            }
            participant.role = role;
            participant.joined_at = Utc::now();
            participant.left_at = None;
        } else {
            state.participants.push(ChannelParticipant {
                channel_id,
                user_id: user_id.as_ref().to_string(),
                role,
                joined_at: Utc::now(),
                left_at: None,
            });
        }
        state.participant_additions += 1;
        Ok(true)
    }

    async fn remove_participant(
        &self,
        _channel_id: Uuid,
        user_id: String,
    ) -> Result<(), Self::Err> {
        self.state
            .lock()
            .unwrap()
            .removed_participants
            .push(user_id);
        Ok(())
    }

    async fn touch_channel_updated_at(&self, channel_id: Uuid) -> Result<(), Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.touched_channel_ids.push(channel_id);
        if state.fail_channel_touches {
            anyhow::bail!("channel touch failed");
        }
        Ok(())
    }

    async fn create_entity_mention(
        &self,
        _options: CreateEntityMentionOptions,
    ) -> Result<EntityMention, Self::Err> {
        anyhow::bail!("not implemented in test repo")
    }

    async fn get_entity_mention_by_id(
        &self,
        _id: Uuid,
    ) -> Result<Option<EntityMention>, Self::Err> {
        Ok(None)
    }

    async fn delete_entity_mention_by_id(
        &self,
        _id: Uuid,
    ) -> Result<Option<EntityMention>, Self::Err> {
        Ok(None)
    }

    async fn get_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, Self::Err> {
        Ok(self.state.lock().unwrap().participants.clone())
    }

    async fn upsert_activity(
        &self,
        _user_id: ChannelSender<'_>,
        _channel_id: Uuid,
    ) -> Result<(), Self::Err> {
        self.state.lock().unwrap().activity_upserts += 1;
        Ok(())
    }

    async fn get_activities(&self, _user_id: String) -> Result<Vec<Activity>, Self::Err> {
        Ok(Vec::new())
    }

    async fn set_activity(
        &self,
        user_id: String,
        channel_id: Uuid,
        _activity_type: ActivityType,
    ) -> Result<Activity, Self::Err> {
        self.state.lock().unwrap().activity_upserts += 1;
        Ok(Activity {
            id: Uuid::nil(),
            user_id,
            channel_id,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            viewed_at: None,
            interacted_at: None,
        })
    }
}

#[derive(Clone, Default)]
struct FakeEvents {
    events: Arc<Mutex<Vec<ChannelEvent>>>,
}

impl ChannelEventDispatcher for FakeEvents {
    fn dispatch(&self, event: ChannelEvent) {
        self.events.lock().unwrap().push(event);
    }
}

fn mutation_service(
    repo: FakeMutationRepo,
    events: FakeEvents,
) -> ChannelServiceImpl<FakeMutationRepo, FakeEvents> {
    ChannelServiceImpl::with_dependencies(repo, events)
}

fn macro_id(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(user_id.to_string()).unwrap()
}

fn sender(user_id: &str) -> Sender {
    Sender::new_from_user(macro_id(user_id))
}

#[tokio::test]
async fn returns_empty_attachments_page() {
    let svc = ChannelServiceImpl::new(empty_repo());
    let page = svc
        .get_channel_attachments(Uuid::nil(), Query::Sort(CreatedAt, ()), 50, None)
        .await
        .unwrap();

    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn returns_empty_participants_list() {
    let svc = ChannelServiceImpl::new(empty_repo());
    let participants = svc.get_channel_participants(Uuid::nil()).await.unwrap();

    assert!(participants.is_empty());
}

// --- center_window tests ---

// --- get_channel_messages_around tests ---

#[tokio::test]
async fn add_participants_touches_channel_once_when_any_membership_changes() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.add_participants(
        sender("macro|sender@test.com"),
        channel_id,
        AddParticipantsRequest {
            participants: HashSet::from([
                macro_id("macro|recipient@test.com"),
                macro_id("macro|new@test.com"),
            ]),
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.participant_additions, 1);
    assert_eq!(state.touched_channel_ids, vec![channel_id]);
}

#[tokio::test]
async fn add_participants_does_not_touch_channel_when_memberships_are_already_active() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.add_participants(
        sender("macro|sender@test.com"),
        channel_id,
        AddParticipantsRequest {
            participants: HashSet::from([
                macro_id("macro|sender@test.com"),
                macro_id("macro|recipient@test.com"),
            ]),
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.participant_additions, 0);
    assert!(state.touched_channel_ids.is_empty());
}

#[tokio::test]
async fn add_participants_propagates_channel_touch_errors() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().fail_channel_touches = true;
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    let error = svc
        .add_participants(
            sender("macro|sender@test.com"),
            channel_id,
            AddParticipantsRequest {
                participants: HashSet::from([macro_id("macro|new@test.com")]),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ChannelMutationErr::Repo(_)));
    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
}

#[tokio::test]
async fn remove_participants_rejects_removing_channel_owner() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    let err = svc
        .remove_participants(
            sender("macro|recipient@test.com"),
            channel_id,
            RemoveParticipantsRequest {
                participants: vec![
                    "macro|sender@test.com".to_string(),
                    "macro|recipient@test.com".to_string(),
                ],
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(err, ChannelMutationErr::Unauthorized(_)));
    assert!(repo.state.lock().unwrap().removed_participants.is_empty());
}

#[tokio::test]
async fn remove_participants_allows_removing_non_owner() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.remove_participants(
        sender("macro|sender@test.com"),
        channel_id,
        RemoveParticipantsRequest {
            participants: vec!["macro|recipient@test.com".to_string()],
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(
        state.removed_participants,
        vec!["macro|recipient@test.com".to_string()]
    );
    assert!(state.touched_channel_ids.is_empty());
}

#[tokio::test]
async fn create_system_channel_event_uses_system_actor() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|owner@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.create_system_channel(
        macro_id("macro|owner@test.com"),
        crate::domain::models::CreateChannelRequest {
            name: Some("Macro Support x owner".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
            auto_join_team: false,
            participants: HashSet::from([macro_id("macro|teo@macro.com")]),
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated {
            actor,
            on_behalf_of: Some(owner),
            channel_name: Some(name),
            ..
        }] if actor == &Sender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID)
            && owner.as_ref() == "macro|owner@test.com"
            && name == "Macro Support x owner"
    ));
}

#[tokio::test]
async fn create_channel_on_behalf_attributes_created_to_the_bot() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|owner@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.create_channel_on_behalf(
        macro_id("macro|owner@test.com"),
        bot_id::MACRO_AI_BOT_ID,
        crate::domain::models::CreateChannelRequest {
            name: Some("Planning".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
            auto_join_team: false,
            participants: HashSet::from([macro_id("macro|teo@macro.com")]),
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated {
            actor,
            on_behalf_of: Some(owner),
            channel_name: Some(name),
            ..
        }] if actor == &Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID)
            && owner.as_ref() == "macro|owner@test.com"
            && name == "Planning"
    ));
}

/// Signup on main called `create_channel(Sender::new_from_user(owner))`.
/// That is the path that made "Created # Macro Support x …" render as You.
#[tokio::test]
async fn signup_support_channel_via_user_create_channel_attributes_created_to_owner() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|owner@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.create_channel(
        sender("macro|owner@test.com"),
        None,
        crate::domain::models::CreateChannelRequest {
            name: Some("Macro Support x owner".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
            auto_join_team: false,
            participants: HashSet::from([macro_id("macro|teo@macro.com")]),
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated { actor, channel_name: Some(name), .. }]
            if actor == &sender("macro|owner@test.com")
                && name == "Macro Support x owner"
    ));
}

#[tokio::test]
async fn create_channel_event_carries_channel_name() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.create_channel(
        sender("macro|sender@test.com"),
        None,
        crate::domain::models::CreateChannelRequest {
            name: Some("general".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
            auto_join_team: false,
            participants: HashSet::from([macro_id("macro|recipient@test.com")]),
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated { channel_name: Some(name), .. }] if name == "general"
    ));
}

#[tokio::test]
async fn ensure_dms_dispatches_created_channel_once() {
    let channel_id = Uuid::new_v4();
    let joiner = macro_id("macro|joiner@test.com");
    let teammate = macro_id("macro|teammate@test.com");
    let repo = FakeMutationRepo::new(channel_id, joiner.as_ref());
    let events = FakeEvents::default();
    let service = mutation_service(repo, events.clone());

    let summary = service
        .ensure_dms(ensure_dms_for_joining_member(
            joiner.clone(),
            vec![joiner.clone(), teammate.clone()],
        ))
        .await
        .unwrap();

    assert_eq!(
        summary,
        EnsureDmsSummary {
            created: 1,
            existing: 0,
            failed: 0,
        }
    );
    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated {
            channel_id: actual_channel_id,
            actor,
            on_behalf_of: None,
            channel_type: ChannelType::DirectMessage,
            channel_name: None,
            participant_user_ids,
        }] if actual_channel_id == &channel_id
            && actor.as_user() == Some(&joiner)
            && participant_user_ids.contains(&joiner)
            && participant_user_ids.contains(&teammate)
    ));
}

#[tokio::test]
async fn ensure_dms_does_not_dispatch_for_existing_channel() {
    let channel_id = Uuid::new_v4();
    let joiner = macro_id("macro|joiner@test.com");
    let teammate = macro_id("macro|teammate@test.com");
    let mut repo = MockChannelRepo::new();
    repo.expect_maybe_get_dm()
        .once()
        .returning(move |_, _| Box::pin(async move { Ok(Some(channel_id)) }));
    let events = FakeEvents::default();
    let service = ChannelServiceImpl::with_dependencies(repo, events.clone());

    let summary = service
        .ensure_dms(ensure_dms_for_joining_member(joiner, vec![teammate]))
        .await
        .unwrap();

    assert_eq!(
        summary,
        EnsureDmsSummary {
            created: 0,
            existing: 1,
            failed: 0,
        }
    );
    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn get_or_create_dm_rejects_self_pair() {
    let user = macro_id("macro|same@test.com");
    let repo = FakeMutationRepo::new(Uuid::new_v4(), user.as_ref());
    let service = mutation_service(repo, FakeEvents::default());

    let error = service
        .get_or_create_dm(
            Sender::new_from_user(user.clone()),
            GetOrCreateDmRequest { recipient_id: user },
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ChannelMutationErr::BadRequest(message)
            if message == "recipient_id cannot be the same as the user_id"
    ));
}

#[tokio::test]
async fn get_or_create_dm_returns_get_for_existing_pair() {
    let channel_id = Uuid::new_v4();
    let actor = macro_id("macro|actor@test.com");
    let recipient = macro_id("macro|recipient@test.com");
    let mut repo = MockChannelRepo::new();
    repo.expect_maybe_get_dm()
        .once()
        .returning(move |_, _| Box::pin(async move { Ok(Some(channel_id)) }));
    let events = FakeEvents::default();
    let service = ChannelServiceImpl::with_dependencies(repo, events.clone());

    let response = service
        .get_or_create_dm(
            Sender::new_from_user(actor),
            GetOrCreateDmRequest {
                recipient_id: recipient,
            },
        )
        .await
        .unwrap();

    assert_eq!(response.channel_id, channel_id.to_string());
    assert_eq!(response.action, GetOrCreateAction::Get);
    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_private_channel_allows_no_invited_participants() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.create_channel(
        sender("macro|sender@test.com"),
        None,
        crate::domain::models::CreateChannelRequest {
            name: Some("private notes".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
            auto_join_team: false,
            participants: HashSet::new(),
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated { participant_user_ids, .. }]
            if participant_user_ids == &[macro_id("macro|sender@test.com")]
    ));
}

#[tokio::test]
async fn create_auto_join_team_channel_event_includes_current_team_members() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.create_channel(
        sender("macro|sender@test.com"),
        None,
        CreateChannelRequest {
            name: Some("general".to_string()),
            channel_type: ChannelType::Team,
            team_id: Some(Uuid::new_v4()),
            auto_join_team: true,
            participants: HashSet::from([macro_id("macro|sender@test.com")]),
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelCreated { participant_user_ids, .. }]
            if participant_user_ids.len() == 2
                && participant_user_ids.contains(&macro_id("macro|sender@test.com"))
                && participant_user_ids.contains(&macro_id("macro|recipient@test.com"))
    ));
}

#[test]
fn create_channel_request_defaults_auto_join_team_to_false() {
    let request: CreateChannelRequest = serde_json::from_value(serde_json::json!({
        "name": "general",
        "channel_type": "team",
        "team_id": Uuid::new_v4(),
        "participants": []
    }))
    .unwrap();

    assert!(!request.auto_join_team);
}

#[tokio::test]
async fn create_channel_rejects_auto_join_for_non_team_channel() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo, FakeEvents::default());

    let err = svc
        .create_channel(
            sender("macro|sender@test.com"),
            None,
            CreateChannelRequest {
                name: Some("private notes".to_string()),
                channel_type: ChannelType::Private,
                team_id: None,
                auto_join_team: true,
                participants: HashSet::new(),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(err, ChannelMutationErr::BadRequest(_)));
}

#[tokio::test]
async fn auto_join_by_team_id_does_not_touch_channel_recency() {
    let channel_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let user_id = macro_id("macro|member@test.com");
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.auto_join_by_team_id(&team_id, &user_id).await.unwrap();

    assert!(repo.state.lock().unwrap().touched_channel_ids.is_empty());
}

#[tokio::test]
async fn team_membership_operations_delegate_to_repo() {
    let team_id = Uuid::new_v4();
    let channel_ids = vec![Uuid::new_v4(), Uuid::new_v4()];
    let user_id = macro_id("macro|member@test.com");
    let mut repo = MockChannelRepo::new();
    repo.expect_auto_join_by_team_id()
        .withf({
            let user_id = user_id.clone();
            move |actual_team_id, actual_user_id| {
                actual_team_id == &team_id && actual_user_id == &user_id
            }
        })
        .once()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    repo.expect_leave_by_team_id()
        .withf({
            let user_id = user_id.clone();
            move |actual_team_id, actual_user_id| {
                actual_team_id == &team_id && actual_user_id == &user_id
            }
        })
        .once()
        .returning({
            let channel_ids = channel_ids.clone();
            move |_, _| {
                let channel_ids = channel_ids.clone();
                Box::pin(async move { Ok(channel_ids) })
            }
        });
    repo.expect_restore_by_channel_ids()
        .withf({
            let user_id = user_id.clone();
            let channel_ids = channel_ids.clone();
            move |actual_user_id, actual_channel_ids| {
                actual_user_id == &user_id && actual_channel_ids == channel_ids
            }
        })
        .once()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = ChannelServiceImpl::new(repo);

    svc.auto_join_by_team_id(&team_id, &user_id).await.unwrap();
    assert_eq!(
        svc.leave_by_team_id(&team_id, &user_id).await.unwrap(),
        channel_ids
    );
    svc.restore_by_channel_ids(&user_id, &channel_ids)
        .await
        .unwrap();
}

#[tokio::test]
async fn team_membership_operations_delegate_repo_errors() {
    let team_id = Uuid::new_v4();
    let user_id = macro_id("macro|member@test.com");
    let mut repo = MockChannelRepo::new();
    repo.expect_auto_join_by_team_id()
        .once()
        .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("join failed")) }));
    repo.expect_leave_by_team_id()
        .once()
        .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("leave failed")) }));
    repo.expect_restore_by_channel_ids()
        .once()
        .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("restore failed")) }));
    let svc = ChannelServiceImpl::new(repo);

    let join_err = svc
        .auto_join_by_team_id(&team_id, &user_id)
        .await
        .unwrap_err();
    let leave_err = svc.leave_by_team_id(&team_id, &user_id).await.unwrap_err();
    let restore_err = svc
        .restore_by_channel_ids(&user_id, &[Uuid::new_v4()])
        .await
        .unwrap_err();

    assert!(matches!(join_err, ChannelMutationErr::Repo(_)));
    assert!(matches!(leave_err, ChannelMutationErr::Repo(_)));
    assert!(matches!(restore_err, ChannelMutationErr::Repo(_)));
}

#[tokio::test]
async fn patch_channel_dispatches_channel_updated() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: Some("Renamed".to_string()),
            convert_to_team_channel: None,
            auto_join_team: None,
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelUpdated { previous_name: Some(previous), channel_name: Some(new), actor, .. }]
            if previous == "Project" && new == "Renamed" && actor == &macro_id("macro|sender@test.com")
    ));
}

#[tokio::test]
async fn noop_patch_channel_dispatches_nothing() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo.clone(), events.clone());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: None,
        },
    )
    .await
    .unwrap();

    assert!(events.events.lock().unwrap().is_empty());
    let state = repo.state.lock().unwrap();
    assert!(state.channel_patches.is_empty());
    assert!(state.touched_channel_ids.is_empty());
}

#[tokio::test]
async fn patch_channel_conversion_uses_the_users_team() {
    let channel_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().user_team_id = Some(team_id);
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: Some(true),
            auto_join_team: None,
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.user_team_id_lookups, 1);
    assert_eq!(state.channel_patches.len(), 1);
    assert_eq!(state.channel_patches[0].1, Some(team_id));
    assert_eq!(
        state.channel_patches[0].0.convert_to_team_channel,
        Some(true)
    );
}

#[tokio::test]
async fn patch_channel_conversion_names_an_unnamed_private_channel() {
    let channel_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    {
        let mut state = repo.state.lock().unwrap();
        state.channel_name = None;
        state.user_team_id = Some(team_id);
    }
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: Some(true),
            auto_join_team: None,
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.channel_patches.len(), 1);
    assert_eq!(
        state.channel_patches[0].0.channel_name.as_deref(),
        Some("Project")
    );
}

#[tokio::test]
async fn patch_team_channel_conversion_to_private_clears_team_settings() {
    let channel_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    {
        let mut state = repo.state.lock().unwrap();
        state.channel_type = ChannelType::Team;
        state.channel_team_id = Some(team_id);
    }
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: Some(false),
            auto_join_team: Some(true),
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.user_team_id_lookups, 0);
    assert_eq!(state.channel_patches.len(), 1);
    assert_eq!(state.channel_patches[0].1, None);
    assert_eq!(
        state.channel_patches[0].0.convert_to_team_channel,
        Some(false)
    );
    assert_eq!(state.channel_patches[0].0.auto_join_team, Some(false));
}

#[tokio::test]
async fn patch_channel_conversion_requires_the_user_to_have_a_team() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    let err = svc
        .patch_channel(
            sender("macro|sender@test.com"),
            channel_id,
            PatchChannelRequest {
                channel_name: None,
                convert_to_team_channel: Some(true),
                auto_join_team: None,
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(err, ChannelMutationErr::BadRequest(_)));
    let state = repo.state.lock().unwrap();
    assert_eq!(state.user_team_id_lookups, 1);
    assert!(state.channel_patches.is_empty());
}

#[tokio::test]
async fn patch_channel_rejects_enabling_auto_join_on_a_non_team_channel() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    let err = svc
        .patch_channel(
            sender("macro|sender@test.com"),
            channel_id,
            PatchChannelRequest {
                channel_name: None,
                convert_to_team_channel: None,
                auto_join_team: Some(true),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(err, ChannelMutationErr::BadRequest(_)));
    let state = repo.state.lock().unwrap();
    assert_eq!(state.user_team_id_lookups, 0);
    assert!(state.channel_patches.is_empty());
}

#[tokio::test]
async fn patch_team_channel_auto_join_uses_its_existing_team() {
    let channel_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    {
        let mut state = repo.state.lock().unwrap();
        state.channel_type = ChannelType::Team;
        state.channel_team_id = Some(team_id);
    }
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: Some(true),
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.user_team_id_lookups, 0);
    assert_eq!(state.channel_patches.len(), 1);
    assert_eq!(state.channel_patches[0].1, Some(team_id));
    assert_eq!(state.channel_patches[0].0.auto_join_team, Some(true));
}

#[tokio::test]
async fn patch_channel_allows_disabling_auto_join_without_a_team() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo.clone(), FakeEvents::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: Some(false),
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.user_team_id_lookups, 0);
    assert_eq!(state.channel_patches.len(), 1);
    assert_eq!(state.channel_patches[0].1, None);
    assert_eq!(state.channel_patches[0].0.auto_join_team, Some(false));
}

#[tokio::test]
async fn remove_participants_dispatches_participants_removed() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.remove_participants(
        sender("macro|sender@test.com"),
        channel_id,
        RemoveParticipantsRequest {
            participants: vec!["macro|recipient@test.com".to_string()],
        },
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ParticipantsRemoved { actor, removed_user_ids, .. }]
            if actor == &macro_id("macro|sender@test.com")
                && removed_user_ids == &vec![macro_id("macro|recipient@test.com")]
    ));
}

#[tokio::test]
async fn leave_channel_dispatches_participants_removed_for_self() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    // A private channel needs more than 2 participants to allow leaving.
    repo.state
        .lock()
        .unwrap()
        .participants
        .push(ChannelParticipant {
            channel_id,
            user_id: "macro|third@test.com".to_string(),
            role: ParticipantRole::Member,
            joined_at: Utc::now(),
            left_at: None,
        });
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone());

    svc.leave_channel(sender("macro|recipient@test.com"), channel_id)
        .await
        .unwrap();

    let events = events.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ParticipantsRemoved { actor, removed_user_ids, .. }]
            if actor == &macro_id("macro|recipient@test.com")
                && removed_user_ids == &vec![macro_id("macro|recipient@test.com")]
    ));
}

#[tokio::test]
async fn join_channel_touches_channel_when_membership_changes() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo.clone(), events.clone());

    svc.join_channel(sender("macro|new@test.com"), channel_id)
        .await
        .unwrap();

    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
    assert!(matches!(
        events.events.lock().unwrap().as_slice(),
        [ChannelEvent::ParticipantJoined { channel_id: event_channel_id, .. }]
            if event_channel_id == &channel_id
    ));
}

#[tokio::test]
async fn join_channel_propagates_channel_touch_errors() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().fail_channel_touches = true;
    let events = FakeEvents::default();
    let svc = mutation_service(repo.clone(), events.clone());

    let error = svc
        .join_channel(sender("macro|new@test.com"), channel_id)
        .await
        .unwrap_err();

    assert!(matches!(error, ChannelMutationErr::Repo(_)));
    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn private_channel_join_code_is_reused() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo, FakeEvents::default());

    let first = svc.get_channel_join_code(channel_id).await.unwrap();
    let second = svc.get_channel_join_code(channel_id).await.unwrap();

    assert_eq!(first, second);
}

#[tokio::test]
async fn join_code_generation_is_forbidden_for_non_private_channels() {
    for channel_type in [
        ChannelType::Public,
        ChannelType::DirectMessage,
        ChannelType::Team,
    ] {
        let channel_id = Uuid::new_v4();
        let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
        repo.state.lock().unwrap().channel_type = channel_type;
        let svc = mutation_service(repo.clone(), FakeEvents::default());

        let error = svc.get_channel_join_code(channel_id).await.unwrap_err();

        assert!(matches!(error, ChannelMutationErr::Forbidden(_)));
        assert!(repo.state.lock().unwrap().join_code.is_none());
    }
}

#[tokio::test]
async fn unknown_join_code_returns_not_found() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo, FakeEvents::default());

    let error = svc
        .join_channel_by_code(sender("macro|new@test.com"), Uuid::new_v4())
        .await
        .unwrap_err();

    assert!(matches!(error, ChannelMutationErr::NotFound(_)));
}

#[tokio::test]
async fn join_by_code_rejects_non_private_channel() {
    let channel_id = Uuid::new_v4();
    let join_code = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    {
        let mut state = repo.state.lock().unwrap();
        state.join_code = Some(join_code);
        state.channel_type = ChannelType::Public;
    }
    let svc = mutation_service(repo, FakeEvents::default());

    let error = svc
        .join_channel_by_code(sender("macro|new@test.com"), join_code)
        .await
        .unwrap_err();

    assert!(matches!(error, ChannelMutationErr::Forbidden(_)));
}

#[tokio::test]
async fn join_by_code_adds_participant_and_dispatches_event() {
    let channel_id = Uuid::new_v4();
    let join_code = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().join_code = Some(join_code);
    let events = FakeEvents::default();
    let svc = mutation_service(repo.clone(), events.clone());

    svc.join_channel_by_code(sender("macro|new@test.com"), join_code)
        .await
        .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.participant_additions, 1);
    assert_eq!(state.touched_channel_ids, vec![channel_id]);
    assert!(
        state
            .participants
            .iter()
            .any(|participant| participant.user_id == "macro|new@test.com")
    );
    drop(state);
    assert!(matches!(
        events.events.lock().unwrap().as_slice(),
        [ChannelEvent::ParticipantJoined { channel_id: event_channel_id, .. }]
            if event_channel_id == &channel_id
    ));
}

#[tokio::test]
async fn join_by_code_is_idempotent_for_active_participant() {
    let channel_id = Uuid::new_v4();
    let join_code = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().join_code = Some(join_code);
    let events = FakeEvents::default();
    let svc = mutation_service(repo.clone(), events.clone());

    svc.join_channel_by_code(sender("macro|sender@test.com"), join_code)
        .await
        .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.participant_additions, 0);
    assert!(state.touched_channel_ids.is_empty());
    assert!(events.events.lock().unwrap().is_empty());
}
