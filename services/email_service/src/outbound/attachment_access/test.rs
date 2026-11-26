use super::*;
use email::domain::mailbox::MailboxKey;
use std::sync::Mutex;
use uuid::Uuid;

struct Download {
    provider: UserProvider,
    calls: Arc<Mutex<Vec<UserProvider>>>,
}

impl MailboxAttachmentAccess for Download {
    async fn download(
        &self,
        provider: UserProvider,
        mailbox: MailboxKey,
        message: &str,
        attachment: &str,
    ) -> Result<Vec<u8>, MailboxError> {
        assert_eq!(provider, self.provider);
        assert_eq!(mailbox.link_id, Uuid::from_u128(7));
        assert_eq!((message, attachment), ("message", "attachment"));
        self.calls.lock().unwrap().push(self.provider);
        Ok(vec![1, 2, 3])
    }
}

#[tokio::test]
async fn mixed_projection_downloads_use_the_links_provider_gateway() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let router = ProviderAttachmentBytes {
        s3: s3_client::S3::new(aws_sdk_s3::Client::from_conf(
            aws_sdk_s3::Config::builder()
                .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
                .region(aws_sdk_s3::config::Region::new("us-east-1"))
                .credentials_provider(aws_sdk_s3::config::Credentials::new(
                    "test", "test", None, None, "test",
                ))
                .endpoint_url("http://127.0.0.1:9")
                .build(),
        )),
        bucket: "unused".to_owned(),
        gmail: Download {
            provider: UserProvider::Gmail,
            calls: calls.clone(),
        },
        imap: Download {
            provider: UserProvider::Imap,
            calls: calls.clone(),
        },
        outlook: Download {
            provider: UserProvider::Outlook,
            calls: calls.clone(),
        },
    };
    for provider in [
        UserProvider::Outlook,
        UserProvider::Imap,
        UserProvider::Gmail,
    ] {
        let bytes = router
            .download(
                provider,
                MailboxKey {
                    link_id: Uuid::from_u128(7),
                    sync_generation: 1,
                    grant_generation: 1,
                },
                "message",
                "attachment",
            )
            .await
            .unwrap();
        assert_eq!(bytes, vec![1, 2, 3]);
    }
    assert_eq!(
        *calls.lock().unwrap(),
        [
            UserProvider::Outlook,
            UserProvider::Imap,
            UserProvider::Gmail
        ]
    );
}

#[test]
fn oversized_provider_content_preserves_its_permanent_content_limit() {
    let provider = crate::outbound::email_api::imap::error(
        imap_engine::domain::models::Error::MessageTooLarge,
    );
    assert!(!provider.is_transient());
    assert!(matches!(
        provider_error(provider),
        AttachmentError::ContentTooLarge
    ));
}
