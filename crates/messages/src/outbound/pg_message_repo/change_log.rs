//! Append a channel's change only after all message work has completed.

#[cfg(test)]
mod test;

use super::{PgMessageRepository, database_error};
use crate::domain::{changes::ChannelChangeKind, models::MessageParent, ports::MessageError};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

// PostgreSQL also uses 57014 for user cancellation. Match only its English
// statement-timeout message; other locales or cancellation causes stay generic.
fn append_error(error: sqlx::Error) -> MessageError {
    if matches!(
        &error,
        sqlx::Error::Database(database)
            if database.code().as_deref() == Some("55P03")
                || (database.code().as_deref() == Some("57014")
                    && database.message() == "canceling statement due to statement timeout")
    ) {
        MessageError::Contended(rootcause::Report::new(error).into())
    } else {
        database_error(error)
    }
}

impl PgMessageRepository {
    /// Append one committed change to its channel's sequence. The caller must
    /// run this after all other database work, immediately before committing.
    /// The counter's row lock makes sequence order equal commit order.
    pub async fn append_channel_change_in(
        tx: &mut Transaction<'_, Postgres>,
        channel_id: Uuid,
        change: ChannelChangeKind,
    ) -> Result<i64, MessageError> {
        let change = match change {
            ChannelChangeKind::Message(id) => channel_change_db_utils::Change::Message(id),
            ChannelChangeKind::Activity(id) => channel_change_db_utils::Change::Activity(id),
            ChannelChangeKind::Reset => channel_change_db_utils::Change::Reset,
        };
        channel_change_db_utils::append_in(tx, channel_id, change)
            .await
            .map_err(append_error)
    }

    pub(super) async fn append_message_change_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        message_id: Uuid,
    ) -> Result<Option<i64>, MessageError> {
        // Other parents retain exactly their existing statements.
        match parent {
            MessageParent::Channel(channel_id) => Self::append_channel_change_in(
                tx,
                *channel_id,
                ChannelChangeKind::Message(message_id),
            )
            .await
            .map(Some),
            _ => Ok(None),
        }
    }
}
