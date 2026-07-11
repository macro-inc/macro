use crate::email::service::message;

pub fn get_body_parsed_for_message(message: &message::MessageWithBodyReplyless) -> Option<String> {
    email_utils::body_parsed::compute_body_parsed(
        message.inner.body_html_sanitized.is_some(),
        &message.body_replyless,
    )
}

pub fn get_body_parsed_linkless_for_message(
    message: &message::MessageWithBodyReplyless,
) -> Option<String> {
    email_utils::body_parsed::compute_body_parsed_linkless(
        message.inner.body_html_sanitized.is_some(),
        &message.body_replyless,
    )
}
