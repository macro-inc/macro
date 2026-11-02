//! Compile-time field definitions for typed extraction adapters.
use super::InputIntent;

impl InputIntent {
    /// The meaning of one extracted field; adapters choose its wire representation.
    pub fn typed_field_guidance(self, field: &str) -> Option<&'static str> {
        match (self, field) {
            (Self::Email, "cc") => {
                Some(include_str!("../../prompts/typed_email_cc_prompt.txt").trim_end())
            }
            (Self::Email, "bcc") => {
                Some(include_str!("../../prompts/typed_email_bcc_prompt.txt").trim_end())
            }
            (Self::Email, "subject") => {
                Some(include_str!("../../prompts/typed_email_subject_prompt.txt").trim_end())
            }
            (Self::Email, "body") => {
                Some(include_str!("../../prompts/typed_email_body_prompt.txt").trim_end())
            }
            (Self::Email, "recipients") => {
                Some(include_str!("../../prompts/typed_email_recipients_prompt.txt").trim_end())
            }
            (Self::Note, "title") => {
                Some(include_str!("../../prompts/typed_note_title_prompt.txt").trim_end())
            }
            (Self::Task, "title") => {
                Some(include_str!("../../prompts/typed_task_title_prompt.txt").trim_end())
            }
            (Self::Task, "body") => {
                Some(include_str!("../../prompts/typed_task_body_prompt.txt").trim_end())
            }
            (Self::Task, "properties") => {
                Some(include_str!("../../prompts/typed_task_properties_prompt.txt").trim_end())
            }
            (Self::Calendar, "title") => {
                Some(include_str!("../../prompts/typed_calendar_title_prompt.txt").trim_end())
            }
            (Self::Calendar, "body") => {
                Some(include_str!("../../prompts/typed_calendar_body_prompt.txt").trim_end())
            }
            (Self::Calendar, "location") => {
                Some(include_str!("../../prompts/typed_calendar_location_prompt.txt").trim_end())
            }
            (Self::Calendar, "guests") => {
                Some(include_str!("../../prompts/typed_calendar_guests_prompt.txt").trim_end())
            }
            (Self::Message, "body") => {
                Some(include_str!("../../prompts/typed_message_body_prompt.txt").trim_end())
            }
            (Self::Message, "recipients") => {
                Some(include_str!("../../prompts/typed_message_recipients_prompt.txt").trim_end())
            }
            _ => None,
        }
    }
}
