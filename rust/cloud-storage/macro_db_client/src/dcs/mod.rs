// Document Cognition Service (DCS) database queries
// These queries were migrated from document_cognition_service/src/service/db/

// Chat queries
pub mod add_attachment;
pub mod append_attachment_to_chat;
pub mod copy_messages;
pub mod create_chat_message;
pub mod create_empty_chat;
pub mod delete_chat_message;
pub mod get_attachment;
pub mod get_attachments_for_message;
pub mod get_chats;
pub mod get_chats_for_attachment;
pub mod partial_message;
pub mod patch_chat;

// Document queries
pub mod does_document_exist;
pub mod get_document;
pub mod get_document_name_and_type;
pub mod get_documents;
pub mod get_documents_count;

// Macro queries
pub mod create_macro;
pub mod delete_macro;
pub mod get_macro;
pub mod get_macros;
pub mod patch_macro;

// Text queries
pub mod batch_verify;
pub mod get_document_text;
pub mod upsert_document_text;

// Citation queries
pub mod get_part_by_id;

// Notification queries
pub mod get_chat_notification_users;

// chat
pub mod create_chat;
pub mod get_chat;
