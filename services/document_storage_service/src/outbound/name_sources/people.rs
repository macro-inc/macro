//! People: the viewer's contacts, themselves and their teammates, through the
//! contacts domain's people search, which matches names and email addresses.

use std::{collections::HashSet, sync::Arc};

use contacts::domain::{
    models::people::{PeopleSearchLimit, PeopleSearchQuery, PersonMatch},
    ports::PeopleSearchService,
};
use futures::{StreamExt, TryStreamExt};
use models_search::names::{NameKind, NamedItem};
use search_service::names::{
    Candidate, NameSource, NameSourceError, NameViewer, Needle, READS_PER_SOURCE,
};

#[cfg(test)]
mod test;

/// How many people one name reads, the people search's maximum.
const PEOPLE_PER_NAME: u32 = 50;

/// People the viewer can find, by full name, first name or email address.
pub struct PeopleNames<S> {
    service: Arc<S>,
}

impl<S> PeopleNames<S> {
    /// A source over the contacts service the rest of the service shares.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: PeopleSearchService> NameSource for PeopleNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Person]
    }

    #[tracing::instrument(
        name = "search.names.people",
        skip_all,
        fields(searched = tracing::field::Empty),
        err
    )]
    async fn find(
        &self,
        viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        let limit = PeopleSearchLimit::new(PEOPLE_PER_NAME).ok_or_else(|| {
            NameSourceError::Internal(rootcause::report!("people search limit is zero"))
        })?;

        // A needle too short (or long) to search reads nothing, so it isn't sent.
        let queries: Vec<PeopleSearchQuery> = needles
            .iter()
            .filter_map(|needle| PeopleSearchQuery::new(needle.as_str()))
            .filter(|query| query.searchable().is_some())
            .collect();
        tracing::Span::current().record("searched", queries.len());

        // Futures built up front: a stream `map` closure that borrows the
        // queries isn't `Send` enough for `async_trait`.
        let searches: Vec<_> = queries
            .iter()
            .map(|query| {
                self.service
                    .search_people(viewer.user.clone(), query, limit)
            })
            .collect();
        let found: Vec<Vec<PersonMatch>> = futures::stream::iter(searches)
            .buffer_unordered(READS_PER_SOURCE)
            .try_collect()
            .await
            .map_err(NameSourceError::Internal)?;

        // A person several names found is one candidate.
        let mut seen = HashSet::new();
        Ok(found
            .into_iter()
            .flatten()
            .filter(|person| seen.insert(person.contact.user_id.clone()))
            .map(person_candidate)
            .collect())
    }
}

/// A person as the lookup compares them: by full name, or by email address
/// when they have none, also answering to their first name and email.
fn person_candidate(person: PersonMatch) -> Candidate {
    let user_id = person.contact.user_id;
    let email = user_id.email_str().to_string();
    let full_name = person.contact.name.filter(|name| !name.trim().is_empty());

    let mut aliases = Vec::new();
    let name = match full_name {
        Some(full_name) => {
            // The search answers one display name; its first word is the
            // first name.
            if let Some(first_name) = full_name.split_whitespace().next()
                && first_name != full_name.trim()
            {
                aliases.push(first_name.to_string());
            }
            aliases.push(email);
            full_name
        }
        None => email,
    };

    Candidate {
        item: NamedItem::Person { id: user_id },
        name,
        aliases,
    }
}
