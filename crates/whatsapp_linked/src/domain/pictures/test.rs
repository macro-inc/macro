use super::*;
use crate::domain::models::StagedPicture;
use async_trait::async_trait;
use external_chat::domain::{
    models::ExternalChatError,
    ports::{ExternalChatResult, FileImport},
};
use std::sync::Mutex;
use uuid::Uuid;

/// Staged pictures, and what the import answered for each.
#[derive(Default)]
struct Staged {
    due: Vec<StagedPicture>,
    /// `(jid, file_id)` stored; the jid named here has moved on meanwhile.
    stored: Mutex<Vec<(String, Uuid)>>,
    moved_on: Option<String>,
    failed: Mutex<Vec<String>>,
}

#[async_trait]
impl PictureRepository for Staged {
    async fn staged_pictures(&self, limit: i64) -> ExternalChatResult<Vec<StagedPicture>> {
        assert_eq!(limit, 8);
        Ok(self.due.clone())
    }

    async fn picture_stored(
        &self,
        _account: Uuid,
        jid: &str,
        _picture_id: &str,
        static_file_id: Uuid,
    ) -> ExternalChatResult<bool> {
        self.stored
            .lock()
            .unwrap()
            .push((jid.to_owned(), static_file_id));
        Ok(self.moved_on.as_deref() != Some(jid))
    }

    async fn picture_store_failed(
        &self,
        _account: Uuid,
        jid: &str,
        _picture_id: &str,
    ) -> ExternalChatResult<()> {
        self.failed.lock().unwrap().push(jid.to_owned());
        Ok(())
    }
}

/// Stores pictures as numbered files, refusing the bytes in `refuse`.
struct Files {
    refuse: Vec<u8>,
    owners: Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl FileStore for Files {
    async fn store(&self, _import: &FileImport, _bytes: Vec<u8>) -> ExternalChatResult<Uuid> {
        Err(ExternalChatError::Invalid("pictures never store attachments").into())
    }

    async fn store_picture(
        &self,
        owner: &str,
        mime: &str,
        bytes: Vec<u8>,
    ) -> ExternalChatResult<Uuid> {
        if bytes == self.refuse {
            return Err(ExternalChatError::Unavailable.into());
        }
        self.owners
            .lock()
            .unwrap()
            .push((owner.to_owned(), mime.to_owned()));
        Ok(Uuid::from_u128(u128::from(bytes[0])))
    }

    async fn delete(&self, _file_id: Uuid) -> ExternalChatResult<()> {
        Ok(())
    }
}

/// A phone-number JID; numbers are short so they read as synthetic.
fn phone(number: &str) -> String {
    format!("{number}@s.whatsapp.net")
}

/// A group JID.
fn group(id: u64) -> String {
    format!("{id}@g.us")
}

fn staged(jid: &str, byte: u8) -> StagedPicture {
    StagedPicture {
        account_id: Uuid::from_u128(1),
        user_id: "macro|owner@example.com".to_owned(),
        jid: jid.to_owned(),
        picture_id: format!("pic-{byte}"),
        bytes: vec![byte],
        mime: "image/jpeg".to_owned(),
    }
}

#[tokio::test]
async fn staged_pictures_become_the_owners_files_and_a_failure_retries_alone() {
    let repository = Arc::new(Staged {
        due: vec![
            staged(&phone("5550001"), 1),
            staged(&phone("5550002"), 2),
            staged(&group(120363000000000001), 3),
        ],
        moved_on: Some(group(120363000000000001)),
        ..Staged::default()
    });
    let files = Arc::new(Files {
        refuse: vec![2],
        owners: Mutex::new(vec![]),
    });

    let left_staging = PictureImports::new(repository.clone(), files.clone())
        .import_staged()
        .await
        .unwrap();

    // The group's row moved on while its file was stored; it left staging too.
    assert_eq!(left_staging, 2);
    assert_eq!(
        *repository.stored.lock().unwrap(),
        vec![
            (phone("5550001"), Uuid::from_u128(1)),
            (group(120363000000000001), Uuid::from_u128(3)),
        ]
    );
    assert_eq!(*repository.failed.lock().unwrap(), vec![phone("5550002")]);
    assert_eq!(
        *files.owners.lock().unwrap(),
        vec![
            (
                "macro|owner@example.com".to_owned(),
                "image/jpeg".to_owned()
            );
            2
        ]
    );
}
