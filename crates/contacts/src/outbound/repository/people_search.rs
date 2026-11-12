use super::DbContactsRepository;
use crate::domain::{
    models::{
        contact::{Contact, ContactId, ContactName},
        people::{PeopleSearchLimit, PersonMatch},
    },
    ports::PeopleSearchRepository,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

impl PeopleSearchRepository for DbContactsRepository {
    #[tracing::instrument(
        name = "contacts.people_search.read",
        skip_all,
        fields(limit = i64::from(limit.get()), result_count = tracing::field::Empty),
        err
    )]
    async fn search_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        needle: &str,
        limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        // The read's cost follows the viewer's contact count, so bound it.
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_file!(
            "src/outbound/repository/people_search.sql",
            viewer.as_ref(),
            needle,
            i64::from(limit.get()),
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        tracing::Span::current().record("result_count", rows.len() as i64);
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                // Legacy IDs that are not valid user IDs are never results.
                let user_id = MacroUserIdStr::try_from(row.user_id).ok()?;
                let name = ContactName {
                    user_id: user_id.clone(),
                    first_name: row.first_name,
                    last_name: row.last_name,
                }
                .display_name();
                Some(PersonMatch {
                    contact: Contact {
                        id: ContactId::for_viewer(&viewer, &user_id),
                        user_id,
                        name,
                    },
                    is_teammate: row.is_teammate,
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
