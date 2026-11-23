//! Gmail and public HTTP reads for the signature image policy.
use crate::util::process_pre_insert::sfs_map::{ImageSource, PublicImages};
use email::domain::signature_settings::gmail_images::SignatureImageReader;
use email_api_client::domain::models::EmailApiError;
use email_api_client::domain::ports::{
    MailboxAttachmentClient, MailboxMessageClient, ProviderRequestGate, ProviderTokenSource,
};
use email_api_client::domain::service::EmailApiClientServiceImpl;
use models_email::email::service::message::Message;
use uuid::Uuid;

pub(super) struct GmailImageReader<'a, R, T, L>(&'a EmailApiClientServiceImpl<R, T, L>);
impl<'a, R, T, L> GmailImageReader<'a, R, T, L> {
    pub(super) fn new(api: &'a EmailApiClientServiceImpl<R, T, L>) -> Self {
        Self(api)
    }
}
impl<R, T, L> SignatureImageReader for GmailImageReader<'_, R, T, L>
where
    R: MailboxMessageClient + MailboxAttachmentClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    async fn public_image(&self, url: &str) -> anyhow::Result<Option<Vec<u8>>> {
        Ok(PublicImages.fetch(url).await?.map(|bytes| bytes.to_vec()))
    }
    async fn get_message(&self, link: Uuid, id: &str) -> Result<Option<Message>, EmailApiError> {
        Ok(self
            .0
            .get_message(link, id)
            .await?
            .map(|message| message.message))
    }
    async fn get_thread(&self, link: Uuid, id: &str) -> Result<Vec<Message>, EmailApiError> {
        Ok(self
            .0
            .get_thread(link, id)
            .await?
            .into_iter()
            .map(|message| message.message)
            .collect())
    }
    async fn get_attachment(
        &self,
        link: Uuid,
        message: &str,
        attachment: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        self.0.get_attachment(link, message, attachment).await
    }
}

#[cfg(test)]
mod test;
