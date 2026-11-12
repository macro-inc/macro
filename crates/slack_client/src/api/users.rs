use std::collections::BTreeMap;

use serde::Deserialize;

use crate::client::SlackClient;
use crate::error::SlackError;
use crate::ids::{TeamId, UserId};
use crate::method::SlackMethod;
use crate::models::{Team, User, UserProfile};

/// A custom emoji from `emoji.list`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CustomEmoji {
    /// An uploaded image.
    Image(String),
    /// Another emoji's name.
    Alias(String),
}

#[derive(Deserialize)]
struct UserEnvelope {
    user: User,
}

#[derive(Deserialize)]
struct ProfileEnvelope {
    profile: UserProfile,
}

#[derive(Deserialize)]
struct TeamEnvelope {
    team: Team,
}

#[derive(Deserialize)]
struct EmojiEnvelope {
    #[serde(default)]
    emoji: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct EdgeUsers {
    #[serde(default)]
    results: Vec<User>,
}

impl SlackClient {
    /// `users.info`.
    pub async fn user_info(&self, user: &UserId) -> Result<User, SlackError> {
        self.call::<UserEnvelope>(SlackMethod::UsersInfo, vec![("user", user.to_string())])
            .await
            .map(|envelope| envelope.user)
    }

    /// `users.profile.get` for `user`, or the signed-in user.
    pub async fn user_profile(&self, user: Option<&UserId>) -> Result<UserProfile, SlackError> {
        let form = user.map(|user| ("user", user.to_string())).into_iter().collect();
        self.call::<ProfileEnvelope>(SlackMethod::UsersProfileGet, form)
            .await
            .map(|envelope| envelope.profile)
    }

    /// The edge API's user cache, which resolves external (Slack Connect)
    /// users `users.info` can't see. `updated` is the newest `User::updated`
    /// the caller has per user (0 when unknown); Slack omits users that
    /// haven't changed since.
    pub async fn edge_users_info(&self, updated: &BTreeMap<UserId, i64>) -> Result<Vec<User>, SlackError> {
        let updated_ids: serde_json::Map<String, serde_json::Value> = updated
            .iter()
            .map(|(user, updated)| (user.to_string(), serde_json::Value::from(*updated)))
            .collect();
        let mut body = serde_json::Map::new();
        body.insert("check_interaction".to_owned(), serde_json::Value::Bool(true));
        body.insert("include_profile_only_users".to_owned(), serde_json::Value::Bool(true));
        body.insert("updated_ids".to_owned(), serde_json::Value::Object(updated_ids));
        self.call_edge::<EdgeUsers>(SlackMethod::EdgeUsersInfo, "users/info", body)
            .await
            .map(|users| users.results)
    }

    /// `team.info` for `team`, or the client's workspace.
    pub async fn team_info(&self, team: Option<&TeamId>) -> Result<Team, SlackError> {
        let form = team.map(|team| ("team", team.to_string())).into_iter().collect();
        self.call::<TeamEnvelope>(SlackMethod::TeamInfo, form)
            .await
            .map(|envelope| envelope.team)
    }

    /// `emoji.list`: the workspace's custom emoji by name.
    pub async fn emoji_list(&self) -> Result<BTreeMap<String, CustomEmoji>, SlackError> {
        let envelope: EmojiEnvelope = self.call(SlackMethod::EmojiList, Vec::new()).await?;
        Ok(envelope
            .emoji
            .into_iter()
            .map(|(name, value)| {
                let emoji = match value.strip_prefix("alias:") {
                    Some(target) => CustomEmoji::Alias(target.to_owned()),
                    None => CustomEmoji::Image(value),
                };
                (name, emoji)
            })
            .collect())
    }
}
