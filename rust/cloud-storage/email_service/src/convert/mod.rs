//! Conversion utilities for mapping Gmail API responses to service layer models.

mod payload;
mod sanitizer;

pub mod contact;
pub mod history;
pub mod message;
pub mod thread;

// Re-export commonly used functions from the public API
pub use contact::map_person_to_contact;
pub use history::map_history_list_response_to_history;
pub use message::map_message_resource_to_service;
pub use thread::map_thread_resources_to_service;
