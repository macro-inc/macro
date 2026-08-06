//! Conversion from Gmail wire resources into provider-neutral domain data.

#![allow(dead_code)]

mod contact;
mod history;
mod label;
mod message;
mod payload;
mod sanitizer;
mod thread;

#[allow(unused_imports)]
pub(crate) use contact::map_person_to_contact;
#[allow(unused_imports)]
pub(crate) use history::map_history_list_response_to_changes;
#[allow(unused_imports)]
pub(crate) use label::{map_label_to_service, map_labels_to_service};
#[allow(unused_imports)]
pub(crate) use message::map_message_resource_to_service;
#[allow(unused_imports)]
pub(crate) use thread::{map_thread_resource_to_service, map_thread_resources_to_service};
