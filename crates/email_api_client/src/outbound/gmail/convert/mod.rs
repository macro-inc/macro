//! Conversion from Gmail wire resources into provider-neutral domain data.

mod contact;
mod history;
mod label;
mod message;
mod payload;
pub(crate) mod sanitizer;
mod thread;

pub(crate) use contact::map_person_to_contact;
pub(crate) use history::map_history_list_response_to_changes;
pub(crate) use label::{map_label_to_service, map_labels_to_service};
pub(crate) use message::map_message_resource_to_service;
pub(crate) use thread::map_thread_resource_to_service;
