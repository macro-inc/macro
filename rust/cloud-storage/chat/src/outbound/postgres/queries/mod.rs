//! Individual SQL queries for chat operations.

pub(crate) mod copy_messages;
pub(crate) mod create_chat_permission;
pub(crate) mod edit_share_permission;
pub(crate) mod get_access_level;
pub(crate) mod get_chat;
pub(crate) mod get_message_content;
pub(crate) mod get_messages;
pub(crate) mod get_permissions;
pub(crate) mod get_web_citations;
pub(crate) mod insert_chat;
pub(crate) mod insert_user_item_access;
pub(crate) mod patch_chat;
pub(crate) mod permanently_delete_chat;
pub(crate) mod revert_delete_chat;
pub(crate) mod soft_delete_chat;
pub(crate) mod update_message_content;
pub(crate) mod upsert_item_last_accessed;
pub(crate) mod upsert_user_history;
