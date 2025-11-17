use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ChatFilters,
    ast::{ExpandErr, ParseFromStr, UnknownValue},
};

/// the literal ast type for the chat entity
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ChatLiteral {
    /// the chat is in some nested project structure where [Uuid] is a parent node
    ProjectId(Uuid),
    /// the chat has role [ChatRole]
    Role(ChatRole),
    /// the chat has the id [Uuid]
    ChatId(Uuid),
    /// the chat is owned by [MacroUserIdStr]
    Owner(MacroUserIdStr<'static>),
}

/// the possible roles for a chat
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ChatRole {
    /// the role is user
    User,
    /// the role is system
    System,
    /// the role is assistant
    Assistant,
}

impl ParseFromStr for ChatRole {
    fn parse_from_str<T: AsRef<str>>(s: T) -> Result<Self, super::UnknownValue<Self>> {
        match s.as_ref() {
            "user" => Ok(Self::User),
            "system" => Ok(Self::System),
            "assistant" => Ok(Self::Assistant),
            _ => Err(UnknownValue(
                s.as_ref().to_string(),
                std::marker::PhantomData,
            )),
        }
    }
}

impl ExpandFrame<ChatLiteral> for ChatFilters {
    type Err = ExpandErr;

    fn expand_ast(filter_request: ChatFilters) -> Result<Option<Expr<ChatLiteral>>, Self::Err> {
        let ChatFilters {
            role,
            chat_ids,
            project_ids,
            owners,
        } = filter_request;

        let project_ids = project_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ChatLiteral::ProjectId), Expr::or)?;

        let chat_ids = chat_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ChatLiteral::ChatId), Expr::or)?;

        let role = role
            .iter()
            .map(ChatRole::parse_from_str)
            .try_expand(|r| r.map(ChatLiteral::Role), Expr::or)?;

        let owners = owners
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(ChatLiteral::Owner), Expr::or)?;

        Ok([project_ids, chat_ids, role, owners]
            .into_iter()
            .fold_with(Expr::and))
    }
}
