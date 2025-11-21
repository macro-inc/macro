#[cfg(feature = "account_merge_request")]
pub mod account_merge_request;
pub mod activity;
pub mod annotations;
pub mod blocked_email;
pub mod chat;
pub mod convert;
pub mod dcs;
pub mod document;
pub mod document_text;
pub mod docx_unzip;
pub mod entity_name;
pub mod experiment;
pub mod experiment_log;
pub mod history;
pub mod in_progress_email_link;
pub mod in_progress_user_link;
pub mod insight;
pub mod insights_backfill;
pub mod instructions;
pub mod item_access;
pub mod items;
pub mod job;
pub mod macro_user;
pub mod macro_user_email_verification;
pub mod macros;
pub mod notification;
pub mod organization;
pub mod pins;
pub mod projects;
pub mod recents;
pub mod share_permission;
#[cfg(feature = "team")]
pub mod team;
pub mod user;
pub mod user_document_view_location;
pub mod user_quota;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub enum Parameters {
    BigNumber(i64),
    SmallNumber(i32),
    String(String),
    Bool(bool),
}
