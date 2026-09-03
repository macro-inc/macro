use super::*;
use crate::domain::{
    dm::ensure_dms_for_joining_member,
    events::ChannelEvent,
    models::{
        Activity, ActivityType, BotId, BotSenderProfile, ChannelAttachment, ChannelAttachmentType,
        ChannelContextMessage, ChannelInfo, ChannelMessageFilters, ChannelMetadata,
        ChannelParticipant, ChannelType, CountedReaction, CreateChannelRequest,
        CreateEntityMentionOptions, CreatedChannel, DeleteMessageQuery, EntityMention,
        GetOrCreateDmRequest, MessageAttachment, MessagePageDirection, MutatedAttachment,
        MutatedMessage, NewChannelAttachment, ParticipantRole, PatchChannelRequest,
        PatchMessageRequest, PostMessageRequest, PostReactionRequest, ReactionAction,
        ReferencedShareItem, ReferencedShareItemType, ResolvedChannelMessage, Sender,
        SimpleMention, ThreadData, ThreadReplyRow, TopLevelMessageRow,
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
    channel_name: Option<String>,
    channel_type: ChannelType,
    channel_team_id: Option<Uuid>,
    user_team_id: Option<Uuid>,
    user_team_id_lookups: usize,
    join_code: Option<Uuid>,
    message: MutatedMessage,
    owner: String,
    participants: Vec<ChannelParticipant>,
    participant_additions: usize,
    thread_participants: Vec<MacroUserIdStr<'static>>,
    attachments: Vec<MutatedAttachment>,
    patched_content: Option<String>,
    activity_upserts: usize,
    touched_channel_ids: Vec<Uuid>,
    fail_channel_touches: bool,
    removed_participants: Vec<String>,
    channel_patches: Vec<(PatchChannelRequest, Option<Uuid>)>,
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
                channel_name: Some("Project".to_string()),
                channel_type: ChannelType::Private,
                channel_team_id: None,
                user_team_id: None,
                user_team_id_lookups: 0,
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
                touched_channel_ids: vec![],
                fail_channel_touches: false,
                removed_participants: vec![],
                channel_patches: vec![],
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

    async fn touch_channel_updated_at(&self, channel_id: Uuid) -> Result<(), Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.touched_channel_ids.push(channel_id);
        if state.fail_channel_touches {
            anyhow::bail!("channel touch failed");
        }
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

    async fn delete_entity_mention_by_id(
        &self,
        _id: Uuid,
    ) -> Result<Option<EntityMention>, Self::Err> {
        Ok(None)
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
    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
}

#[tokio::test]
async fn post_message_treats_email_attachments_as_thread_share_items() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let share = FakeReferenceSharing::default();
    let svc = mutation_service(repo, FakeEvents::default(), share.clone());

    svc.post_message(
        sender("macro|sender@test.com"),
        channel_id,
        PostMessageRequest {
            content: "sharing an email".to_string(),
            mentions: vec![],
            thread_id: None,
            attachments: vec![NewChannelAttachment {
                entity_type: "email".to_string(),
                entity_id: "thread-1".to_string(),
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

    let shared = share.items.lock().unwrap();
    assert!(shared.contains(&ReferencedShareItem::new(
        "thread-1",
        ReferencedShareItemType::EmailThread
    )));
}

#[tokio::test]
async fn post_message_ignores_channel_touch_errors() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    repo.state.lock().unwrap().fail_channel_touches = true;
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

    let result = svc
        .post_message(
            sender("macro|sender@test.com"),
            channel_id,
            PostMessageRequest {
                content: "hello world".to_string(),
                mentions: vec![],
                thread_id: None,
                attachments: vec![],
                nonce: None,
                notification_policy: Default::default(),
                triggered_by: None,
            },
        )
        .await;

    assert!(result.is_ok());
    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
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
async fn patch_message_content_emits_message_changed_event_to_channel_participants() {
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
    assert_eq!(
        recipients
            .iter()
            .map(|recipient| recipient.as_ref())
            .collect::<Vec<_>>(),
        vec!["macro|sender@test.com", "macro|recipient@test.com"]
    );
    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
}

#[tokio::test]
async fn patch_message_attachment_only_touches_channel_once() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

    svc.patch_message(
        sender("macro|sender@test.com"),
        ParticipantRole::Member,
        channel_id,
        message_id,
        PatchMessageRequest {
            content: None,
            mentions: None,
            attachment_ids_to_delete: None,
            attachments_to_add: Some(vec![NewChannelAttachment {
                entity_type: "document".to_string(),
                entity_id: "doc-1".to_string(),
                width: None,
                height: None,
            }]),
            nonce: None,
            notification_policy: Default::default(),
        },
    )
    .await
    .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.touched_channel_ids, vec![channel_id]);
    assert!(state.patched_content.is_none());
}

#[tokio::test]
async fn patch_message_content_and_attachments_touch_channel_once() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
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
            attachments_to_add: Some(vec![NewChannelAttachment {
                entity_type: "document".to_string(),
                entity_id: "doc-1".to_string(),
                width: None,
                height: None,
            }]),
            nonce: None,
            notification_policy: Default::default(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        repo.state.lock().unwrap().touched_channel_ids,
        vec![channel_id]
    );
}

#[tokio::test]
async fn patch_message_without_content_or_attachment_changes_does_not_touch_channel() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

    svc.patch_message(
        sender("macro|sender@test.com"),
        ParticipantRole::Member,
        channel_id,
        message_id,
        PatchMessageRequest {
            content: None,
            mentions: None,
            attachment_ids_to_delete: None,
            attachments_to_add: None,
            nonce: None,
            notification_policy: Default::default(),
        },
    )
    .await
    .unwrap();

    assert!(repo.state.lock().unwrap().touched_channel_ids.is_empty());
}

#[tokio::test]
async fn patch_message_propagates_channel_touch_errors() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let message_id = repo.state.lock().unwrap().message.id;
    repo.state.lock().unwrap().fail_channel_touches = true;
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

    let error = svc
        .patch_message(
            sender("macro|sender@test.com"),
            ParticipantRole::Member,
            channel_id,
            message_id,
            PatchMessageRequest {
                content: Some("edited".to_string()),
                mentions: None,
                attachment_ids_to_delete: None,
                attachments_to_add: None,
                nonce: None,
                notification_policy: Default::default(),
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
async fn patch_message_notify_as_posted_adds_notification_context_for_channel_participants() {
    let channel_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_sender = bot_id.into_storage_id().to_string();
    let repo = FakeMutationRepo::new(channel_id, &bot_sender);
    repo.state.lock().unwrap().message.thread_id = Some(thread_id);
    repo.state.lock().unwrap().message.sender_id = Sender::new_from_bot(bot_id);
    {
        let mut state = repo.state.lock().unwrap();
        let now = Utc::now();
        state.participants = ["macro|requester@test.com", "macro|observer@test.com"]
            .into_iter()
            .map(|user_id| ChannelParticipant {
                channel_id,
                user_id: user_id.to_string(),
                role: ParticipantRole::Member,
                joined_at: now,
                left_at: None,
            })
            .collect();
    }
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
        recipients,
        posted_notification,
        ..
    } = &emitted[0]
    else {
        panic!("expected MessageChanged event, got {:?}", emitted[0]);
    };
    assert_eq!(message.content, "final answer");
    assert_eq!(
        recipients
            .iter()
            .map(|recipient| recipient.as_ref())
            .collect::<Vec<_>>(),
        vec!["macro|requester@test.com", "macro|observer@test.com"]
    );
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
    assert!(repo.state.lock().unwrap().touched_channel_ids.is_empty());
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
async fn add_participants_touches_channel_once_when_any_membership_changes() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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

/// Signup on main called `create_channel(Sender::new_from_user(owner))`.
/// That is the path that made "Created # Macro Support x …" render as You.
#[tokio::test]
async fn signup_support_channel_via_user_create_channel_attributes_created_to_owner() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|owner@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let service = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let service = ChannelServiceImpl::with_dependencies(
        repo,
        events.clone(),
        FakeReferenceSharing::default(),
    );

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
    let service = mutation_service(repo, FakeEvents::default(), FakeReferenceSharing::default());

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
    let service = ChannelServiceImpl::with_dependencies(
        repo,
        events.clone(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let svc = mutation_service(repo, FakeEvents::default(), FakeReferenceSharing::default());

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

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
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

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
async fn join_channel_touches_channel_when_membership_changes() {
    let channel_id = Uuid::new_v4();
    let repo = FakeMutationRepo::new(channel_id, "macro|sender@test.com");
    let events = FakeEvents::default();
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

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
    let svc = mutation_service(
        repo.clone(),
        events.clone(),
        FakeReferenceSharing::default(),
    );

    svc.join_channel_by_code(sender("macro|sender@test.com"), join_code)
        .await
        .unwrap();

    let state = repo.state.lock().unwrap();
    assert_eq!(state.participant_additions, 0);
    assert!(state.touched_channel_ids.is_empty());
    assert!(events.events.lock().unwrap().is_empty());
}
