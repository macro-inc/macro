//! A company's contacts: the whole list, and the Team list a page at a time.

use uuid::Uuid;

use super::CompaniesRepositoryImpl;
use crate::domain::model::{
    CrmCompanyContactsCursor, CrmCompanyContactsPage, CrmCompanyContactsQuery, CrmContact, CrmError,
};

impl CompaniesRepositoryImpl {
    /// Every contact of `company_id`, alphabetically by lowercased name (the
    /// email when unnamed), ties on `id DESC`. Hidden contacts only with
    /// `include_hidden`. Checks nothing about the company: callers prove it
    /// visible first.
    pub(super) async fn read_company_contacts(
        &self,
        company_id: &Uuid,
        include_hidden: bool,
    ) -> Result<Vec<CrmContact>, CrmError> {
        sqlx::query_as!(
            CrmContact,
            r#"
            SELECT
                id,
                company_id,
                email,
                name,
                hidden,
                first_interaction,
                last_interaction,
                created_at,
                updated_at,
                ARRAY(
                    SELECT ce.email FROM crm_contact_emails ce
                    WHERE ce.contact_id = ct.id
                    ORDER BY ce.email <> LOWER(BTRIM(ct.email)), ce.created_at, ce.email
                ) AS "emails!",
                ARRAY(
                    SELECT ce.email FROM crm_contact_emails ce
                    WHERE ce.contact_id = ct.id
                      AND EXISTS (
                          SELECT 1 FROM crm_domains d
                          WHERE d.team_id = ct.team_id
                            AND LOWER(d.domain) = split_part(ce.email, '@', 2)
                            AND d.company_id = ct.company_id
                      )
                    ORDER BY ce.created_at, ce.email
                ) AS "company_domain_emails!"
            FROM crm_contacts ct
            WHERE company_id = $1
              AND ($2 OR hidden = FALSE)
            ORDER BY LOWER(COALESCE(name, email)) ASC, id DESC
            "#,
            company_id,
            include_hidden,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }

    /// One page of the Team list; see
    /// [`crate::domain::companies_repo::CompaniesRepository::list_company_contacts_page`].
    pub(super) async fn query_company_contacts_page(
        &self,
        team_id: &Uuid,
        company_id: &Uuid,
        include_hidden: bool,
        query: &CrmCompanyContactsQuery,
    ) -> Result<CrmCompanyContactsPage, CrmError> {
        let (after_name, after_id) = match &query.cursor {
            Some(cursor) => (cursor.sort_name.as_deref(), Some(cursor.id)),
            None => (None, None),
        };

        // One row more than the page holds tells whether another page follows.
        let rows = sqlx::query_file!(
            "src/outbound/companies_repo/company_contacts/page.sql",
            company_id,
            team_id,
            include_hidden,
            query.archived,
            query.search,
            after_name,
            after_id,
            query.limit + 1,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // No row: the company is not visible to this caller.
        if rows.is_empty() {
            return Err(CrmError::CompanyNotFoundForTeam);
        }

        let mut contacts = Vec::with_capacity(rows.len());
        let mut sort_names = Vec::with_capacity(rows.len());
        for row in rows {
            // The company's row with no contact joined: an empty page.
            let (
                Some(id),
                Some(hidden),
                Some(first_interaction),
                Some(last_interaction),
                Some(created_at),
                Some(updated_at),
            ) = (
                row.id,
                row.hidden,
                row.first_interaction,
                row.last_interaction,
                row.created_at,
                row.updated_at,
            )
            else {
                continue;
            };
            sort_names.push(row.sort_name);
            contacts.push(CrmContact {
                id,
                company_id: row.company_id,
                email: row.email,
                name: row.name,
                hidden,
                first_interaction,
                last_interaction,
                created_at,
                updated_at,
                emails: row.emails,
                company_domain_emails: row.company_domain_emails,
            });
        }

        let page_size = usize::try_from(query.limit).unwrap_or(0);
        if contacts.len() <= page_size {
            return Ok(CrmCompanyContactsPage {
                contacts,
                next_cursor: None,
            });
        }

        contacts.truncate(page_size);
        let next_cursor = contacts.last().map(|last| CrmCompanyContactsCursor {
            sort_name: sort_names.swap_remove(page_size - 1),
            id: last.id,
        });
        Ok(CrmCompanyContactsPage {
            contacts,
            next_cursor,
        })
    }
}
