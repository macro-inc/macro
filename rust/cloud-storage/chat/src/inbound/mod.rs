//! Inbound adapters for the chat domain.

#[cfg(feature = "attachment")]
pub mod attachment;

#[cfg(test)]
mod test;

mod http;

/// AI toolset exposing chat history to agents.
#[cfg(feature = "ai_tools")]
pub mod toolset;

// Re-exports for backwards compatibility.
pub use self::http::extractors::ChatModelAccess;
pub use self::http::router::{
    __path_call_tool_handler, __path_copy_chat_handler, __path_create_chat_handler,
    __path_delete_chat_handler, __path_get_chat_handler, __path_get_chat_permissions_handler,
    __path_patch_chat_handler, __path_permanently_delete_chat_handler,
    __path_reject_tool_call_handler, __path_revert_delete_handler, __path_update_tool_call_handler,
    __path_update_tool_response_handler, CallToolRequest, CallToolResponse, ChatRouterState,
    CreateChatRequest, GetChatPermissionsResponse, PatchChatRequest, RejectToolCallRequest,
    UpdateToolCallRequest, UpdateToolResponseRequest, call_tool_handler, chat_create_router,
    chat_id_router, copy_chat_handler, create_chat_handler, delete_chat_handler, get_chat_handler,
    get_chat_permissions_handler, patch_chat_handler, permanently_delete_chat_handler,
    reject_tool_call_handler, revert_delete_handler, update_tool_call_handler,
    update_tool_response_handler,
};
