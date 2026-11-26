//! Resolves the names typed into search operators to what the caller can
//! search: `tag:` to their tag options, `inbox:` to the inboxes they read,
//! `in:#` to the channels they are in. Each read runs only when a search
//! typed a name it resolves.

use std::future::Future;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::email_search::TagOption;

#[cfg(test)]
mod test;

/// Most channels one `in:#` name reaches; a name is rarely shared at all.
pub(crate) const MAX_CHANNELS_NAMED: usize = 20;

/// An inbox the caller reads, with its address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InboxAddress {
    pub link_id: Uuid,
    pub address: String,
}

/// The reads behind [`OperatorNamesService`].
pub(crate) trait OperatorNameSource: Send + Sync {
    /// The tag options the caller can see.
    fn tag_options(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Vec<TagOption>, Report>> + Send;

    /// The inboxes the caller reads: their own and those delegated to them.
    fn inboxes(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Vec<InboxAddress>, Report>> + Send;

    /// At most `limit` channels the caller is in, other than DMs, whose name
    /// is `name` ignoring case.
    fn channels_named(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        name: &str,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

/// The names a search's operators typed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct TypedNames {
    pub tags: Vec<String>,
    pub inboxes: Vec<String>,
    pub channels: Vec<String>,
}

impl TypedNames {
    pub(crate) fn is_empty(&self) -> bool {
        self.tags.is_empty() && self.inboxes.is_empty() && self.channels.is_empty()
    }
}

/// What each typed name reaches for the caller. A name that reaches nothing
/// has no ids.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct NamedIds {
    tags: Vec<(String, Vec<Uuid>)>,
    inboxes: Vec<(String, Vec<Uuid>)>,
    channels: Vec<(String, Vec<Uuid>)>,
}

fn ids_named<'a>(named: &'a [(String, Vec<Uuid>)], name: &str) -> &'a [Uuid] {
    let name = name.to_lowercase();
    named
        .iter()
        .find(|(typed, _)| *typed == name)
        .map_or(&[], |(_, ids)| ids.as_slice())
}

impl NamedIds {
    /// The tag options named `name`.
    pub(crate) fn tag(&self, name: &str) -> &[Uuid] {
        ids_named(&self.tags, name)
    }

    /// The inbox whose address is `address`.
    pub(crate) fn inbox(&self, address: &str) -> &[Uuid] {
        ids_named(&self.inboxes, address)
    }

    /// The channels named `name`.
    pub(crate) fn channel(&self, name: &str) -> &[Uuid] {
        ids_named(&self.channels, name)
    }
}

#[cfg(test)]
impl NamedIds {
    /// Names as a lookup resolved them, lowercased.
    pub(crate) fn from_parts(
        tags: Vec<(String, Vec<Uuid>)>,
        inboxes: Vec<(String, Vec<Uuid>)>,
        channels: Vec<(String, Vec<Uuid>)>,
    ) -> Self {
        Self {
            tags,
            inboxes,
            channels,
        }
    }
}

/// `label` as a typed value can hold it: a query's terms drop the phrase
/// quotes they're typed with, so a tag named `Q3 "Plan"` is typed as
/// `tag:"Q3 Plan"`, and a channel named `Launch "beta"` as
/// `in:#"Launch beta"`.
pub(crate) fn as_typed(label: &str) -> String {
    label
        .chars()
        .filter(|c| !matches!(c, '"' | '“' | '”' | '„'))
        .collect()
}

/// Distinct lowercased names, in the order typed.
fn distinct(names: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for name in names {
        let name = name.to_lowercase();
        if !seen.contains(&name) {
            seen.push(name);
        }
    }
    seen
}

/// Resolves typed names for one caller.
pub(crate) struct OperatorNamesService<S>(pub S);

impl<S: OperatorNameSource> OperatorNamesService<S> {
    /// Looks up every name in `names`, ignoring case, among what `user` can
    /// search.
    #[tracing::instrument(
        name = "search.resolve_operator_names",
        skip_all,
        fields(
            search.tag_names = names.tags.len(),
            search.inbox_names = names.inboxes.len(),
            search.channel_names = names.channels.len(),
        ),
        err
    )]
    pub(crate) async fn resolve(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        names: &TypedNames,
    ) -> Result<NamedIds, Report> {
        let tag_names = distinct(&names.tags);
        let inbox_names = distinct(&names.inboxes);
        let channel_names = distinct(&names.channels);

        let tags = async {
            if tag_names.is_empty() {
                return Ok(Vec::new());
            }
            let options = self.0.tag_options(user).await?;
            Ok::<_, Report>(
                tag_names
                    .iter()
                    .map(|name| {
                        let ids = options
                            .iter()
                            .filter(|option| as_typed(&option.label).to_lowercase() == *name)
                            .map(|option| option.option_id)
                            .collect();
                        (name.clone(), ids)
                    })
                    .collect(),
            )
        };
        let inboxes = async {
            if inbox_names.is_empty() {
                return Ok(Vec::new());
            }
            let inboxes = self.0.inboxes(user).await?;
            Ok::<_, Report>(
                inbox_names
                    .iter()
                    .map(|address| {
                        let ids = inboxes
                            .iter()
                            .filter(|inbox| inbox.address.to_lowercase() == *address)
                            .map(|inbox| inbox.link_id)
                            .collect();
                        (address.clone(), ids)
                    })
                    .collect(),
            )
        };
        let channels = async {
            let mut named = Vec::with_capacity(channel_names.len());
            for name in &channel_names {
                let ids = self
                    .0
                    .channels_named(user, name, MAX_CHANNELS_NAMED)
                    .await?;
                named.push((name.clone(), ids));
            }
            Ok::<_, Report>(named)
        };

        let (tags, inboxes, channels) = tokio::try_join!(tags, inboxes, channels)?;
        Ok(NamedIds {
            tags,
            inboxes,
            channels,
        })
    }
}
