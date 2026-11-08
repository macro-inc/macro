//! The 41 concrete Macro node payloads and their inherited model behavior.
use crate::policy::{ImportPolicy, ImportedState, SearchText};
use indexmap::IndexMap;
use lexical_model::*;
use lexical_rich_nodes::{code::CodeNode, list::ListNode, mark::MarkNode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::borrow::Cow;
mod data;
mod wire;
pub use data::*;
/// AccountManagerRequestNode model and editing helpers.
pub mod account_manager_request;
pub use account_manager_request::*;
/// AgentActivityNode model and editing helpers.
pub mod agent_activity;
pub use agent_activity::*;
/// AgentContextNode model and editing helpers.
pub mod agent_context;
pub use agent_context::*;
/// AgentSessionMentionNode model and editing helpers.
pub mod agent_session_mention;
pub use agent_session_mention::*;
/// AwaitNode model and editing helpers.
pub mod await_node;
pub use await_node::*;
/// BookingLinkMentionNode model and editing helpers.
pub mod booking_link_mention;
pub use booking_link_mention::*;
/// ClassedBlockNode model and editing helpers.
pub mod classed_block;
pub use classed_block::*;
/// CommentNode model and editing helpers.
pub mod comment;
pub use comment::*;
/// CompletionNode model and editing helpers.
pub mod completion;
pub use completion::*;
/// ConnectAppNode model and editing helpers.
pub mod connect_app;
pub use connect_app::*;
/// ContactMentionNode model and editing helpers.
pub mod contact_mention;
pub use contact_mention::*;
/// CursorSystemNotificationNode model and editing helpers.
pub mod cursor_system_notification;
pub use cursor_system_notification::*;
/// CustomCodeNode model and editing helpers.
pub mod custom_code;
pub use custom_code::*;
/// DatabaseQueryNode model and editing helpers.
pub mod database_query;
pub use database_query::*;
/// DateMentionNode model and editing helpers.
pub mod date_mention;
pub use date_mention::*;
/// DiffDeleteNode model and editing helpers.
pub mod diff_delete;
pub use diff_delete::*;
/// DiffInsertNode model and editing helpers.
pub mod diff_insert;
pub use diff_insert::*;
/// DiffNode model and editing helpers.
pub mod diff;
pub use diff::*;
/// DiffTextNode model and editing helpers.
pub mod diff_text;
pub use diff_text::*;
/// DocumentCardNode model and editing helpers.
pub mod document_card;
pub use document_card::*;
/// DocumentMentionNode model and editing helpers.
pub mod document_mention;
pub use document_mention::*;
/// EquationNode model and editing helpers.
pub mod equation;
pub use equation::*;
/// GroupMentionNode model and editing helpers.
pub mod group_mention;
pub use group_mention::*;
/// HorizontalRuleNode model and editing helpers.
pub mod horizontal_rule;
pub use horizontal_rule::*;
/// HtmlRenderNode model and editing helpers.
pub mod html_render;
pub use html_render::*;
/// ImageNode model and editing helpers.
pub mod image;
pub use image::*;
/// VideoNode model and editing helpers.
pub mod video;
pub use video::*;
/// InlineSearchNode model and editing helpers.
pub mod inline_search;
pub use inline_search::*;
/// MagicChipNode model and editing helpers.
pub mod magic_chip;
pub use magic_chip::*;
/// PasteNode model and editing helpers.
pub mod paste;
pub use paste::*;
/// PullRequestMentionNode model and editing helpers.
pub mod pull_request_mention;
pub use pull_request_mention::*;
/// ReplyTargetNode model and editing helpers.
pub mod reply_target;
pub use reply_target::*;
/// SearchMatchNode model and editing helpers.
pub mod search_match;
pub use search_match::*;
/// SnapshotNode model and editing helpers.
pub mod snapshot;
pub use snapshot::*;
/// TagMentionNode model and editing helpers.
pub mod tag_mention;
pub use tag_mention::*;
/// TaskListNode model and editing helpers.
pub mod task_list;
pub use task_list::*;
/// ThemeMentionNode model and editing helpers.
pub mod theme_mention;
pub use theme_mention::*;
/// UnknownMentionNode model and editing helpers.
pub mod unknown_mention;
pub use unknown_mention::*;
/// UnlinkedTextNode model and editing helpers.
pub mod unlinked_text;
pub use unlinked_text::*;
/// UserMentionNode model and editing helpers.
pub mod user_mention;
pub use user_mention::*;
/// WatermarkNode model and editing helpers.
pub mod watermark;
pub use watermark::*;
mod validation;
pub use validation::*;

mod maybe;
pub use maybe::*;

mod decorator_block;
pub use decorator_block::*;

mod media;
pub use media::*;
