//! Reads of the directed, list-aware directory (`contact_list_members`,
//! `contact_inbox_members` and the current team). Each read is bounded by its
//! page size or requested ids plus one team roster, and runs under a statement
//! timeout because the roster is read whole.

use super::DbContactsRepository;
use crate::domain::models::contact::{Contact, ContactId, ContactName};
use crate::domain::models::list::ContactList;
use crate::domain::models::listed::ListedContact;
use crate::domain::models::page::{ContactCursor, ContactIdEntry, ContactIdPage, ContactPageSize};
use crate::domain::models::people::{NamedPeopleQuery, PeopleSearchLimit, PersonMatch};
use crate::domain::models::query::ContactLookup;
use crate::domain::ports::ContactListReader;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

/// Split `limit + 1` ordered ids into a page and its continuation. The cursor
/// advances past an id that does not parse, so one bad row cannot strand the
/// rest.
fn id_page(mut ids: Vec<String>, limit: ContactPageSize) -> Result<ContactIdPage, Report> {
    let has_more = ids.len() > usize::from(limit.get());
    ids.truncate(usize::from(limit.get()));
    let next_cursor = ids
        .last()
        .filter(|_| has_more)
        .map(|id| {
            ContactCursor::from_position(id.clone())
                .ok_or_else(|| rootcause::report!("invalid contact cursor in database"))
        })
        .transpose()?;
    Ok(ContactIdPage {
        contacts: ids.into_iter().filter_map(ContactIdEntry::parse).collect(),
        next_cursor,
    })
}

fn id_strings(lookup: &ContactLookup) -> Vec<&str> {
    lookup.ids().iter().map(|id| id.as_ref()).collect()
}

/// Parse stored list keys. A key this build does not know, such as a list
/// added later, is skipped rather than failing the read.
fn parse_lists(keys: &[String]) -> Vec<ContactList> {
    keys.iter()
        .filter_map(|key| {
            key.parse::<ContactList>()
                .inspect_err(|_| {
                    tracing::warn!(list_key = %key, "skipping unknown contact list key");
                })
                .ok()
        })
        .collect()
}

/// The list keys of people search's second group, after teammates, and of the
/// named-people read's first, before teammates.
const INTERACTED_GROUP: [ContactList; 2] = [ContactList::Interacted, ContactList::Invited];

/// The list keys of people search's and the named-people read's third group.
const INBOX_GROUP: [ContactList; 2] = [ContactList::Gmail, ContactList::Outlook];

fn keys(lists: &[ContactList]) -> Vec<&str> {
    lists.iter().map(AsRef::as_ref).collect()
}

impl ContactListReader for DbContactsRepository {
    #[tracing::instrument(
        name = "contacts.lists.page.read",
        skip_all,
        fields(limit = i64::from(limit.get()), has_cursor = after.is_some(), count = tracing::field::Empty),
        err
    )]
    async fn list_directory_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let ids = sqlx::query_file_scalar!(
            "src/outbound/repository/directory/page.sql",
            viewer.as_ref(),
            after.map(ContactCursor::position),
            i64::from(limit.get()) + 1,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        let page = id_page(ids, limit)?;
        tracing::Span::current().record("count", page.contacts.len() as i64);
        Ok(page)
    }

    #[tracing::instrument(
        name = "contacts.lists.lookup.read",
        skip_all,
        fields(requested = lookup.ids().len() as i64, count = tracing::field::Empty),
        err
    )]
    async fn lookup_listed_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        if lookup.ids().is_empty() {
            return Ok(Vec::new());
        }
        let ids = id_strings(lookup);
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_file_scalar!(
            "src/outbound/repository/directory/lookup.sql",
            viewer.as_ref(),
            &ids as &[&str],
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        tracing::Span::current().record("count", rows.len() as i64);
        rows.into_iter()
            .map(|id| Ok(MacroUserIdStr::try_from(id)?))
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.lists.memberships.read",
        skip_all,
        fields(requested = lookup.ids().len() as i64, count = tracing::field::Empty),
        err
    )]
    async fn contact_lists(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<ListedContact>, Report> {
        if lookup.ids().is_empty() {
            return Ok(Vec::new());
        }
        let ids = id_strings(lookup);
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_file!(
            "src/outbound/repository/directory/lists.sql",
            viewer.as_ref(),
            &ids as &[&str],
            ContactList::Teammates.as_ref(),
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        tracing::Span::current().record("count", rows.len() as i64);
        let mut listed = Vec::with_capacity(rows.len());
        for row in rows {
            let lists = parse_lists(&row.lists);
            if lists.is_empty() {
                continue;
            }
            listed.push(ListedContact {
                user_id: MacroUserIdStr::try_from(row.contact)?,
                lists,
            });
        }
        Ok(listed)
    }

    #[tracing::instrument(
        name = "contacts.lists.audience.read",
        skip_all,
        fields(limit = i64::from(limit.get()), has_cursor = after.is_some(), count = tracing::field::Empty),
        err
    )]
    async fn audience_page(
        &self,
        subject: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let ids = sqlx::query_file_scalar!(
            "src/outbound/repository/directory/audience.sql",
            subject.as_ref(),
            after.map(ContactCursor::position),
            i64::from(limit.get()) + 1,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        let page = id_page(ids, limit)?;
        tracing::Span::current().record("count", page.contacts.len() as i64);
        Ok(page)
    }

    #[tracing::instrument(
        name = "contacts.lists.people_search.read",
        skip_all,
        fields(limit = i64::from(limit.get()), result_count = tracing::field::Empty),
        err
    )]
    async fn search_listed_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        needle: &str,
        limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        // The read's cost follows the viewer's directory size, so bound it.
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_file!(
            "src/outbound/repository/directory/people_search.sql",
            viewer.as_ref(),
            needle,
            i64::from(limit.get()),
            ContactList::Teammates.as_ref(),
            &keys(&INTERACTED_GROUP) as &[&str],
            &keys(&INBOX_GROUP) as &[&str],
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        tracing::Span::current().record("result_count", rows.len() as i64);
        rows.into_iter()
            .map(|row| {
                let user_id = MacroUserIdStr::try_from(row.user_id)?;
                let name = ContactName {
                    user_id: user_id.clone(),
                    first_name: row.first_name,
                    last_name: row.last_name,
                }
                .display_name();
                Ok(PersonMatch {
                    contact: Contact {
                        id: ContactId::for_viewer(&viewer, &user_id),
                        user_id,
                        name,
                        lists: parse_lists(&row.lists),
                    },
                    is_teammate: row.is_teammate,
                    is_agent: row.is_agent,
                })
            })
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.lists.people_named.read",
        skip_all,
        fields(limit = i64::from(limit.get()), result_count = tracing::field::Empty),
        err
    )]
    async fn name_listed_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        query: &NamedPeopleQuery,
        limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        // The read's cost follows the viewer's directory size, so bound it.
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_file!(
            "src/outbound/repository/directory/people_named.sql",
            viewer.as_ref(),
            query.normalized(),
            &query.words() as &[&str],
            i64::from(limit.get()),
            ContactList::Teammates.as_ref(),
            &keys(&INTERACTED_GROUP) as &[&str],
            &keys(&INBOX_GROUP) as &[&str],
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        tracing::Span::current().record("result_count", rows.len() as i64);
        rows.into_iter()
            .map(|row| {
                let user_id = MacroUserIdStr::try_from(row.user_id)?;
                let name = ContactName {
                    user_id: user_id.clone(),
                    first_name: row.first_name,
                    last_name: row.last_name,
                }
                .display_name();
                Ok(PersonMatch {
                    contact: Contact {
                        id: ContactId::for_viewer(&viewer, &user_id),
                        user_id,
                        name,
                        lists: parse_lists(&row.lists),
                    },
                    is_teammate: row.is_teammate,
                    is_agent: row.is_agent,
                })
            })
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.lists.inbox_contacts.read",
        skip_all,
        fields(count = tracing::field::Empty),
        err
    )]
    async fn inbox_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_file_scalar!(
            "src/outbound/repository/directory/inbox_contacts.sql",
            viewer.as_ref(),
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;

        tracing::Span::current().record("count", rows.len() as i64);
        rows.into_iter()
            .map(|id| Ok(MacroUserIdStr::try_from(id)?))
            .collect()
    }
}
