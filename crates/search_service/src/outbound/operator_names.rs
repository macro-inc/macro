//! Postgres reads behind the names typed into search operators, through the
//! queries the tag, inbox and channel name searches already run.

use channels::domain::models::ChannelType;
use channels::outbound::channel_name::{
    ChannelNameSearch, batch_resolve_channel_names, match_channel_names,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use name_search::escape_regex;
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::email_search::TagOption;
use crate::domain::operator_names::{InboxAddress, OperatorNameSource, as_typed};
use crate::outbound::email_search::caller_tag_options;

/// The channel types `in:#` names: a DM by the name the caller sees for it,
/// the other person's, as the channel list shows it.
const IN_CHANNEL_TYPES: [ChannelType; 4] = [
    ChannelType::Public,
    ChannelType::Private,
    ChannelType::Team,
    ChannelType::DirectMessage,
];

#[cfg(test)]
mod test;

/// The phrase quotes a typed term drops, any number of them.
const QUOTES: &str = "[\"“”„]*";

/// A whole-name pattern for `name` as typed, with phrase quotes allowed around
/// each of its characters: a typed term drops its quotes, so `launch beta`
/// names a channel called `Launch "beta"`.
fn name_as_typed_pattern(name: &str) -> String {
    let mut pattern = format!("^{QUOTES}");
    for char in name.chars() {
        pattern.push_str(&escape_regex(char.encode_utf8(&mut [0; 4])));
        pattern.push_str(QUOTES);
    }
    pattern.push('$');
    pattern
}

/// Far longer than a channel name (the channels toolset caps them at 255
/// characters), so a longer typed name names nothing and its pattern is never
/// built: Postgres compiles a regex in time that grows with its length squared.
const LONGEST_CHANNEL_NAME: usize = 1024;

/// Most pages of candidates one channel name reads.
const MAX_CANDIDATE_PAGES: usize = 5;

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

    async fn inboxes(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<InboxAddress>, Report> {
        let links =
            email_db_client::links::get::fetch_inboxes_for_macro_id(&self.db, user.as_ref())
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
        if name.chars().count() > LONGEST_CHANNEL_NAME {
            return Ok(Vec::new());
        }
        let patterns = [name_as_typed_pattern(name)];
        let page_size = i64::try_from(limit).unwrap_or(i64::MAX);
        let wanted = name.to_lowercase();
        let mut named = Vec::new();
        let mut after = None;
        // An unnamed group matches by any one member's name, so a page can
        // hold channels whose whole name, as the caller sees it, isn't
        // `name`; read on until `limit` channels have it or none are left.
        for _ in 0..MAX_CANDIDATE_PAGES {
            let page = match_channel_names(
                &self.db,
                ChannelNameSearch {
                    viewer_user_id: MacroUserIdStr(user.clone()),
                    patterns: &patterns,
                    excluded_patterns: &[],
                    regex_patterns: true,
                    channel_ids: &[],
                    channel_types: &IN_CHANNEL_TYPES,
                    after,
                    limit: page_size,
                },
            )
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
            let ids: Vec<Uuid> = page.iter().map(|hit| hit.channel_id).collect();
            let names = batch_resolve_channel_names(&self.db, &ids, MacroUserIdStr(user.clone()))
                .await
                .map_err(|error| rootcause::report!("{error:#}"))?;
            named.extend(ids.into_iter().filter(|id| {
                names
                    .get(id)
                    .is_some_and(|shown| as_typed(shown).to_lowercase() == wanted)
            }));
            if named.len() >= limit || page.len() < limit {
                break;
            }
            after = page.last().map(|hit| (hit.updated_at, hit.channel_id));
        }
        named.truncate(limit);
        Ok(named)
    }
}
