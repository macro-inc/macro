//! Independent address-book synchronization. Missing optional contact consent
//! must never stop mail delivery, and only a completed scan can retire records.

use super::*;
use email_api_client::domain::models::{
    AddressBookContact, AddressBookPage, ContactFolderCatalog, ContactPhoto,
};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressBookWorkKind {
    Catalog,
    Profile,
    Folder,
}

pub struct AddressBookWork {
    pub stream: StreamLease,
    pub kind: AddressBookWorkKind,
    pub scan_id: Uuid,
}

pub struct ContactPhotoLease {
    pub mailbox: MailboxKey,
    /// None represents the mailbox owner's profile.
    pub folder: Option<ProviderId>,
    pub contact: ProviderId,
    pub revision: i64,
    pub lease_id: Uuid,
    pub photo_hash: Option<String>,
    pub photo_url: Option<String>,
}

pub trait AddressBookRepository: Send + Sync + 'static {
    fn claim(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<AddressBookWork>, MailboxError>> + Send;
    fn renew(
        &self,
        work: &AddressBookWork,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn commit_catalog(
        &self,
        work: &AddressBookWork,
        catalog: &ContactFolderCatalog,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn commit_profile(
        &self,
        work: &AddressBookWork,
        profile: &AddressBookContact,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn commit_page(
        &self,
        work: &AddressBookWork,
        page: &AddressBookPage,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn reset(
        &self,
        work: &AddressBookWork,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn retire_folder(
        &self,
        work: &AddressBookWork,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release(
        &self,
        work: &AddressBookWork,
        delay: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_photo(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<ContactPhotoLease>, MailboxError>> + Send;
    fn renew_photo(
        &self,
        lease: &ContactPhotoLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn commit_photo(
        &self,
        lease: &ContactPhotoLease,
        hash: Option<&str>,
        url: Option<&str>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_photo(
        &self,
        lease: &ContactPhotoLease,
        delay: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub trait AddressBookGateway: Send + Sync + 'static {
    fn folders(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<ContactFolderCatalog, EmailApiError>> + Send;
    fn profile(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<AddressBookContact, EmailApiError>> + Send;
    fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> impl Future<Output = Result<AddressBookPage, EmailApiError>> + Send;
    fn photo(
        &self,
        mailbox: MailboxKey,
        contact: Option<(&ProviderId, &ProviderId)>,
    ) -> impl Future<Output = Result<Option<ContactPhoto>, EmailApiError>> + Send;
}

pub trait ContactPhotoStorage: Send + Sync + 'static {
    fn store(
        &self,
        mailbox: MailboxKey,
        hash: &str,
        photo: ContactPhoto,
    ) -> impl Future<Output = Result<String, MailboxError>> + Send;
}

pub struct AddressBookService<R, G, S> {
    repository: R,
    gateway: G,
    storage: S,
}
impl<R, G, S> AddressBookService<R, G, S> {
    pub fn new(repository: R, gateway: G, storage: S) -> Self {
        Self {
            repository,
            gateway,
            storage,
        }
    }
}
impl<R: AddressBookRepository, G: AddressBookGateway, S: ContactPhotoStorage>
    AddressBookService<R, G, S>
{
    pub async fn sync_once(&self) -> Result<bool, MailboxError> {
        let Some(work) = self
            .repository
            .claim(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let result = maintain_lease(self.sync(&work), || self.repository.renew(&work)).await;
        match result {
            Err(MailboxError::Provider(EmailApiError::OutdatedCursor))
                if work.kind == AddressBookWorkKind::Folder =>
            {
                self.repository.reset(&work).await?
            }
            Err(MailboxError::Provider(EmailApiError::NotFound))
                if work.kind == AddressBookWorkKind::Folder =>
            {
                self.repository.retire_folder(&work).await?
            }
            Err(MailboxError::Provider(error)) => {
                // Consent/policy failures are confined to this capability.
                self.repository
                    .release(&work, retry_seconds(&error).max(60))
                    .await?;
                return Err(error.into());
            }
            Err(error) => return Err(error),
            Ok(()) => {}
        }
        Ok(true)
    }
    async fn sync(&self, work: &AddressBookWork) -> Result<(), MailboxError> {
        match work.kind {
            AddressBookWorkKind::Catalog => {
                self.repository
                    .commit_catalog(work, &self.gateway.folders(work.stream.mailbox).await?)
                    .await
            }
            AddressBookWorkKind::Profile => {
                self.repository
                    .commit_profile(work, &self.gateway.profile(work.stream.mailbox).await?)
                    .await
            }
            AddressBookWorkKind::Folder => {
                self.repository
                    .commit_page(
                        work,
                        &self
                            .gateway
                            .changes(
                                work.stream.mailbox,
                                &work.stream.folder,
                                work.stream.position.as_ref(),
                            )
                            .await?,
                    )
                    .await
            }
        }
    }
    pub async fn photo_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repository
            .claim_photo(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let operation = async {
            let photo = self
                .gateway
                .photo(
                    lease.mailbox,
                    lease.folder.as_ref().map(|folder| (folder, &lease.contact)),
                )
                .await?;
            let Some(photo) = photo else {
                return self.repository.commit_photo(&lease, None, None).await;
            };
            let hash = format!("{:x}", Sha256::digest(&photo.bytes));
            let url = if lease.photo_hash.as_deref() == Some(&hash)
                && let Some(url) = &lease.photo_url
            {
                url.clone()
            } else {
                self.storage.store(lease.mailbox, &hash, photo).await?
            };
            self.repository
                .commit_photo(&lease, Some(&hash), Some(&url))
                .await
        };
        let result = maintain_lease(operation, || self.repository.renew_photo(&lease)).await;
        if let Err(error) = &result {
            let delay = match error {
                MailboxError::Provider(error) => retry_seconds(error).max(60),
                _ => 60,
            };
            self.repository.release_photo(&lease, delay).await?;
        }
        result.map(|()| true)
    }
}
