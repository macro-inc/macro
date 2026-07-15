use super::*;
use crate::domain::{
    events::ChannelEvent,
    models::{
        Activity, ActivityType, BotId, BotSenderProfile, ChannelAttachment, ChannelAttachmentType,
        ChannelContextMessage, ChannelInfo, ChannelMessageFilters, ChannelMetadata,
        ChannelParticipant, ChannelType, CountedReaction, CreateEntityMentionOptions,
        DeleteMessageQuery, EntityMention, MessageAttachment, MessagePageDirection,
        MutatedAttachment, MutatedMessage, NewChannelAttachment, ParticipantRole,
        PatchChannelRequest, PatchMessageRequest, PostMessageRequest, PostReactionRequest,
        ReactionAction, ReferencedShareItem, ReferencedShareItemType, ResolvedChannelMessage,
        Sender, SimpleMention, ThreadData, ThreadReplyRow, TopLevelMessageRow,
    },
    ports::{
        ChannelEventDispatcher, ChannelMentionExtractor, ChannelReferenceSharePermissions,
        ChannelRepo, MockChannelRepo, TopLevelMessagesQueryResult,
    },
};
use channel_sender::ChannelSender;
use chrono::Utc;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

fn make_row(id: Uuid, minutes_ago: i64) -> TopLevelMessageRow {
    let now = Utc::now();
    TopLevelMessageRow {
        id,
        channel_id: Uuid::nil(),
        sender_id: "user_1".into(),
        triggered_by: None,
        content: format!("msg {minutes_ago}"),
        created_at: now - chrono::Duration::minutes(minutes_ago),
        updated_at: now - chrono::Duration::minutes(minutes_ago),
        edited_at: None,
        deleted_at: None,
    }
}

fn empty_repo() -> MockChannelRepo {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_top_level_messages()
        .returning(|_, _, _, _, _, _| {
            Box::pin(async {
                Ok(TopLevelMessagesQueryResult {
                    rows: vec![],
                    has_more_newer: false,
                })
            })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_channel_attachments()
        .returning(|_, _, _, _| Box::pin(async { Ok(vec![]) }));
    repo.expect_get_channel_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo.expect_resolve_top_level_parent()
        .returning(|_, _| Box::pin(async { Ok(None) }));
    repo.expect_get_top_level_messages_around()
        .returning(|_, _, _, _| Box::pin(async { Ok((vec![], vec![])) }));
    repo.expect_get_thread_replies()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo
}

#[tokio::test]
async fn returns_empty_page_for_no_messages() {
    let svc = ChannelServiceImpl::new(empty_repo());
    let result = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &ChannelMessageFilters::default(),
            None,
        )
        .await
        .unwrap();
    let page = result.page;

    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn returns_messages_with_thread_info() {
    let parent_id = Uuid::new_v4();
    let reply_id = Uuid::new_v4();
    let row = make_row(parent_id, 10);
    let latest_reply = Utc::now();

    let reply_row = ThreadReplyRow {
        id: reply_id,
        thread_id: parent_id,
        sender_id: "user_2".into(),
        triggered_by: None,
        content: "reply".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };

    let mut repo = MockChannelRepo::new();

    let row_clone = row.clone();
    repo.expect_get_top_level_messages()
        .returning(move |_, _, _, _, _, _| {
            let r = row_clone.clone();
            Box::pin(async move {
                Ok(TopLevelMessagesQueryResult {
                    rows: vec![r],
                    has_more_newer: false,
                })
            })
        });

    let reply_clone = reply_row.clone();
    repo.expect_get_thread_data().returning(move |_, _| {
        let mut map = HashMap::new();
        map.insert(
            parent_id,
            ThreadData {
                reply_count: 5,
                latest_reply_at: Some(latest_reply),
                preview_replies: vec![reply_clone.clone()],
            },
        );
        Box::pin(async move { Ok(map) })
    });

    let reaction = CountedReaction {
        emoji: "👍".into(),
        users: vec!["user_3".into()],
    };
    let reaction_clone = reaction.clone();
    repo.expect_get_reactions_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<CountedReaction>> = HashMap::new();
        map.insert(parent_id, vec![reaction_clone.clone()]);
        Box::pin(async move { Ok(map) })
    });

    let attachment = MessageAttachment {
        id: Uuid::new_v4(),
        entity_type: "document".into(),
        entity_id: "doc_1".into(),
        width: None,
        height: None,
        created_at: Utc::now(),
    };
    let attachment_clone = attachment.clone();
    repo.expect_get_attachments_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        map.insert(parent_id, vec![attachment_clone.clone()]);
        Box::pin(async move { Ok(map) })
    });

    let svc = ChannelServiceImpl::new(repo);
    let result = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &ChannelMessageFilters::default(),
            None,
        )
        .await
        .unwrap();
    let page = result.page;

    assert_eq!(page.items.len(), 1);
    let msg = &page.items[0];
    assert_eq!(msg.thread.reply_count, 5);
    assert_eq!(msg.thread.preview.len(), 1);
    assert_eq!(msg.reactions.len(), 1);
    assert_eq!(msg.attachments.len(), 1);
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn attaches_bot_profiles_to_bot_authored_messages() {
    let seeded_bot = BotId::new_from_uuid(Uuid::new_v4());
    let unseeded_bot = bot_id::MACRO_AI_BOT_ID;
    let parent_id = Uuid::new_v4();
    let macro_ai_msg_id = Uuid::new_v4();

    let mut bot_row = make_row(parent_id, 10);
    bot_row.sender_id = seeded_bot.into_storage_id().to_string();
    let mut macro_ai_row = make_row(macro_ai_msg_id, 5);
    macro_ai_row.sender_id = unseeded_bot.into_storage_id().to_string();

    let reply_row = ThreadReplyRow {
        id: Uuid::new_v4(),
        thread_id: parent_id,
        sender_id: seeded_bot.into_storage_id().to_string(),
        triggered_by: None,
        content: "reply".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };

    let profile = BotSenderProfile {
        name: "Deploy Bot".to_string(),
        avatar_url: Some("https://example.com/bot.png".to_string()),
    };

    let mut repo = MockChannelRepo::new();
    let rows = vec![bot_row, macro_ai_row];
    repo.expect_get_top_level_messages()
        .returning(move |_, _, _, _, _, _| {
            let rows = rows.clone();
            Box::pin(async move {
                Ok(TopLevelMessagesQueryResult {
                    rows,
                    has_more_newer: false,
                })
            })
        });
    let reply_clone = reply_row.clone();
    repo.expect_get_thread_data().returning(move |_, _| {
        let mut map = HashMap::new();
        map.insert(
            parent_id,
            ThreadData {
                reply_count: 1,
                latest_reply_at: None,
                preview_replies: vec![reply_clone.clone()],
            },
        );
        Box::pin(async move { Ok(map) })
    });
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    let profile_clone = profile.clone();
    repo.expect_get_bot_profiles().returning(move |bot_ids| {
        assert_eq!(bot_ids.len(), 2, "bot senders should be deduplicated");
        assert!(bot_ids.contains(&seeded_bot));
        assert!(bot_ids.contains(&unseeded_bot));
        let mut map = HashMap::new();
        map.insert(seeded_bot, profile_clone.clone());
        Box::pin(async move { Ok(map) })
    });

    let svc = ChannelServiceImpl::new(repo);
    let page = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &ChannelMessageFilters::default(),
            None,
        )
        .await
        .unwrap()
        .page;

    assert_eq!(page.items.len(), 2);
    let bot_msg = page.items.iter().find(|m| m.id == parent_id).unwrap();
    assert_eq!(bot_msg.bot_profile, Some(profile.clone()));
    assert_eq!(bot_msg.thread.preview[0].bot_profile, Some(profile));

    // The Macro AI system bot has no `bots` row, so it stays unenriched and the
    // frontend falls back to its built-in special case.
    let macro_ai_msg = page.items.iter().find(|m| m.id == macro_ai_msg_id).unwrap();
    assert!(macro_ai_msg.bot_profile.is_none());
}

#[derive(Clone)]
struct FakeMutationRepo {
    state: Arc<Mutex<FakeMutationRepoState>>,
}

struct FakeMutationRepoState {
    channel_id: Uuid,
    channel_type: ChannelType,
    join_code: Option<Uuid>,
    message: MutatedMessage,
    owner: String,
    participants: Vec<ChannelParticipant>,
    participant_additions: usize,
    thread_participants: Vec<MacroUserIdStr<'static>>,
    attachments: Vec<MutatedAttachment>,
    patched_content: Option<String>,
    activity_upserts: usize,
    removed_participants: Vec<String>,
    created_mentions: Vec<SimpleMention>,
    synced_mentions: Vec<SimpleMention>,
}

impl FakeMutationRepo {
    fn new(channel_id: Uuid, sender: &str) -> Self {
        let now = Utc::now();
        let message = MutatedMessage {
            id: Uuid::new_v4(),
            channel_id,
            thread_id: None,
            sender_id: ChannelSender::parse_from_str(sender).unwrap().into_owned(),
            triggered_by: None,
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        };
        Self {
            state: Arc::new(Mutex::new(FakeMutationRepoState {
                channel_id,
                channel_type: ChannelType::Private,
                join_code: None,
                owner: sender.to_string(),
                message,
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
                thread_participants: vec![
                    MacroUserIdStr::try_from("macro|thread@test.com".to_string()).unwrap(),
                ],
                attachments: vec![],
                patched_content: None,
                activity_upserts: 0,
                removed_participants: vec![],
                created_mentions: vec![],
                synced_mentions: vec![],
            })),
        }
    }
}

impl ChannelRepo for FakeMutationRepo {
    type Err = anyhow::Error;

    async fn get_top_level_messages(
        &self,
        _channel_id: Uuid,
        _query: &Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
        _notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> Result<TopLevelMessagesQueryResult, Self::Err> {
        Ok(TopLevelMessagesQueryResult {
            rows: vec![],
            has_more_newer: false,
        })
    }

    async fn get_thread_data(
        &self,
        _parent_ids: &[Uuid],
        _preview_count: u16,
    ) -> Result<HashMap<Uuid, ThreadData>, Self::Err> {
        Ok(HashMap::new())
    }

    async fn get_thread_replies(&self, _parent_id: Uuid) -> Result<Vec<ThreadReplyRow>, Self::Err> {
        Ok(vec![])
    }

    async fn get_reactions_batch(
        &self,
        _message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<CountedReaction>>, Self::Err> {
        Ok(HashMap::new())
    }

    async fn get_attachments_batch(
        &self,
        _message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<MessageAttachment>>, Self::Err> {
        Ok(HashMap::new())
    }

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

    async fn get_messages_with_context(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _before: i64,
        _after: i64,
    ) -> Result<Vec<ChannelContextMessage>, Self::Err> {
        Ok(vec![])
    }

    async fn get_attachment_references(
        &self,
        _entity_type: &str,
        _entity_id: &str,
        _user_id: &str,
    ) -> Result<Vec<crate::domain::models::AttachmentEntityReference>, Self::Err> {
        Ok(vec![])
    }

    async fn resolve_top_level_parent(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Option<TopLevelMessageRow>, Self::Err> {
        Ok(None)
    }

    async fn resolve_message(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Option<ResolvedChannelMessage>, Self::Err> {
        Ok(None)
    }

    async fn get_top_level_messages_around(
        &self,
        _channel_id: Uuid,
        _anchor_created_at: chrono::DateTime<chrono::Utc>,
        _anchor_id: Uuid,
        _limit: u16,
    ) -> Result<(Vec<TopLevelMessageRow>, Vec<TopLevelMessageRow>), Self::Err> {
        Ok((vec![], vec![]))
    }

    async fn get_channel_info(&self, channel_id: Uuid) -> Result<ChannelInfo, Self::Err> {
        let state = self.state.lock().unwrap();
        Ok(ChannelInfo {
            id: channel_id,
            name: Some("Project".to_string()),
            channel_type: state.channel_type,
            org_id: None,
            team_id: None,
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
            name: Some("Project".to_string()),
            channel_type: state.channel_type,
            org_id: None,
            team_id: None,
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

    async fn create_channel(
        &self,
        _owner_id: MacroUserIdStr<'_>,
        _org_id: Option<i64>,
        _req: crate::domain::models::CreateChannelRequest,
    ) -> Result<Uuid, Self::Err> {
        Ok(self.state.lock().unwrap().channel_id)
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
        _req: PatchChannelRequest,
    ) -> Result<(), Self::Err> {
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

    async fn create_message(
        &self,
        channel_id: Uuid,
        sender_id: ChannelSender<'_>,
        triggered_by_user_id: Option<String>,
        content: String,
        thread_id: Option<Uuid>,
    ) -> Result<MutatedMessage, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.message.channel_id = channel_id;
        state.message.sender_id = sender_id.into_owned();
        state.message.triggered_by = triggered_by_user_id;
        state.message.content = content;
        state.message.thread_id = thread_id;
        Ok(state.message.clone())
    }

    async fn touch_channel_updated_at(&self, _channel_id: Uuid) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn create_message_mentions(
        &self,
        _message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> Result<(), Self::Err> {
        self.state.lock().unwrap().created_mentions.extend(mentions);
        Ok(())
    }

    async fn sync_message_mentions(
        &self,
        _message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> Result<(), Self::Err> {
        self.state.lock().unwrap().synced_mentions.extend(mentions);
        Ok(())
    }

    async fn add_attachments(
        &self,
        message_id: Uuid,
        channel_id: Uuid,
        attachments: Vec<NewChannelAttachment>,
    ) -> Result<Vec<MutatedAttachment>, Self::Err> {
        let now = Utc::now();
        let created = attachments
            .into_iter()
            .map(|a| MutatedAttachment {
                id: Uuid::new_v4(),
                channel_id,
                message_id,
                entity_type: a.entity_type,
                entity_id: a.entity_id,
                width: a.width,
                height: a.height,
                created_at: now,
            })
            .collect::<Vec<_>>();
        self.state.lock().unwrap().attachments = created.clone();
        Ok(created)
    }

    async fn get_message_attachments(
        &self,
        _message_id: Uuid,
    ) -> Result<Vec<MutatedAttachment>, Self::Err> {
        Ok(self.state.lock().unwrap().attachments.clone())
    }

    async fn delete_attachments(&self, _attachment_ids: Vec<Uuid>) -> Result<(), Self::Err> {
        self.state.lock().unwrap().attachments.clear();
        Ok(())
    }

    async fn delete_entity_mentions_for_entities(
        &self,
        _entity_ids: Vec<String>,
        _source_entity_id: String,
    ) -> Result<(), Self::Err> {
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

    async fn delete_entity_mention_by_id(&self, _id: Uuid) -> Result<bool, Self::Err> {
        Ok(false)
    }

    async fn patch_message_attachments(
        &self,
        _message_id: Uuid,
        _attachments: Vec<MutatedAttachment>,
    ) -> Result<MutatedMessage, Self::Err> {
        Ok(self.state.lock().unwrap().message.clone())
    }

    async fn patch_message(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        content: String,
    ) -> Result<MutatedMessage, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.patched_content = Some(content.clone());
        state.message.content = content;
        state.message.edited_at = Some(Utc::now());
        Ok(state.message.clone())
    }

    async fn delete_message(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<MutatedMessage, Self::Err> {
        Ok(self.state.lock().unwrap().message.clone())
    }

    async fn get_message_owner(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Option<ChannelSender<'static>>, Self::Err> {
        let state = self.state.lock().unwrap();
        if state.message.deleted_at.is_some() {
            return Ok(None);
        }
        ChannelSender::parse_from_str(&state.owner)
            .map(CowLike::into_owned)
            .map(Some)
            .map_err(Into::into)
    }

    async fn get_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, Self::Err> {
        Ok(self.state.lock().unwrap().participants.clone())
    }

    async fn get_thread_participants(
        &self,
        _thread_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        Ok(self.state.lock().unwrap().thread_participants.clone())
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

    async fn add_reaction(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _emoji: String,
        _user_id: ChannelSender<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn remove_reaction(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _emoji: String,
        _user_id: ChannelSender<'_>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn get_message_reactions(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<CountedReaction>, Self::Err> {
        Ok(vec![CountedReaction {
            emoji: "👍".to_string(),
            users: vec!["macro|sender@test.com".to_string()],
        }])
    }

    async fn get_bot_profiles(
        &self,
        _bot_ids: &[BotId],
    ) -> Result<HashMap<BotId, BotSenderProfile>, Self::Err> {
        Ok(HashMap::new())
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

#[derive(Clone, Default)]
struct FakeReferenceSharing {
    items: Arc<Mutex<Vec<ReferencedShareItem>>>,
}

impl ChannelReferenceSharePermissions for FakeReferenceSharing {
    type Err = anyhow::Error;

    async fn update_channel_share_permissions_for_referenced_items(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        items: Vec<ReferencedShareItem>,
    ) -> Result<(), Self::Err> {
        self.items.lock().unwrap().extend(items);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeMentionExtractor {
    mentions: Vec<SimpleMention>,
    calls: Arc<Mutex<Vec<String>>>,
}

impl FakeMentionExtractor {
    fn new(mentions: Vec<SimpleMention>) -> Self {
        Self {
            mentions,
            calls: Arc::default(),
        }
    }
}

impl ChannelMentionExtractor for FakeMentionExtractor {
    type Err = anyhow::Error;

    async fn extract_mentions(&self, content: &str) -> Result<Vec<SimpleMention>, Self::Err> {
        self.calls.lock().unwrap().push(content.to_string());
        Ok(self.mentions.clone())
    }
}

fn mutation_service(
    repo: FakeMutationRepo,
    events: FakeEvents,
    share: FakeReferenceSharing,
) -> ChannelServiceImpl<FakeMutationRepo, FakeEvents, FakeReferenceSharing> {
    ChannelServiceImpl::with_dependencies(repo, events, share)
}

fn macro_id(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(user_id.to_string()).unwrap()
}

fn sender(user_id: &str) -> Sender {
    Sender::new_from_user(macro_id(user_id))
}

#[tokio::test]
async fn post_message_emits_message_posted_event_and_updates_share_permissions() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let share = FakeReferenceSharing::default();
    let svc = mutation_service(repo.clone(), events.clone(), share.clone());

    let res = svc
        .post_message(
            sender("macro|sender@test.com"),
            channel_id,
            PostMessageRequest {
                content: "hello world".to_string(),
                mentions: vec![SimpleMention {
                    entity_type: "document".to_string(),
                    entity_id: "doc-1".to_string(),
                }],
                thread_id: None,
                attachments: vec![NewChannelAttachment {
                    entity_type: "chat".to_string(),
                    entity_id: "chat-1".to_string(),
                    width: None,
                    height: None,
                }],
                nonce: Some("nonce-1".to_string()),
                notification_policy: Default::default(),
                triggered_by: None,
            },
        )
        .await
        .unwrap();

    let emitted = events.events.lock().unwrap();
    assert_eq!(emitted.len(), 1);
    let ChannelEvent::MessagePosted {
        metadata,
        participants,
        message,
        has_attachments,
        attachments,
        nonce,
        ..
    } = &emitted[0]
    else {
        panic!("expected MessagePosted event, got {:?}", emitted[0]);
    };
    assert_eq!(metadata.channel_name, "Project");
    assert_eq!(message.id.to_string(), res.id);
    assert_eq!(nonce.as_deref(), Some("nonce-1"));
    assert!(*has_attachments);
    assert_eq!(attachments.len(), 1);
    assert!(
        participants
            .iter()
            .any(|participant| participant.user_id == "macro|recipient@test.com")
    );
    drop(emitted);

    let shared = share.items.lock().unwrap();
    assert!(shared.contains(&ReferencedShareItem::new(
        "chat-1",
        ReferencedShareItemType::Chat
    )));
    assert!(shared.contains(&ReferencedShareItem::new(
        "doc-1",
        ReferencedShareItemType::Document
    )));
}

#[tokio::test]
async fn bot_post_message_persists_bot_sender_and_skips_user_only_effects() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let actor = Sender::new_from_bot(bot_id);
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let share = FakeReferenceSharing::default();
    let svc = mutation_service(repo.clone(), events.clone(), share.clone());

    svc.post_message(
        actor.clone(),
        channel_id,
        PostMessageRequest {
            content: "bot update".to_string(),
            mentions: vec![SimpleMention {
                entity_type: "document".to_string(),
                entity_id: "doc-1".to_string(),
            }],
            thread_id: None,
            attachments: vec![NewChannelAttachment {
                entity_type: "chat".to_string(),
                entity_id: "chat-1".to_string(),
                width: None,
                height: None,
            }],
            nonce: None,
            notification_policy: Default::default(),
            triggered_by: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(repo.state.lock().unwrap().message.sender_id.clone(), actor);
    assert_eq!(repo.state.lock().unwrap().activity_upserts, 0);
    assert!(share.items.lock().unwrap().is_empty());

    let emitted = events.events.lock().unwrap();
    let ChannelEvent::MessagePosted { message, .. } = &emitted[0] else {
        panic!("expected MessagePosted event, got {:?}", emitted[0]);
    };
    assert_eq!(
        message.sender_id.as_ref(),
        bot_id.into_storage_id().as_ref()
    );
}

#[tokio::test]
async fn bot_post_message_derives_mentions_from_content() {
    let channel_id = Uuid::new_v4();
    let actor = Sender::new_from_bot(BotId::new_from_uuid(Uuid::new_v4()));
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let expected = vec![SimpleMention {
        entity_type: "document".to_string(),
        entity_id: "doc-1".to_string(),
    }];
    let extractor = FakeMentionExtractor::new(expected.clone());
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    )
    .with_mention_extractor(extractor.clone());

    svc.post_message(
        actor,
        channel_id,
        PostMessageRequest {
            content: "see the doc".to_string(),
            mentions: vec![],
            thread_id: None,
            attachments: vec![],
            nonce: None,
            notification_policy: Default::default(),
            triggered_by: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        extractor.calls.lock().unwrap().clone(),
        vec!["see the doc".to_string()]
    );
    assert_eq!(repo.state.lock().unwrap().created_mentions, expected);

    let emitted = events.events.lock().unwrap();
    let ChannelEvent::MessagePosted { mentions, .. } = &emitted[0] else {
        panic!("expected MessagePosted event, got {:?}", emitted[0]);
    };
    assert_eq!(*mentions, expected);
}

#[tokio::test]
async fn bot_post_message_with_explicit_mentions_skips_extraction() {
    let channel_id = Uuid::new_v4();
    let actor = Sender::new_from_bot(BotId::new_from_uuid(Uuid::new_v4()));
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let extractor = FakeMentionExtractor::new(vec![SimpleMention {
        entity_type: "document".to_string(),
        entity_id: "derived".to_string(),
    }]);
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    )
    .with_mention_extractor(extractor.clone());

    let explicit = vec![SimpleMention {
        entity_type: "document".to_string(),
        entity_id: "explicit".to_string(),
    }];
    svc.post_message(
        actor,
        channel_id,
        PostMessageRequest {
            content: "bot update".to_string(),
            mentions: explicit.clone(),
            thread_id: None,
            attachments: vec![],
            nonce: None,
            notification_policy: Default::default(),
            triggered_by: None,
        },
    )
    .await
    .unwrap();

    assert!(extractor.calls.lock().unwrap().is_empty());
    assert_eq!(repo.state.lock().unwrap().created_mentions, explicit);
}

#[tokio::test]
async fn user_post_message_does_not_derive_mentions_from_content() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let extractor = FakeMentionExtractor::new(vec![SimpleMention {
        entity_type: "document".to_string(),
        entity_id: "doc-1".to_string(),
    }]);
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    )
    .with_mention_extractor(extractor.clone());

    svc.post_message(
        sender("macro|sender@test.com"),
        channel_id,
        PostMessageRequest {
            content: "see the doc".to_string(),
            mentions: vec![],
            thread_id: None,
            attachments: vec![],
            nonce: None,
            notification_policy: Default::default(),
            triggered_by: None,
        },
    )
    .await
    .unwrap();

    assert!(extractor.calls.lock().unwrap().is_empty());
    assert!(repo.state.lock().unwrap().created_mentions.is_empty());
}

#[tokio::test]
async fn bot_patch_message_derives_replacement_mentions_from_content() {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_sender = bot_id.into_storage_id().to_string();
    let repo = FakeMutationRepo::new(channel_id, &bot_sender);
    repo.state.lock().unwrap().message.sender_id = Sender::new_from_bot(bot_id);
    let message_id = repo.state.lock().unwrap().message.id;
    let events = FakeEvents::default();
    let expected = vec![SimpleMention {
        entity_type: "chat".to_string(),
        entity_id: "doc-2".to_string(),
    }];
    let extractor = FakeMentionExtractor::new(expected.clone());
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    )
    .with_mention_extractor(extractor.clone());

    svc.patch_message(
        Sender::new_from_bot(bot_id),
        ParticipantRole::Member,
        channel_id,
        message_id,
        PatchMessageRequest {
            content: Some("final answer".to_string()),
            mentions: None,
            attachment_ids_to_delete: None,
            attachments_to_add: None,
            nonce: None,
            notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        extractor.calls.lock().unwrap().clone(),
        vec!["final answer".to_string()]
    );
    assert_eq!(repo.state.lock().unwrap().synced_mentions, expected);
}

#[tokio::test]
async fn patch_message_content_emits_message_changed_event_to_thread_participants() {
    let channel_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().message.thread_id = Some(thread_id);
    let message_id = repo.state.lock().unwrap().message.id;
    let events = FakeEvents::default();
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    svc.patch_message(
        sender("macro|sender@test.com"),
        ParticipantRole::Member,
        channel_id,
        message_id,
        PatchMessageRequest {
            content: Some("edited".to_string()),
            mentions: None,
            attachment_ids_to_delete: None,
            attachments_to_add: None,
            nonce: Some("edit-nonce".to_string()),
            notification_policy: Default::default(),
        },
    )
    .await
    .unwrap();

    let emitted = events.events.lock().unwrap();
    assert_eq!(emitted.len(), 1);
    let ChannelEvent::MessageChanged {
        channel_id: emitted_channel_id,
        message,
        recipients,
        nonce,
        ..
    } = &emitted[0]
    else {
        panic!("expected MessageChanged event, got {:?}", emitted[0]);
    };
    assert_eq!(*emitted_channel_id, channel_id);
    assert_eq!(message.id, message_id);
    assert_eq!(message.content, "edited");
    assert_eq!(nonce.as_deref(), Some("edit-nonce"));
    assert_eq!(recipients.len(), 1);
    assert_eq!(recipients[0].as_ref(), "macro|thread@test.com");
}

#[tokio::test]
async fn patch_message_notify_as_posted_adds_notification_context() {
    let channel_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_sender = bot_id.into_storage_id().to_string();
    let repo = FakeMutationRepo::new(channel_id, &bot_sender);
    repo.state.lock().unwrap().message.thread_id = Some(thread_id);
    repo.state.lock().unwrap().message.sender_id = Sender::new_from_bot(bot_id);
    let message_id = repo.state.lock().unwrap().message.id;
    let events = FakeEvents::default();
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    svc.patch_message(
        Sender::new_from_bot(bot_id),
        ParticipantRole::Member,
        channel_id,
        message_id,
        PatchMessageRequest {
            content: Some("final answer".to_string()),
            mentions: None,
            attachment_ids_to_delete: None,
            attachments_to_add: None,
            nonce: None,
            notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
        },
    )
    .await
    .unwrap();

    let emitted = events.events.lock().unwrap();
    assert_eq!(emitted.len(), 1);
    let ChannelEvent::MessageChanged {
        message,
        posted_notification,
        ..
    } = &emitted[0]
    else {
        panic!("expected MessageChanged event, got {:?}", emitted[0]);
    };
    assert_eq!(message.content, "final answer");
    let posted_notification = posted_notification
        .as_ref()
        .expect("expected posted notification context");
    assert_eq!(posted_notification.metadata.channel_name, "Project");
    assert_eq!(posted_notification.participants.len(), 2);
    assert!(posted_notification.mentions.is_empty());
    assert!(!posted_notification.has_attachments);
}

#[tokio::test]
async fn patch_of_deleted_message_is_not_found() {
    let channel_id = Uuid::new_v4();
    let bot_sender = BotId::new_from_uuid(Uuid::new_v4())
        .into_storage_id()
        .to_string();
    let repo = FakeMutationRepo::new(channel_id, &bot_sender);
    let message_id = repo.state.lock().unwrap().message.id;
    repo.state.lock().unwrap().message.deleted_at = Some(Utc::now());
    let events = FakeEvents::default();
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    let err = svc
        .patch_message(
            ChannelSender::parse_from_str(&bot_sender)
                .unwrap()
                .into_owned(),
            ParticipantRole::Member,
            channel_id,
            message_id,
            PatchMessageRequest {
                content: Some("late reply".to_string()),
                mentions: None,
                attachment_ids_to_delete: None,
                attachments_to_add: None,
                nonce: None,
                notification_policy: Default::default(),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(err, ChannelMutationErr::NotFound(_)));
    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn member_can_delete_bot_authored_message() {
    let channel_id = Uuid::new_v4();
    let bot_sender = BotId::new_from_uuid(Uuid::new_v4())
        .into_storage_id()
        .to_string();
    let repo = FakeMutationRepo::new(channel_id, &bot_sender);
    let message_id = repo.state.lock().unwrap().message.id;
    let events = FakeEvents::default();
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    svc.delete_message(
        sender("macro|member@test.com"),
        ParticipantRole::Member,
        channel_id,
        message_id,
        DeleteMessageQuery { nonce: None },
    )
    .await
    .unwrap();

    let emitted = events.events.lock().unwrap();
    assert_eq!(emitted.len(), 1);
    assert!(matches!(&emitted[0], ChannelEvent::MessageDeleted { .. }));
}

#[tokio::test]
async fn member_cannot_delete_other_users_message() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    let events = FakeEvents::default();
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    let err = svc
        .delete_message(
            sender("macro|member@test.com"),
            ParticipantRole::Member,
            channel_id,
            message_id,
            DeleteMessageQuery { nonce: None },
        )
        .await
        .unwrap_err();

    assert!(matches!(err, ChannelMutationErr::Unauthorized(_)));
    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reaction_mutation_emits_grouped_reaction_event() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.post_reaction(
        sender("macro|sender@test.com"),
        channel_id,
        PostReactionRequest {
            emoji: "👍".to_string(),
            message_id: message_id.to_string(),
            action: ReactionAction::Add,
            nonce: None,
        },
    )
    .await
    .unwrap();

    let emitted = events.events.lock().unwrap();
    assert_eq!(emitted.len(), 1);
    let ChannelEvent::ReactionChanged {
        channel_id: emitted_channel_id,
        message_id: emitted_message_id,
        reactions,
        ..
    } = &emitted[0]
    else {
        panic!("expected ReactionChanged event, got {:?}", emitted[0]);
    };
    assert_eq!(*emitted_channel_id, channel_id);
    assert_eq!(*emitted_message_id, message_id);
    assert_eq!(reactions[0].emoji, "👍");
}

#[tokio::test]
async fn clamps_limit() {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_top_level_messages()
        .withf(|_, _, _, limit, _, _| *limit == 100)
        .returning(|_, _, _, _, _, _| {
            Box::pin(async {
                Ok(TopLevelMessagesQueryResult {
                    rows: vec![],
                    has_more_newer: false,
                })
            })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelServiceImpl::new(repo);
    let result = svc
        .get_channel_messages(
            Uuid::nil(),
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            200,
            &ChannelMessageFilters::default(),
            None,
        )
        .await
        .unwrap();
    let page = result.page;

    assert!(page.items.is_empty());
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

#[test]
fn center_window_balanced() {
    // 5 before, anchor, 5 after, limit=7 → half=3 before, 3 after
    let before: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), -i)).collect();

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 7);
    assert_eq!(result.len(), 7);
    assert!(result.has_more_newer);
    // First 3 are from after (reversed = newest-first), then anchor, then 3 from before
    assert_eq!(result[0].id, after[2].id);
    assert_eq!(result[1].id, after[1].id);
    assert_eq!(result[2].id, after[0].id);
    assert_eq!(result[3].id, anchor.id);
    assert_eq!(result[4].id, before[0].id);
    assert_eq!(result[5].id, before[1].id);
    assert_eq!(result[6].id, before[2].id);
}

#[test]
fn center_window_near_oldest_edge() {
    // Only 1 before, anchor, 10 after, limit=7 → 1 before, 5 after
    let before = vec![make_row(Uuid::new_v4(), 1)];
    let anchor = make_row(Uuid::new_v4(), 0);
    let after: Vec<_> = (1..=10).map(|i| make_row(Uuid::new_v4(), -i)).collect();

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 7);
    assert_eq!(result.len(), 7);
    assert!(result.has_more_newer);
    assert_eq!(result[5].id, anchor.id);
    assert_eq!(result[6].id, before[0].id);
    // First 5 are after (reversed)
    for i in 0..5 {
        assert_eq!(result[i].id, after[4 - i].id);
    }
}

#[test]
fn center_window_near_newest_edge() {
    // 10 before, anchor, only 1 after, limit=7 → 5 before, 1 after
    let before: Vec<_> = (1..=10).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after = vec![make_row(Uuid::new_v4(), -1)];

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 7);
    assert_eq!(result.len(), 7);
    assert!(!result.has_more_newer);
    assert_eq!(result[0].id, after[0].id);
    assert_eq!(result[1].id, anchor.id);
    for i in 0..5 {
        assert_eq!(result[2 + i].id, before[i].id);
    }
}

#[test]
fn center_window_small_channel() {
    // 2 before, anchor, 1 after, limit=10 → returns all 4
    let before: Vec<_> = (1..=2).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after = vec![make_row(Uuid::new_v4(), -1)];

    let result = center_window(before.clone(), anchor.clone(), after.clone(), 10);
    assert_eq!(result.len(), 4);
    assert!(!result.has_more_newer);
    assert_eq!(result[0].id, after[0].id);
    assert_eq!(result[1].id, anchor.id);
    assert_eq!(result[2].id, before[0].id);
    assert_eq!(result[3].id, before[1].id);
}

#[test]
fn center_window_limit_one() {
    let before: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), i)).collect();
    let anchor = make_row(Uuid::new_v4(), 0);
    let after: Vec<_> = (1..=5).map(|i| make_row(Uuid::new_v4(), -i)).collect();

    let result = center_window(before, anchor.clone(), after, 1);
    assert_eq!(result.len(), 1);
    assert!(result.has_more_newer);
    assert_eq!(result[0].id, anchor.id);
}

// --- get_channel_messages_around tests ---

#[tokio::test]
async fn around_message_not_found() {
    let svc = ChannelServiceImpl::new(empty_repo());
    let message_id = Uuid::new_v4();

    let err = svc
        .get_channel_messages_around(Uuid::nil(), message_id, 50)
        .await
        .unwrap_err();

    assert!(
        matches!(err, ChannelMessagesErr::MessageNotFound(id) if id == message_id),
        "expected MessageNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn around_deleted_top_level_without_active_replies_is_not_found() {
    let message_id = Uuid::new_v4();
    let mut anchor = make_row(message_id, 0);
    anchor.deleted_at = Some(Utc::now());

    let mut repo = MockChannelRepo::new();
    repo.expect_resolve_top_level_parent()
        .returning(move |_, _| {
            let anchor = anchor.clone();
            Box::pin(async move { Ok(Some(anchor)) })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelServiceImpl::new(repo);
    let err = svc
        .get_channel_messages_around(Uuid::nil(), message_id, 50)
        .await
        .unwrap_err();

    assert!(
        matches!(err, ChannelMessagesErr::MessageNotFound(id) if id == message_id),
        "expected MessageNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn around_reply_to_deleted_top_level_with_active_replies_still_works() {
    let reply_id = Uuid::new_v4();
    let mut anchor = make_row(Uuid::new_v4(), 0);
    anchor.deleted_at = Some(Utc::now());

    let anchor_clone = anchor.clone();
    let mut repo = MockChannelRepo::new();

    repo.expect_resolve_top_level_parent()
        .returning(move |_, _| {
            let anchor = anchor_clone.clone();
            Box::pin(async move { Ok(Some(anchor)) })
        });
    repo.expect_get_thread_data()
        .returning(move |parent_ids, _| {
            let mut map = HashMap::new();
            map.insert(
                parent_ids[0],
                ThreadData {
                    reply_count: 1,
                    latest_reply_at: Some(Utc::now()),
                    preview_replies: vec![],
                },
            );
            Box::pin(async move { Ok(map) })
        });
    repo.expect_get_top_level_messages_around()
        .returning(|_, _, _, _| Box::pin(async { Ok((vec![], vec![])) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelServiceImpl::new(repo);
    let result = svc
        .get_channel_messages_around(Uuid::nil(), reply_id, 50)
        .await
        .unwrap();

    assert!(!result.has_more_newer);
    assert_eq!(result.page.items.len(), 1);
    assert_eq!(result.page.items[0].id, anchor.id);
}

#[tokio::test]
async fn around_resolves_and_hydrates() {
    let anchor = make_row(Uuid::new_v4(), 0);
    let before_row = make_row(Uuid::new_v4(), 1);
    let after_row = make_row(Uuid::new_v4(), -1);

    let anchor_clone = anchor.clone();
    let before_clone = before_row.clone();
    let after_clone = after_row.clone();

    let mut repo = MockChannelRepo::new();

    repo.expect_resolve_top_level_parent()
        .returning(move |_, _| {
            let a = anchor_clone.clone();
            Box::pin(async move { Ok(Some(a)) })
        });
    repo.expect_get_top_level_messages_around()
        .returning(move |_, _, _, _| {
            let b = vec![before_clone.clone()];
            let a = vec![after_clone.clone()];
            Box::pin(async move { Ok((b, a)) })
        });
    repo.expect_get_thread_data()
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_reactions_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));
    repo.expect_get_attachments_batch()
        .returning(|_| Box::pin(async { Ok(HashMap::new()) }));

    let svc = ChannelServiceImpl::new(repo);
    let result = svc
        .get_channel_messages_around(Uuid::nil(), anchor.id, 50)
        .await
        .unwrap();
    let page = result.page;

    assert!(!result.has_more_newer);
    assert_eq!(page.items.len(), 3);
    // DESC order: after, anchor, before
    assert_eq!(page.items[0].id, after_row.id);
    assert_eq!(page.items[1].id, anchor.id);
    assert_eq!(page.items[2].id, before_row.id);
}

#[tokio::test]
async fn thread_replies_message_not_found() {
    let svc = ChannelServiceImpl::new(empty_repo());
    let message_id = Uuid::new_v4();

    let err = svc
        .get_thread_replies(Uuid::nil(), message_id)
        .await
        .unwrap_err();

    assert!(
        matches!(err, ChannelMessagesErr::MessageNotFound(id) if id == message_id),
        "expected MessageNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn thread_replies_resolve_and_hydrate() {
    let parent = make_row(Uuid::new_v4(), 0);
    let reply_1 = ThreadReplyRow {
        id: Uuid::new_v4(),
        thread_id: parent.id,
        sender_id: "macro|user-a@test.com".into(),
        triggered_by: None,
        content: "reply 1".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };
    let reply_2 = ThreadReplyRow {
        id: Uuid::new_v4(),
        thread_id: parent.id,
        sender_id: "macro|user-b@test.com".into(),
        triggered_by: None,
        content: "reply 2".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
    };

    let parent_clone = parent.clone();
    let reply_1_clone = reply_1.clone();
    let reply_2_clone = reply_2.clone();

    let mut repo = MockChannelRepo::new();

    repo.expect_resolve_top_level_parent()
        .returning(move |_, _| {
            let p = parent_clone.clone();
            Box::pin(async move { Ok(Some(p)) })
        });
    repo.expect_get_thread_replies().returning(move |_| {
        let replies = vec![reply_1_clone.clone(), reply_2_clone.clone()];
        Box::pin(async move { Ok(replies) })
    });
    repo.expect_get_reactions_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<CountedReaction>> = HashMap::new();
        map.insert(
            reply_1.id,
            vec![CountedReaction {
                emoji: "👍".into(),
                users: vec!["macro|user-c@test.com".into()],
            }],
        );
        Box::pin(async move { Ok(map) })
    });
    repo.expect_get_attachments_batch().returning(move |_| {
        let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        map.insert(
            reply_2.id,
            vec![MessageAttachment {
                id: Uuid::new_v4(),
                entity_type: "document".into(),
                entity_id: "doc-1".into(),
                width: None,
                height: None,
                created_at: Utc::now(),
            }],
        );
        Box::pin(async move { Ok(map) })
    });

    let svc = ChannelServiceImpl::new(repo);
    let replies = svc
        .get_thread_replies(Uuid::nil(), reply_1.id)
        .await
        .unwrap();

    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0].id, reply_1.id);
    assert_eq!(replies[0].reactions.len(), 1);
    assert_eq!(replies[0].attachments.len(), 0);
    assert_eq!(replies[1].id, reply_2.id);
    assert_eq!(replies[1].reactions.len(), 0);
    assert_eq!(replies[1].attachments.len(), 1);
}

#[tokio::test]
async fn remove_participants_rejects_removing_channel_owner() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

    svc.remove_participants(
        sender("macro|sender@test.com"),
        channel_id,
        RemoveParticipantsRequest {
            participants: vec!["macro|recipient@test.com".to_string()],
        },
    )
    .await
    .unwrap();

    assert_eq!(
        repo.state.lock().unwrap().removed_participants,
        vec!["macro|recipient@test.com".to_string()]
    );
}

#[tokio::test]
async fn create_channel_event_carries_channel_name() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.create_channel(
        sender("macro|sender@test.com"),
        None,
        crate::domain::models::CreateChannelRequest {
            name: Some("general".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
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
async fn create_private_channel_allows_no_invited_participants() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.create_channel(
        sender("macro|sender@test.com"),
        None,
        crate::domain::models::CreateChannelRequest {
            name: Some("private notes".to_string()),
            channel_type: ChannelType::Private,
            team_id: None,
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
async fn patch_channel_dispatches_channel_updated() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest {
            channel_name: Some("Renamed".to_string()),
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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.patch_channel(
        sender("macro|sender@test.com"),
        channel_id,
        PatchChannelRequest { channel_name: None },
    )
    .await
    .unwrap();

    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn remove_participants_dispatches_participants_removed() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
async fn patch_message_attachments_event_carries_deltas() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    let existing = MutatedAttachment {
        id: Uuid::new_v4(),
        channel_id,
        message_id,
        entity_type: "document".to_string(),
        entity_id: "doc-old".to_string(),
        width: None,
        height: None,
        created_at: Utc::now(),
    };
    repo.state.lock().unwrap().attachments = vec![existing.clone()];
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.patch_message_attachments(
        sender("macro|sender@test.com"),
        channel_id,
        message_id,
        vec![existing.id.to_string()],
        vec![NewChannelAttachment {
            entity_type: "document".to_string(),
            entity_id: "doc-new".to_string(),
            width: None,
            height: None,
        }],
        None,
    )
    .await
    .unwrap();

    let events = events.events.lock().unwrap();
    match events.as_slice() {
        [ChannelEvent::AttachmentsChanged { added, removed, .. }] => {
            assert_eq!(added.len(), 1);
            assert_eq!(added[0].entity_id, "doc-new");
            assert_eq!(removed.len(), 1);
            assert_eq!(removed[0].id, existing.id);
        }
        other => panic!("expected one AttachmentsChanged event, got {other:?}"),
    }
}

#[tokio::test]
async fn private_channel_join_code_is_reused() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo, FakeEvents::default(), FakeReferenceSharing::default());

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
        let svc = mutation_service(
            repo.clone(),
            FakeEvents::default(),
            FakeReferenceSharing::default(),
        );

        let error = svc.get_channel_join_code(channel_id).await.unwrap_err();

        assert!(matches!(error, ChannelMutationErr::Forbidden(_)));
        assert!(repo.state.lock().unwrap().join_code.is_none());
    }
}

#[tokio::test]
async fn unknown_join_code_returns_not_found() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(repo, FakeEvents::default(), FakeReferenceSharing::default());

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
    let svc = mutation_service(repo, FakeEvents::default(), FakeReferenceSharing::default());

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
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    svc.join_channel_by_code(sender("macro|new@test.com"), join_code)
        .await
        .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.participant_additions, 1);
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
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    svc.join_channel_by_code(sender("macro|sender@test.com"), join_code)
        .await
        .unwrap();

    assert_eq!(repo.state.lock().unwrap().participant_additions, 0);
    assert!(events.events.lock().unwrap().is_empty());
}
