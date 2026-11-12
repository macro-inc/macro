use super::*;
use email::domain::models::{EmailThreadPreview, PreviewCursorQuery};
use email::domain::ports::EmailRepo;
use email::outbound::EmailPgRepo;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service;
use models_email::service::attachment::AttachmentUploadMetadata;
use std::collections::{HashMap, HashSet};

impl InboxSyncHistoryFacts for PgInboxSync {
    async fn history_id(&self, address: &str) -> Result<Option<String>, Self::Err> {
        email_db_client::histories::fetch_history_id_for_link(
            &self.0,
            address,
            service::link::UserProvider::Gmail,
        )
        .await
        .map_err(Into::into)
    }
    async fn repair_history(&self, link: Uuid, history: &str) -> Result<(), Self::Err> {
        email_db_client::histories::upsert_gmail_history(&self.0, link, history)
            .await
            .map(|_| ())
            .map_err(Into::into)
    }
}
impl InboxSyncCatalog for PgInboxSync {
    async fn catalog(&self, link: Uuid) -> Result<Vec<service::label::Label>, Self::Err> {
        email_db_client::labels::get::fetch_labels_by_link_id(&self.0, link)
            .await
            .map_err(Into::into)
    }
    async fn delete_catalog(&self, link: Uuid, labels: Vec<String>) -> Result<u64, Self::Err> {
        email_db_client::labels::delete::delete_labels_by_provider_ids(&self.0, link, labels)
            .await
            .map_err(Into::into)
    }
    async fn upsert_catalog(&self, labels: Vec<service::label::Label>) -> Result<(), Self::Err> {
        email_db_client::labels::insert::insert_or_update_labels(&self.0, labels)
            .await
            .map_err(Into::into)
    }
}
impl InboxSyncMessageStore for PgInboxSync {
    async fn thread_ids(
        &self,
        link: Uuid,
        provider: &str,
    ) -> Result<HashMap<String, Uuid>, Self::Err> {
        email_db_client::threads::get::get_threads_by_link_id_and_provider_ids(
            &self.0,
            link,
            &HashSet::from([provider.to_owned()]),
        )
        .await
        .map_err(Into::into)
    }
    async fn insert_message(
        &self,
        link: Uuid,
        thread: Uuid,
        message: &mut service::message::Message,
        resync: Option<&InboxSyncResync>,
    ) -> Result<(), Self::Err> {
        let resync = resync.map(
            |snapshot| email_db_client::messages::insert::ResyncSnapshot {
                stored_labels: snapshot.stored_labels.clone(),
                pending_labels: snapshot.pending_labels.clone(),
            },
        );
        email_db_client::messages::insert::insert_message(
            &self.0,
            thread,
            message,
            link,
            true,
            resync.as_ref(),
        )
        .await
        .map_err(Into::into)
    }
    async fn insert_thread(
        &self,
        link: Uuid,
        thread: service::thread::Thread,
    ) -> Result<(), Self::Err> {
        email_db_client::threads::insert::insert_thread_and_messages(&self.0, thread, link)
            .await
            .map(|_| ())
            .map_err(Into::into)
    }
    async fn message_ids(&self, link: Uuid, provider: &str) -> Result<(Uuid, Uuid), Self::Err> {
        email_db_client::messages::get::get_message_and_thread_id_by_provider_id(
            &self.0, link, provider,
        )
        .await
        .map_err(Into::into)
    }
}
impl InboxSyncAttachmentStore for PgInboxSync {
    async fn document_attachments(
        &self,
        link: Uuid,
        provider: &str,
    ) -> Result<Vec<AttachmentUploadMetadata>, Self::Err> {
        email_db_client::attachments::provider::upload::new_email_document_atts(
            &self.0, link, provider,
        )
        .await
        .map_err(Into::into)
    }
    async fn media_attachments(
        &self,
        link: Uuid,
        provider: &str,
    ) -> Result<Vec<AttachmentUploadMetadata>, Self::Err> {
        email_db_client::attachments::provider::upload::new_email_media_atts(
            &self.0, link, provider,
        )
        .await
        .map_err(Into::into)
    }
    async fn attachment_recipients(
        &self,
        messages: &[Uuid],
    ) -> Result<InboxSyncAttachmentRecipients, Self::Err> {
        email_db_client::contacts::get::fetch_db_recipients_in_bulk(&self.0, messages)
            .await
            .map_err(Into::into)
    }
    async fn release_attachment(&self, attachment: Uuid) -> Result<(), Self::Err> {
        email_db_client::attachments::provider::upload::release_upload_claim(&self.0, attachment)
            .await
            .map_err(Into::into)
    }
}
impl InboxSyncNotificationFacts for PgInboxSync {
    async fn sender_contacts(
        &self,
        messages: &[Uuid],
    ) -> Result<HashMap<Uuid, service::address::ContactInfo>, Self::Err> {
        email_db_client::contacts::get::fetch_sender_contact_info(&self.0, messages)
            .await
            .map_err(Into::into)
    }
    async fn primaries(&self, owner: &str, link: Uuid) -> Result<Vec<String>, Self::Err> {
        macro_db_client::macro_user_links::get_primaries_for_link(&self.0, owner, link)
            .await
            .map_err(Into::into)
    }
    async fn previews(
        &self,
        query: PreviewCursorQuery,
        owner: MacroUserIdStr<'static>,
    ) -> Result<Vec<EmailThreadPreview>, Self::Err> {
        EmailPgRepo::new(self.0.clone())
            .previews_for_view_cursor(query, owner)
            .await
            .map_err(anyhow::Error::from)
            .map_err(Into::into)
    }
}
