//! [`SlackConnector`] and [`SlackSession`] over `slack_client`: the web
//! client's session API and websocket. No trace context goes to Slack.

use std::collections::BTreeSet;

use slack_client::api::{
    ConversationType, HistoryRequest, RepliesRequest, UsersConversationsRequest, validate_session,
};
use slack_client::api::{FileUpload, PostMessage, UpdateMessage};
use slack_client::login::{EmailLogin, LoginError, LoginInput, LoginState, LoginStep};
use slack_client::models::{Team as SlackTeam, User};
use slack_client::realtime::RealtimeConfig;
use slack_client::{
    ChannelId, MessageTs, SessionCredentials, SlackClient, SlackEndpoints, SlackError, TeamId,
    UserId,
};
use slack_linked::domain::events::{BootFacts, Catalogue, UserFacts};
use slack_linked::domain::models::Team;
use slack_linked::domain::session::catalogue_conversation;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

use crate::domain::ports::{
    Connected, MessagePage, SlackConnector, SlackSession, ValidatedSession,
};

/// Conversations asked for per `users.conversations` page.
const CONVERSATION_PAGE: u16 = 200;

/// Slack, at `endpoints` (production, or a fake's).
pub struct SlackApi {
    endpoints: SlackEndpoints,
    login: EmailLogin,
    tracker: TaskTracker,
}

impl SlackApi {
    /// Talk to Slack at `endpoints`; websockets run on `tracker`.
    pub fn new(endpoints: SlackEndpoints, tracker: TaskTracker) -> Result<Self, SlackError> {
        Ok(Self {
            login: EmailLogin::new(endpoints.clone())?,
            endpoints,
            tracker,
        })
    }
}

fn team_icon(team: &SlackTeam) -> Option<String> {
    team.icon.as_ref().and_then(|icon| {
        icon.image_88
            .clone()
            .or_else(|| icon.image_original.clone())
    })
}

impl SlackConnector for SlackApi {
    type Session = SlackClient;

    async fn connect(
        &self,
        credentials: SessionCredentials,
        stop: CancellationToken,
    ) -> Result<Connected<SlackClient>, SlackError> {
        let auth = validate_session(&credentials, &self.endpoints).await?;
        let client = SlackClient::new(credentials, auth.workspace(), self.endpoints.clone())?;
        let boot = client.user_boot().await?;
        let profile = &boot.own_user.profile;
        let display_name = [&profile.display_name, &profile.real_name]
            .into_iter()
            .find(|name| !name.is_empty())
            .cloned();
        let events = client.connect_realtime(RealtimeConfig::default(), stop, &self.tracker);
        Ok(Connected {
            boot: BootFacts {
                slack_user_id: auth.user_id.to_string(),
                display_name,
                team_name: boot.team.name.clone(),
                team_domain: boot.team.domain.clone(),
                team_icon_url: team_icon(&boot.team),
                enterprise_id: auth.enterprise_id.map(|enterprise| enterprise.to_string()),
            },
            session: client,
            events,
        })
    }

    async fn validate(
        &self,
        credentials: &SessionCredentials,
    ) -> Result<ValidatedSession, SlackError> {
        let auth = validate_session(credentials, &self.endpoints).await?;
        let client = SlackClient::new(
            credentials.clone(),
            auth.workspace(),
            self.endpoints.clone(),
        )?;
        let team = client.team_info(None).await?;
        Ok(ValidatedSession {
            team_id: auth.team_id.to_string(),
            enterprise_id: auth.enterprise_id.map(|enterprise| enterprise.to_string()),
            team_name: team.name.clone(),
            team_domain: team.domain.clone(),
            team_icon_url: team_icon(&team),
            slack_user_id: auth.user_id.to_string(),
        })
    }

    async fn login_step(
        &self,
        state: LoginState,
        input: LoginInput,
    ) -> Result<LoginStep, LoginError> {
        self.login.step(state, input).await
    }
}

fn user_facts(user: &User) -> UserFacts {
    let name = |value: &str| (!value.is_empty()).then(|| value.to_owned());
    UserFacts {
        slack_user_id: user.id.to_string(),
        team_id: user.team_id.as_ref().map(|team| team.to_string()),
        display_name: name(&user.profile.display_name),
        real_name: name(&user.profile.real_name).or_else(|| user.real_name.clone()),
        avatar_url: user.profile.image_72.clone(),
        is_bot: user.is_bot,
        deleted: user.deleted,
    }
}

impl SlackSession for SlackClient {
    async fn catalogue(&self) -> Result<Catalogue, SlackError> {
        let own_team = self.workspace().team_id.to_string();
        let mut conversations = Vec::new();
        let mut cursor = None;
        loop {
            let page = self
                .users_conversations(&UsersConversationsRequest {
                    types: vec![
                        ConversationType::PublicChannel,
                        ConversationType::PrivateChannel,
                        ConversationType::Mpim,
                        ConversationType::Im,
                    ],
                    exclude_archived: false,
                    limit: CONVERSATION_PAGE,
                    cursor: cursor.take(),
                })
                .await?;
            // `users.conversations` lists only the caller's conversations
            // and leaves `is_member` out of them.
            conversations.extend(page.channels.into_iter().map(|mut conversation| {
                conversation.is_member = true;
                conversation
            }));
            match page
                .response_metadata
                .next_cursor
                .filter(|next| !next.is_empty())
            {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        // A DM is Slack Connect when its other person is from another team.
        let mut users = Vec::new();
        for user in conversations
            .iter()
            .filter_map(|conversation| conversation.user.clone())
            .collect::<BTreeSet<UserId>>()
        {
            match self.user_info(&user).await {
                Ok(user) => users.push(user),
                Err(error) if error.is_session_ended() => return Err(error),
                Err(error) => tracing::warn!(error = %error, "Reading a Slack user failed"),
            }
        }
        let team_of = |id: &str| {
            users
                .iter()
                .find(|user| user.id.as_str() == id)
                .and_then(|user| user.team_id.as_ref().map(|team| team.to_string()))
        };
        let listed: Vec<_> = conversations
            .iter()
            .filter_map(|conversation| catalogue_conversation(conversation, &own_team, team_of))
            .collect();
        let mut teams = Vec::new();
        for team in listed
            .iter()
            .flat_map(|conversation| conversation.connected_team_ids.iter().cloned())
            .collect::<BTreeSet<String>>()
        {
            let Ok(id) = TeamId::new(team.clone()) else {
                continue;
            };
            match self.team_info(Some(&id)).await {
                Ok(info) => teams.push(Team {
                    team_id: team,
                    icon_url: team_icon(&info),
                    name: info.name,
                    domain: Some(info.domain),
                }),
                Err(error) if error.is_session_ended() => return Err(error),
                Err(error) => tracing::warn!(error = %error, "Reading a Slack team failed"),
            }
        }
        let direct: BTreeSet<&str> = listed
            .iter()
            .filter_map(|conversation| conversation.direct_user_id.as_deref())
            .collect();
        Ok(Catalogue {
            users: users
                .iter()
                .filter(|user| direct.contains(user.id.as_str()))
                .map(user_facts)
                .collect(),
            conversations: listed,
            teams,
        })
    }

    async fn history(
        &self,
        conversation: &ChannelId,
        oldest: Option<&MessageTs>,
        latest: Option<&MessageTs>,
        limit: u16,
    ) -> Result<MessagePage, SlackError> {
        let page = SlackClient::history(
            self,
            &HistoryRequest {
                channel: conversation.clone(),
                latest: latest.cloned(),
                oldest: oldest.cloned(),
                inclusive: false,
                limit,
                cursor: None,
            },
        )
        .await?;
        Ok(MessagePage {
            messages: page.messages,
            has_more: page.has_more,
        })
    }

    async fn replies(
        &self,
        conversation: &ChannelId,
        thread_ts: &MessageTs,
    ) -> Result<Vec<slack_client::models::Message>, SlackError> {
        let root = thread_ts.clone();
        let page = SlackClient::replies(
            self,
            &RepliesRequest {
                channel: conversation.clone(),
                thread_ts: root.clone(),
                oldest: None,
                latest: None,
                inclusive: false,
                limit: 1000,
                cursor: None,
            },
        )
        .await?;
        Ok(page
            .messages
            .into_iter()
            .filter(|message| message.ts != root)
            .collect())
    }

    async fn post(
        &self,
        conversation: &ChannelId,
        text: &str,
        thread_ts: Option<&MessageTs>,
        client_msg_id: Uuid,
    ) -> Result<String, SlackError> {
        let posted = self
            .post_message(&PostMessage {
                channel: conversation.clone(),
                text: text.to_owned(),
                blocks: vec![],
                thread_ts: thread_ts.cloned(),
                reply_broadcast: false,
                client_msg_id,
            })
            .await?;
        Ok(posted.ts.to_string())
    }

    async fn update(
        &self,
        conversation: &ChannelId,
        target: &MessageTs,
        text: &str,
    ) -> Result<String, SlackError> {
        self.update_message(&UpdateMessage {
            channel: conversation.clone(),
            ts: target.clone(),
            text: text.to_owned(),
            blocks: vec![],
        })
        .await?;
        let now = chrono::Utc::now();
        Ok(format!(
            "{}.{:06}",
            now.timestamp(),
            now.timestamp_subsec_micros()
        ))
    }

    async fn delete(&self, conversation: &ChannelId, target: &MessageTs) -> Result<(), SlackError> {
        self.delete_message(conversation, target).await.map(|_| ())
    }

    async fn react(
        &self,
        conversation: &ChannelId,
        target: &MessageTs,
        name: &str,
        add: bool,
    ) -> Result<(), SlackError> {
        if add {
            self.add_reaction(conversation, target, name).await
        } else {
            self.remove_reaction(conversation, target, name).await
        }
    }

    async fn mark(
        &self,
        conversation: &ChannelId,
        thread_ts: Option<&MessageTs>,
        read: &MessageTs,
    ) -> Result<(), SlackError> {
        match thread_ts {
            Some(thread) => self.mark_thread_read(conversation, thread, read).await,
            None => self.mark_read(conversation, read).await,
        }
    }

    async fn upload(&self, upload: &FileUpload) -> Result<String, SlackError> {
        let uploaded = self.upload_file(upload).await?;
        Ok(uploaded.share_ts.to_string())
    }

    async fn download(&self, file: &slack_client::FileId) -> Result<Vec<u8>, SlackError> {
        let info = self.file_info(file).await?;
        let Some(url) = info
            .url_private_download
            .or(info.url_private)
            .and_then(|url| url::Url::parse(&url).ok())
        else {
            return Err(SlackError::InvalidRequest {
                method: slack_client::SlackMethod::FileDownload,
                reason: "the file has no download URL".to_owned(),
            });
        };
        Ok(self.download_file(&url).await?.body.to_vec())
    }

    async fn sign_out(&self) -> Result<(), SlackError> {
        SlackClient::sign_out(self).await
    }
}
