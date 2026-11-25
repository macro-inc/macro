//! Postgres reads behind the names typed into search operators, through the
//! queries the tag, inbox and channel name searches already run.

use channels::domain::models::ChannelType;
use channels::outbound::channel_name::{ChannelNameSearch, match_channel_names};
use macro_user_id::user_id::MacroUserIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use name_search::escape_regex;
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::email_search::TagOption;
use crate::domain::operator_names::{InboxAddress, OperatorNameSource};
use crate::outbound::email_search::caller_tag_options;

/// The channel types `in:#` names; a DM has no name of its own.
const NAMED_CHANNEL_TYPES: [ChannelType; 3] =
    [ChannelType::Public, ChannelType::Private, ChannelType::Team];

#[cfg(test)]
mod test;

pub(crate) struct OperatorNamesPgSource {
    pub db: ReadOnlyPool,
}

impl OperatorNameSource for OperatorNamesPgSource {
    async fn tag_options(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<TagOption>, Report> {
        caller_tag_options(&self.db, user).await
    }

    async fn inboxes(&self, user: &MacroUserId<Lowercase<'_>>) -> Result<Vec<InboxAddress>, Report> {
        let links = email_db_client::links::get::fetch_inboxes_for_macro_id(&self.db, user.as_ref())
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        Ok(links
            .into_iter()
            .map(|link| InboxAddress {
                link_id: link.id,
                address: String::from(link.email_address),
            })
            .collect())
    }

    async fn channels_named(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        name: &str,
        limit: usize,
    ) -> Result<Vec<Uuid>, Report> {
        let patterns = [format!("^{}$", escape_regex(name))];
        let matches = match_channel_names(
            &self.db,
            ChannelNameSearch {
                viewer_user_id: MacroUserIdStr(user.clone()),
                patterns: &patterns,
                regex_patterns: true,
                channel_ids: &[],
                channel_types: &NAMED_CHANNEL_TYPES,
                after: None,
                limit: i64::try_from(limit).unwrap_or(i64::MAX),
            },
        )
        .await
        .map_err(|error| rootcause::report!("{error:#}"))?;
        Ok(matches.into_iter().map(|hit| hit.channel_id).collect())
    }
}
