pub mod body_replyless;
pub mod generic_email;

pub use generic_email::{dedupe_emails, is_generic_email};
