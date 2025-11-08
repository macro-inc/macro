use crate::util::process_pre_insert::clean_message::clean_subject_snippet::{
    clean_message_subject_snippet, clean_threads_subject_snippet,
};
use crate::util::process_pre_insert::clean_message::remove_trailing_br_tags::{
    remove_trailing_br_tags, remove_trailing_br_tags_threads,
};
use models_email::service;

mod clean_subject_snippet;
mod remove_trailing_br_tags;

// cleans the html of a thread
pub fn clean_threads(threads: &mut Vec<service::thread::Thread>) {
    clean_threads_subject_snippet(threads);

    remove_trailing_br_tags_threads(threads)
}

// cleans the html of a message
pub fn clean_message(message: &mut service::message::Message) {
    clean_message_subject_snippet(message);

    remove_trailing_br_tags(message);
}
