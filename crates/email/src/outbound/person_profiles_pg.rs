//! Postgres persistence for thread participants and cached person profiles.
use crate::domain::person_profiles::{PersonProfile, PersonProfileRepository};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, prelude::IntoRootcause};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Profile adapter over the email message tables and `email_person_profiles`.
#[derive(Debug, Clone)]
pub struct PersonProfilePgRepository(pub PgPool);

impl PersonProfileRepository for PersonProfilePgRepository {
    #[tracing::instrument(skip(self), err)]
    async fn thread_participants(
        &self,
        thread_id: Uuid,
        limit: i64,
    ) -> Result<Vec<String>, Report> {
        Ok(sqlx::query_scalar!(
            r#"SELECT p.address AS "address!"
            FROM (
                SELECT LOWER(c.email_address) AS address, m.internal_date_ts AS seen_at
                FROM email_messages m
                JOIN email_contacts c ON c.id = m.from_contact_id
                WHERE m.thread_id = $1 AND NOT m.is_draft
                UNION ALL
                SELECT LOWER(c.email_address), m.internal_date_ts
                FROM email_messages m
                JOIN email_message_recipients r ON r.message_id = m.id
                JOIN email_contacts c ON c.id = r.contact_id
                WHERE m.thread_id = $1 AND NOT m.is_draft
            ) p
            GROUP BY p.address
            ORDER BY MIN(p.seen_at) NULLS LAST, p.address
            LIMIT $2"#,
            thread_id,
            limit,
        )
        .fetch_all(&self.0)
        .await?)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn viewer_addresses(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<String>, Report> {
        Ok(
            email_db_client::links::get::fetch_inboxes_for_macro_id(&self.0, user.as_ref())
                .await
                .into_rootcause()?
                .into_iter()
                .map(|link| String::from(link.email_address).to_lowercase())
                .collect(),
        )
    }

    #[tracing::instrument(skip(self, addresses), err)]
    async fn stored_profiles(
        &self,
        addresses: &[String],
        fresh_after: DateTime<Utc>,
    ) -> Result<Vec<PersonProfile>, Report> {
        Ok(sqlx::query_as!(
            PersonProfile,
            r#"SELECT email_address, linkedin_url, headline, title, organization_name, photo_url
            FROM email_person_profiles
            WHERE email_address = ANY($1) AND resolved_at >= $2"#,
            addresses,
            fresh_after,
        )
        .fetch_all(&self.0)
        .await?)
    }

    #[tracing::instrument(skip(self, profiles), err)]
    async fn store_profiles(
        &self,
        profiles: &[PersonProfile],
        resolved_at: DateTime<Utc>,
    ) -> Result<(), Report> {
        let mut addresses = Vec::with_capacity(profiles.len());
        let mut linkedin_urls = Vec::with_capacity(profiles.len());
        let mut headlines = Vec::with_capacity(profiles.len());
        let mut titles = Vec::with_capacity(profiles.len());
        let mut organization_names = Vec::with_capacity(profiles.len());
        let mut photo_urls = Vec::with_capacity(profiles.len());
        for profile in profiles {
            addresses.push(profile.email_address.clone());
            linkedin_urls.push(profile.linkedin_url.clone());
            headlines.push(profile.headline.clone());
            titles.push(profile.title.clone());
            organization_names.push(profile.organization_name.clone());
            photo_urls.push(profile.photo_url.clone());
        }
        sqlx::query!(
            r#"INSERT INTO email_person_profiles
                (email_address, linkedin_url, headline, title, organization_name, photo_url, resolved_at)
            SELECT address, linkedin_url, headline, title, organization_name, photo_url, $7
            FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
                AS p(address, linkedin_url, headline, title, organization_name, photo_url)
            ON CONFLICT (email_address) DO UPDATE SET
                linkedin_url = EXCLUDED.linkedin_url,
                headline = EXCLUDED.headline,
                title = EXCLUDED.title,
                organization_name = EXCLUDED.organization_name,
                photo_url = EXCLUDED.photo_url,
                resolved_at = EXCLUDED.resolved_at"#,
            &addresses,
            &linkedin_urls as &[Option<String>],
            &headlines as &[Option<String>],
            &titles as &[Option<String>],
            &organization_names as &[Option<String>],
            &photo_urls as &[Option<String>],
            resolved_at,
        )
        .execute(&self.0)
        .await?;
        Ok(())
    }
}
