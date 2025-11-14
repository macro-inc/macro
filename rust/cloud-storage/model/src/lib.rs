use chrono::serde::ts_seconds_option;
use serde::{Deserialize, Serialize};
pub mod activity;
pub mod annotations;
pub mod authentication;
pub mod chat;
pub mod citations;
pub mod comms;
pub mod contacts;
pub mod convert;
pub mod document;
pub mod document_storage_service_internal;
pub mod experiment;
pub mod folder;
pub mod insight_context;
pub mod item;
pub mod macros;
pub mod organization;
pub mod pin;
pub mod project;
pub mod request;
pub mod response;
pub mod sync_service;
pub mod thread;
pub mod tracking;
pub mod user;
pub mod user_document_view_location;
pub mod version;

/// Simple struct to retrvieve an ID with created/updated timestamps from db
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct IDWithTimeStamps {
    pub id: String,
    #[serde(with = "ts_seconds_option")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(with = "ts_seconds_option")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct StringID {
    pub id: String,
}
