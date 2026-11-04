use super::*;
use crate::domain::mailbox::{contacts::*, projection::ProjectionEvent};
use email_api_client::domain::models::{AddressBookContact, AddressBookPage, ContactFolderCatalog};
use sqlx::{Postgres, Transaction};

#[cfg(test)]
mod test;

impl AddressBookRepository for PgMailboxSync {
    async fn claim(&self, lease_id: Uuid) -> Result<Option<AddressBookWork>, MailboxError> {
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT s.id FROM email_sync_streams s JOIN email_links l ON l.id = s.link_id
                WHERE l.is_sync_active AND l.provider = 'OUTLOOK' AND s.generation = l.sync_generation
                    AND s.kind IN ('contacts_catalog','contacts_profile','contacts') AND s.next_run_at <= now()
                    AND (s.lease_until IS NULL OR s.lease_until < now())
                ORDER BY s.next_run_at,s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED
            ) UPDATE email_sync_streams s SET lease_id = $1,lease_until = now() + interval '3 minutes',fence = fence + 1
            FROM candidate c,email_links l WHERE s.id = c.id AND l.id = s.link_id
            RETURNING s.id,s.link_id,s.generation,l.grant_generation,s.scope_id,s.position,s.initial_complete,s.fence,s.scan_id,s.kind
        "#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|row| {
            Ok(AddressBookWork {
                kind: match row.kind.as_str() {
                    "contacts_catalog" => AddressBookWorkKind::Catalog,
                    "contacts_profile" => AddressBookWorkKind::Profile,
                    _ => AddressBookWorkKind::Folder,
                },
                scan_id: row.scan_id,
                stream: StreamLease {
                    id: row.id,
                    mailbox: MailboxKey {
                        link_id: row.link_id,
                        sync_generation: row.generation,
                        grant_generation: row.grant_generation,
                    },
                    folder: ProviderId::new(row.scope_id)?,
                    position: row.position.map(StreamToken::new),
                    initial_complete: row.initial_complete,
                    lease_id,
                    fence: row.fence,
                },
            })
        })
        .transpose()
    }

    async fn renew(&self, work: &AddressBookWork) -> Result<(), MailboxError> {
        let lease = &work.stream;
        if self
            .renew_stream(lease.id, lease.lease_id, lease.fence, lease.mailbox)
            .await?
            != 1
        {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn commit_catalog(
        &self,
        work: &AddressBookWork,
        catalog: &ContactFolderCatalog,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        lock_work(&mut tx, work).await?;
        let link = work.stream.mailbox.link_id;
        let mut ids: Vec<_> = catalog
            .folders
            .iter()
            .map(|id| id.as_str().to_owned())
            .collect();
        // Graph doesn't expose an empty default folder through /contactFolders.
        // A previously learned root remains a valid delta stream when emptied.
        if catalog.default_folder.is_none() {
            ids.extend(sqlx::query_scalar!("SELECT provider_id FROM email_address_book_folders WHERE link_id = $1 AND is_default",link)
                .fetch_all(&mut *tx).await.map_err(db_error)?);
        }
        let removed_emails = sqlx::query_scalar!(r#"
            SELECT DISTINCT unnest(emails) AS "email!" FROM email_address_book_sources
            WHERE link_id = $1 AND folder_id <> '' AND NOT(folder_id = ANY($2)) AND deleted_at IS NULL
        "#,link,&ids).fetch_all(&mut *tx).await.map_err(db_error)?;
        sqlx::query!(r#"UPDATE email_address_book_sources SET deleted_at = now(),revision = revision + 1,photo_lease_id = NULL,photo_lease_until = NULL
            WHERE link_id = $1 AND folder_id <> '' AND NOT(folder_id = ANY($2)) AND deleted_at IS NULL"#,link,&ids)
            .execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!("DELETE FROM email_address_book_folders WHERE link_id = $1 AND NOT(provider_id = ANY($2))",link,&ids)
            .execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!("DELETE FROM email_sync_streams WHERE link_id = $1 AND generation = $2 AND kind = 'contacts' AND NOT(scope_id = ANY($3))",link,work.stream.mailbox.sync_generation,&ids)
            .execute(&mut *tx).await.map_err(db_error)?;
        for folder in &ids {
            let is_default = catalog
                .default_folder
                .as_ref()
                .is_some_and(|id| id.as_str() == folder);
            sqlx::query!(r#"INSERT INTO email_address_book_folders(link_id,provider_id,is_default) VALUES ($1,$2,$3)
                ON CONFLICT(link_id,provider_id) DO UPDATE SET is_default = email_address_book_folders.is_default OR EXCLUDED.is_default"#,link,folder,is_default)
                .execute(&mut *tx).await.map_err(db_error)?;
            sqlx::query!(r#"INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id) VALUES ($1,$2,$3,'contacts',$4)
                ON CONFLICT DO NOTHING"#,macro_uuid::generate_uuid_v7(),link,work.stream.mailbox.sync_generation,folder)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        project_contacts(&mut tx, work.stream.mailbox, &removed_emails).await?;
        finish_work(&mut tx, work, None, true, 900).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn commit_profile(
        &self,
        work: &AddressBookWork,
        profile: &AddressBookContact,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        lock_work(&mut tx, work).await?;
        let email = sqlx::query_scalar!(
            "SELECT email_address FROM email_links WHERE id = $1",
            work.stream.mailbox.link_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        // The binding's verified primary address, not an optional /me claim,
        // identifies the inbox avatar and self-contact in the shared model.
        let emails = vec![email.to_lowercase()];
        let contact = AddressBookContact {
            id: ProviderId::new("self")?,
            name: profile.name.clone(),
            emails: emails.clone(),
        };
        upsert_source(&mut tx, work, "", &contact).await?;
        project_contacts(&mut tx, work.stream.mailbox, &emails).await?;
        finish_work(&mut tx, work, None, true, 86400).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn commit_page(
        &self,
        work: &AddressBookWork,
        page: &AddressBookPage,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        lock_work(&mut tx, work).await?;
        let link = work.stream.mailbox.link_id;
        let folder = work.stream.folder.as_str();
        let mut ids: Vec<_> = page
            .contacts
            .iter()
            .map(|contact| contact.id.as_str().to_owned())
            .collect();
        ids.extend(page.removed.iter().map(|id| id.as_str().to_owned()));
        let mut emails = sqlx::query_scalar!(r#"SELECT DISTINCT unnest(emails) AS "email!" FROM email_address_book_sources WHERE link_id = $1 AND folder_id = $2 AND provider_id = ANY($3)"#,link,folder,&ids)
            .fetch_all(&mut *tx).await.map_err(db_error)?;
        for contact in &page.contacts {
            upsert_source(&mut tx, work, folder, contact).await?;
            emails.extend(contact.emails.iter().cloned());
        }
        let removed: Vec<_> = page
            .removed
            .iter()
            .map(|id| id.as_str().to_owned())
            .collect();
        sqlx::query!(r#"UPDATE email_address_book_sources SET deleted_at = now(),revision = revision + 1,photo_lease_id = NULL,photo_lease_until = NULL
            WHERE link_id = $1 AND folder_id = $2 AND provider_id = ANY($3)"#,link,folder,&removed)
            .execute(&mut *tx).await.map_err(db_error)?;
        let (position, complete) = match &page.position {
            StreamPosition::Continue(token) => (token, false),
            StreamPosition::Checkpoint(token) => (token, true),
        };
        if complete && !work.stream.initial_complete {
            // A reset is a fresh snapshot. Retire unseen records only after its
            // final page, including records left over from a prior generation.
            let stale = sqlx::query!(r#"UPDATE email_address_book_sources SET deleted_at = now(),revision = revision + 1,photo_lease_id = NULL,photo_lease_until = NULL
                WHERE link_id = $1 AND folder_id = $2 AND scan_id <> $3 AND deleted_at IS NULL RETURNING emails"#,link,folder,work.scan_id)
                .fetch_all(&mut *tx).await.map_err(db_error)?;
            for source in stale {
                emails.extend(source.emails);
            }
        }
        emails.sort();
        emails.dedup();
        project_contacts(&mut tx, work.stream.mailbox, &emails).await?;
        finish_work(
            &mut tx,
            work,
            Some(position.expose()),
            complete,
            if complete { 300 } else { 0 },
        )
        .await?;
        tx.commit().await.map_err(db_error)
    }

    async fn reset(&self, work: &AddressBookWork) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        lock_work(&mut tx, work).await?;
        sqlx::query!("UPDATE email_sync_streams SET position = NULL,initial_complete = false,scan_id = $2,next_run_at = now(),lease_id = NULL,lease_until = NULL WHERE id = $1",work.stream.id,macro_uuid::generate_uuid_v7())
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn retire_folder(&self, work: &AddressBookWork) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        lock_work(&mut tx, work).await?;
        let rows = sqlx::query!("UPDATE email_address_book_sources SET deleted_at = now(),revision = revision + 1,photo_lease_id = NULL,photo_lease_until = NULL WHERE link_id = $1 AND folder_id = $2 AND deleted_at IS NULL RETURNING emails",work.stream.mailbox.link_id,work.stream.folder.as_str())
            .fetch_all(&mut *tx).await.map_err(db_error)?;
        let emails = rows
            .into_iter()
            .flat_map(|row| row.emails)
            .collect::<Vec<_>>();
        project_contacts(&mut tx, work.stream.mailbox, &emails).await?;
        sqlx::query!(
            "DELETE FROM email_sync_streams WHERE id = $1",
            work.stream.id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query!(
            "DELETE FROM email_address_book_folders WHERE link_id = $1 AND provider_id = $2",
            work.stream.mailbox.link_id,
            work.stream.folder.as_str()
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query!("UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1 AND generation = $2 AND kind = 'contacts_catalog'",work.stream.mailbox.link_id,work.stream.mailbox.sync_generation)
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn release(&self, work: &AddressBookWork, delay: u32) -> Result<(), MailboxError> {
        sqlx::query!("UPDATE email_sync_streams SET lease_id = NULL,lease_until = NULL,next_run_at = now() + make_interval(secs => $4) WHERE id = $1 AND lease_id = $2 AND fence = $3",work.stream.id,work.stream.lease_id,work.stream.fence,f64::from(delay))
            .execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }

    async fn claim_photo(&self, lease_id: Uuid) -> Result<Option<ContactPhotoLease>, MailboxError> {
        let row = sqlx::query!(r#"WITH candidate AS (
            SELECT s.link_id,s.folder_id,s.provider_id FROM email_address_book_sources s JOIN email_links l ON l.id = s.link_id
            WHERE l.is_sync_active AND l.provider = 'OUTLOOK' AND s.deleted_at IS NULL AND s.photo_due_at <= now()
                AND (s.photo_lease_until IS NULL OR s.photo_lease_until < now())
            ORDER BY s.photo_due_at,s.link_id,s.folder_id,s.provider_id LIMIT 1 FOR UPDATE OF s SKIP LOCKED
        ) UPDATE email_address_book_sources s SET photo_lease_id = $1,photo_lease_until = now() + interval '3 minutes'
        FROM candidate c,email_links l WHERE s.link_id = c.link_id AND s.folder_id = c.folder_id AND s.provider_id = c.provider_id AND l.id = s.link_id
        RETURNING s.link_id,s.folder_id,s.provider_id,s.revision,s.photo_hash,s.photo_url,l.sync_generation,l.grant_generation
        "#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|row| {
            Ok(ContactPhotoLease {
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.sync_generation,
                    grant_generation: row.grant_generation,
                },
                folder: if row.folder_id.is_empty() {
                    None
                } else {
                    Some(ProviderId::new(row.folder_id)?)
                },
                contact: ProviderId::new(row.provider_id)?,
                revision: row.revision,
                lease_id,
                photo_hash: row.photo_hash,
                photo_url: row.photo_url,
            })
        })
        .transpose()
    }
    async fn renew_photo(&self, lease: &ContactPhotoLease) -> Result<(), MailboxError> {
        let updated = sqlx::query!(r#"UPDATE email_address_book_sources s SET photo_lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE s.link_id = $1 AND s.folder_id = $2 AND s.provider_id = $3 AND s.revision = $4
                AND s.photo_lease_id = $5 AND s.photo_lease_until > now() AND s.deleted_at IS NULL AND l.id = s.link_id
                AND l.sync_generation = $6 AND l.grant_generation = $7 AND l.is_sync_active"#,
            lease.mailbox.link_id,lease.folder.as_ref().map_or("",ProviderId::as_str),lease.contact.as_str(),lease.revision,lease.lease_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation)
            .execute(&self.db).await.map_err(db_error)?;
        if updated.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }
    async fn commit_photo(
        &self,
        lease: &ContactPhotoLease,
        hash: Option<&str>,
        url: Option<&str>,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        lock_mailbox(&mut tx, lease.mailbox).await?;
        let row = sqlx::query!(r#"UPDATE email_address_book_sources SET photo_url = $6,photo_hash = $7,photo_due_at = now() + interval '1 day',photo_lease_id = NULL,photo_lease_until = NULL
            WHERE link_id = $1 AND folder_id = $2 AND provider_id = $3 AND revision = $4 AND photo_lease_id = $5 AND photo_lease_until > now() AND deleted_at IS NULL RETURNING emails"#,
            lease.mailbox.link_id,lease.folder.as_ref().map_or("",ProviderId::as_str),lease.contact.as_str(),lease.revision,lease.lease_id,url,hash)
            .fetch_optional(&mut *tx).await.map_err(db_error)?.ok_or(MailboxError::Stale)?;
        project_contacts(&mut tx, lease.mailbox, &row.emails).await?;
        tx.commit().await.map_err(db_error)
    }
    async fn release_photo(
        &self,
        lease: &ContactPhotoLease,
        delay: u32,
    ) -> Result<(), MailboxError> {
        sqlx::query!(r#"UPDATE email_address_book_sources SET photo_lease_id = NULL,photo_lease_until = NULL,photo_due_at = now() + make_interval(secs => $6)
            WHERE link_id = $1 AND folder_id = $2 AND provider_id = $3 AND revision = $4 AND photo_lease_id = $5"#,
            lease.mailbox.link_id,lease.folder.as_ref().map_or("",ProviderId::as_str),lease.contact.as_str(),lease.revision,lease.lease_id,f64::from(delay))
            .execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }
}

async fn lock_mailbox(
    tx: &mut Transaction<'_, Postgres>,
    mailbox: MailboxKey,
) -> Result<(), MailboxError> {
    let row = sqlx::query!("SELECT id FROM email_links WHERE id = $1 AND sync_generation = $2 AND grant_generation = $3 AND is_sync_active FOR UPDATE",mailbox.link_id,mailbox.sync_generation,mailbox.grant_generation)
        .fetch_optional(&mut **tx).await.map_err(db_error)?;
    if row.is_none() {
        return Err(MailboxError::Stale);
    }
    Ok(())
}
async fn lock_work(
    tx: &mut Transaction<'_, Postgres>,
    work: &AddressBookWork,
) -> Result<(), MailboxError> {
    lock_mailbox(tx, work.stream.mailbox).await?;
    let row = sqlx::query!("SELECT id FROM email_sync_streams WHERE id = $1 AND lease_id = $2 AND fence = $3 AND lease_until > now() FOR UPDATE",work.stream.id,work.stream.lease_id,work.stream.fence)
        .fetch_optional(&mut **tx).await.map_err(db_error)?;
    if row.is_none() {
        return Err(MailboxError::Stale);
    }
    Ok(())
}
async fn finish_work(
    tx: &mut Transaction<'_, Postgres>,
    work: &AddressBookWork,
    position: Option<&str>,
    complete: bool,
    delay: u32,
) -> Result<(), MailboxError> {
    sqlx::query!(r#"UPDATE email_sync_streams SET position = $2,initial_complete = initial_complete OR $3,
        last_completed_at = CASE WHEN $3 THEN now() ELSE last_completed_at END,next_run_at = now() + make_interval(secs => $4),lease_id = NULL,lease_until = NULL WHERE id = $1"#,work.stream.id,position,complete,f64::from(delay))
        .execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}
async fn upsert_source(
    tx: &mut Transaction<'_, Postgres>,
    work: &AddressBookWork,
    folder: &str,
    contact: &AddressBookContact,
) -> Result<(), MailboxError> {
    let name = contact
        .name
        .as_ref()
        .map(|name| name.chars().take(255).collect::<String>());
    sqlx::query!(r#"INSERT INTO email_address_book_sources(link_id,folder_id,provider_id,display_name,emails,scan_id) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(link_id,folder_id,provider_id) DO UPDATE SET display_name = EXCLUDED.display_name,emails = EXCLUDED.emails,
            scan_id = EXCLUDED.scan_id,deleted_at = NULL,revision = email_address_book_sources.revision + 1,
            photo_due_at = now(),photo_lease_id = NULL,photo_lease_until = NULL"#,
        work.stream.mailbox.link_id,folder,contact.id.as_str(),name, &contact.emails,work.scan_id)
        .execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}

/// Update only the address-book contribution to each normalized contact. A
/// different writer's later value becomes the fallback instead of being erased.
async fn project_contacts(
    tx: &mut Transaction<'_, Postgres>,
    mailbox: MailboxKey,
    emails: &[String],
) -> Result<(), MailboxError> {
    if emails.is_empty() {
        return Ok(());
    }
    let link = mailbox.link_id;
    sqlx::query!(
        r#"INSERT INTO email_contacts(id,link_id,email_address)
        SELECT gen_random_uuid(),$1,email FROM (SELECT DISTINCT unnest($2::text[]) AS email) e
        WHERE email <> '' AND length(email) < 310 ON CONFLICT(link_id,email_address) DO NOTHING"#,
        link,
        emails
    )
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    let rows = sqlx::query!(r#"
        SELECT c.id,c.name,c.sfs_photo_url,p.contact_id AS "contact_id?",p.previous_name,p.applied_name,p.previous_photo,p.applied_photo,
            (SELECT s.display_name FROM email_address_book_sources s WHERE s.link_id = c.link_id AND s.emails @> ARRAY[c.email_address::text]
                AND s.deleted_at IS NULL AND s.display_name IS NOT NULL ORDER BY s.folder_id,s.provider_id LIMIT 1) AS book_name,
            (SELECT s.photo_url FROM email_address_book_sources s WHERE s.link_id = c.link_id AND s.emails @> ARRAY[c.email_address::text]
                AND s.deleted_at IS NULL AND s.photo_url IS NOT NULL ORDER BY s.folder_id,s.provider_id LIMIT 1) AS book_photo,
            lower(c.email_address) = lower(l.email_address) AS "is_self!"
        FROM email_contacts c JOIN email_links l ON l.id = c.link_id LEFT JOIN email_contact_address_book_projection p ON p.contact_id = c.id
        WHERE c.link_id = $1 AND c.email_address = ANY($2) ORDER BY c.id FOR UPDATE OF c
    "#,link,emails).fetch_all(&mut **tx).await.map_err(db_error)?;
    let mut changed_names = Vec::new();
    let mut changed = false;
    let mut self_photo = false;
    for row in rows {
        let previous_name = if row.contact_id.is_none() || row.name != row.applied_name {
            row.name.clone()
        } else {
            row.previous_name
        };
        let previous_photo = if row.contact_id.is_none() || row.sfs_photo_url != row.applied_photo {
            row.sfs_photo_url.clone()
        } else {
            row.previous_photo
        };
        let name = row.book_name.or_else(|| previous_name.clone());
        let photo = row.book_photo.or_else(|| previous_photo.clone());
        if name != row.name {
            changed_names.push(row.id);
        }
        if row.is_self && photo != row.sfs_photo_url {
            self_photo = true;
        }
        if name != row.name || photo != row.sfs_photo_url {
            changed = true;
            sqlx::query!("UPDATE email_contacts SET name = $2,sfs_photo_url = $3,updated_at = now() WHERE id = $1",row.id,name,photo)
                .execute(&mut **tx).await.map_err(db_error)?;
        }
        sqlx::query!(r#"INSERT INTO email_contact_address_book_projection(contact_id,previous_name,applied_name,previous_photo,applied_photo)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT(contact_id) DO UPDATE SET previous_name = EXCLUDED.previous_name,applied_name = EXCLUDED.applied_name,
                previous_photo = EXCLUDED.previous_photo,applied_photo = EXCLUDED.applied_photo"#,row.id,previous_name,name,previous_photo,photo)
            .execute(&mut **tx).await.map_err(db_error)?;
    }
    if changed {
        let threads = sqlx::query_scalar!(
            r#"SELECT DISTINCT m.thread_id FROM email_messages m
            LEFT JOIN email_message_recipients r ON r.message_id = m.id
            WHERE m.link_id = $1 AND (m.from_contact_id = ANY($2) OR r.contact_id = ANY($2))"#,
            link,
            &changed_names
        )
        .fetch_all(&mut **tx)
        .await
        .map_err(db_error)?;
        let batches = if threads.is_empty() {
            vec![vec![]]
        } else {
            threads.chunks(50).map(<[Uuid]>::to_vec).collect()
        };
        for thread_ids in batches {
            let event = serde_json::to_value(ProjectionEvent::ContactsChanged {
                thread_ids,
                self_photo,
            })
            .map_err(|_| MailboxError::Persistence)?;
            sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),link,mailbox.sync_generation,event)
                .execute(&mut **tx).await.map_err(db_error)?;
        }
    }
    Ok(())
}
