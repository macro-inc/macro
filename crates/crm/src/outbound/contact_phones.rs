//! Postgres implementation of [`ContactPhonesRepository`].

use phone_number::PhoneNumber;
use uuid::Uuid;

use super::companies_repo::CompaniesRepositoryImpl;
use crate::domain::{
    contact_phones::{ContactPhone, ContactPhonesRepository, PhoneSource},
    model::CrmError,
};

fn storage(error: sqlx::Error) -> CrmError {
    CrmError::StorageLayerError(error.into())
}

impl ContactPhonesRepository for CompaniesRepositoryImpl {
    async fn contact_phones(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        include_hidden: bool,
    ) -> Result<Option<Vec<ContactPhone>>, CrmError> {
        let rows = sqlx::query!(
            r#"
            SELECT p.phone AS "phone?", p.source AS "source?"
            FROM crm_contacts ct
            LEFT JOIN crm_companies co ON co.id = ct.company_id
            LEFT JOIN crm_contact_phones p ON p.contact_id = ct.id
            WHERE ct.id = $1 AND ct.team_id = $2
              AND ($3 OR (ct.hidden = FALSE AND co.hidden IS NOT TRUE))
            ORDER BY p.created_at, p.phone
            "#,
            contact_id,
            team_id,
            include_hidden,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        if rows.is_empty() {
            return Ok(None);
        }
        rows.into_iter()
            .filter_map(|row| row.phone.zip(row.source))
            .map(|(phone, source)| {
                Ok(ContactPhone {
                    phone: PhoneNumber::parse(&phone).ok_or_else(|| {
                        CrmError::StorageLayerError(anyhow::anyhow!("stored phone is not E.164"))
                    })?,
                    source: source.parse().map_err(|error: strum::ParseError| {
                        CrmError::StorageLayerError(error.into())
                    })?,
                })
            })
            .collect::<Result<Vec<_>, CrmError>>()
            .map(Some)
    }

    async fn set_contact_phones(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        phones: &[PhoneNumber],
        include_hidden: bool,
    ) -> Result<Option<Vec<ContactPhone>>, CrmError> {
        let numbers: Vec<String> = phones.iter().map(ToString::to_string).collect();
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // Lock the contact so concurrent edits apply one after the other.
        let visible = sqlx::query_scalar!(
            r#"
            SELECT ct.id FROM crm_contacts ct
            LEFT JOIN crm_companies co ON co.id = ct.company_id
            WHERE ct.id = $1 AND ct.team_id = $2
              AND ($3 OR (ct.hidden = FALSE AND co.hidden IS NOT TRUE))
            FOR UPDATE OF ct
            "#,
            contact_id,
            team_id,
            include_hidden,
        )
        .fetch_optional(tx.as_mut())
        .await
        .map_err(storage)?;
        if visible.is_none() {
            return Ok(None);
        }
        sqlx::query!(
            "DELETE FROM crm_contact_phones WHERE contact_id = $1 AND NOT (phone = ANY($2))",
            contact_id,
            &numbers,
        )
        .execute(tx.as_mut())
        .await
        .map_err(storage)?;
        sqlx::query!(
            r#"
            INSERT INTO crm_contact_phones (contact_id, phone, source)
            SELECT $1, phone, $3 FROM UNNEST($2::text[]) AS phone
            ON CONFLICT (contact_id, phone) DO NOTHING
            "#,
            contact_id,
            &numbers,
            PhoneSource::Manual.as_ref(),
        )
        .execute(tx.as_mut())
        .await
        .map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        self.contact_phones(team_id, contact_id, include_hidden)
            .await
    }

    async fn add_contact_phones(
        &self,
        team_id: &Uuid,
        phones: &[(Uuid, PhoneNumber)],
        source: PhoneSource,
    ) -> Result<u64, CrmError> {
        if phones.is_empty() {
            return Ok(0);
        }
        let (contact_ids, numbers): (Vec<Uuid>, Vec<String>) = phones
            .iter()
            .map(|(contact_id, phone)| (*contact_id, phone.to_string()))
            .unzip();
        let added = sqlx::query!(
            r#"
            INSERT INTO crm_contact_phones (contact_id, phone, source)
            SELECT n.contact_id, n.phone, $4
            FROM UNNEST($2::uuid[], $3::text[]) AS n(contact_id, phone)
            JOIN crm_contacts ct ON ct.id = n.contact_id AND ct.team_id = $1
            ON CONFLICT (contact_id, phone) DO NOTHING
            "#,
            team_id,
            &contact_ids,
            &numbers,
            source.as_ref(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?
        .rows_affected();
        Ok(added)
    }
}

#[cfg(test)]
mod test;
