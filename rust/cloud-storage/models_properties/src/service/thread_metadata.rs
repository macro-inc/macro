//! Thread metadata model for properties service

use sqlx::FromRow;
use uuid::Uuid;

/// Thread metadata aggregated from email_threads and email_messages tables
#[derive(Debug, Clone, FromRow)]
pub struct ThreadMetadata {
    pub id: Uuid,
    pub subject: Option<String>,
    pub thread_started: Option<chrono::DateTime<chrono::Utc>>,
    pub last_received: Option<chrono::DateTime<chrono::Utc>>,
    pub last_sent: Option<chrono::DateTime<chrono::Utc>>,
    pub message_count: i64,
}
