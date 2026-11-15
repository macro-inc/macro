use super::*;
use std::sync::{Arc, Mutex};

const LINK: Uuid = Uuid::from_u128(1);
const ADDRESS: &str = "inbox@example.com";

#[derive(Debug, thiserror::Error)]
#[error("test failure")]
struct TestError;

#[derive(Clone, Debug)]
enum Call {
    Token(Uuid),
    Aliases,
    Images(String),
    PublicImage(String),
    Write(SettingsPatch),
}

#[derive(Clone, Default)]
struct Fake {
    aliases: Vec<(&'static str, Option<&'static str>, bool)>,
    image_result: Option<(String, usize)>,
    fail: Option<&'static str>,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl SettingsWriter for Fake {
    type Err = TestError;
    async fn patch(&self, patch: SettingsPatch) -> Result<Settings, TestError> {
        self.calls.lock().unwrap().push(Call::Write(patch.clone()));
        if self.fail == Some("write") {
            return Err(TestError);
        }
        Ok(Settings {
            link_id: patch.link_id,
            signature: patch.signature,
            signature_on_replies_forwards: patch.signature_on_replies_forwards.unwrap_or(false),
            read_receipts_enabled: patch.read_receipts_enabled.unwrap_or(false),
        })
    }
}
impl SignatureImages for Fake {
    type Err = TestError;
    async fn rehost(
        &self,
        html: &str,
        source: &impl SignatureImageSource,
    ) -> Result<(String, usize), TestError> {
        self.calls.lock().unwrap().push(Call::Images(html.into()));
        if self.fail == Some("public_image") {
            assert_eq!(
                source
                    .fetch("https://mail.google.com/mail/u/0?permmsgid=msg-f:1&realattid=logo")
                    .await
                    .unwrap(),
                Some(vec![1])
            );
            return Ok((html.into(), 0));
        }
        if matches!(
            self.fail,
            Some(
                "mailbox_images"
                    | "mailbox_images_zero"
                    | "mailbox_images_error"
                    | "mailbox_missing"
            )
        ) {
            let _ = source
                .fetch("https://mail.google.com/mail/u/0?permmsgid=msg-f:1&realattid=logo")
                .await;
            if self.fail == Some("mailbox_images_error") {
                return Err(TestError);
            }
            return Ok((
                html.into(),
                usize::from(self.fail != Some("mailbox_images_zero")),
            ));
        }
        if self.fail == Some("images") {
            return Err(TestError);
        }
        Ok(self
            .image_result
            .clone()
            .unwrap_or_else(|| (html.into(), 0)))
    }
}
impl SignatureProvider for Fake {
    fn image_reader(&self) -> impl SignatureImageReader + '_ {
        self.clone()
    }
    type TokenErr = TestError;
    type ReadErr = TestError;
    async fn fresh_token(&self, link: Uuid) -> Result<AccessToken, TestError> {
        self.calls.lock().unwrap().push(Call::Token(link));
        if self.fail == Some("token") {
            return Err(TestError);
        }
        Ok(AccessToken::new("test-token"))
    }
    async fn aliases(&self, _: &AccessToken) -> Result<Vec<SignatureAlias>, TestError> {
        self.calls.lock().unwrap().push(Call::Aliases);
        if self.fail == Some("aliases") {
            return Err(TestError);
        }
        Ok(self
            .aliases
            .iter()
            .map(|(email, signature, primary)| SignatureAlias {
                email: (*email).into(),
                signature: signature.map(str::to_string),
                primary: *primary,
            })
            .collect())
    }
}

fn service(fake: &Fake) -> SignatureSettingsService<Fake, Fake, Fake> {
    SignatureSettingsService {
        writer: fake.clone(),
        images: fake.clone(),
        provider: fake.clone(),
    }
}

fn patch(signature: Option<&str>) -> SettingsPatch {
    SettingsPatch {
        link_id: LINK,
        signature: signature.map(str::to_string),
        signature_on_replies_forwards: Some(true),
        read_receipts_enabled: Some(false),
    }
}

#[tokio::test]
async fn patch_sanitizes_before_rehosting_and_preserves_other_fields() {
    let fake = Fake {
        image_result: Some(("<b>rehosted</b>".into(), 0)),
        ..Default::default()
    };
    let output = service(&fake)
        .patch(patch(Some(
            "<b onclick='bad()'>signature</b><script>bad()</script>",
        )))
        .await
        .unwrap();
    assert_eq!(output.signature.as_deref(), Some("<b>rehosted</b>"));
    assert!(output.signature_on_replies_forwards);
    assert!(!output.read_receipts_enabled);
    let calls = fake.calls.lock().unwrap();
    let [Call::Images(html), Call::Write(written)] = calls.as_slice() else {
        panic!("unexpected calls: {calls:?}")
    };
    assert_eq!(html, "<b>signature</b>");
    assert_eq!(written.link_id, LINK);
    assert_eq!(written.read_receipts_enabled, Some(false));
}

#[tokio::test]
async fn omitted_signature_skips_rehosting_but_empty_signature_clears() {
    for signature in [None, Some("")] {
        let fake = Fake::default();
        let output = service(&fake).patch(patch(signature)).await.unwrap();
        assert_eq!(output.signature.as_deref(), signature);
        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), if signature.is_some() { 2 } else { 1 });
        assert!(matches!(calls.last(), Some(Call::Write(_))));
    }
}

#[tokio::test]
async fn unresolved_images_reject_every_settings_field() {
    let fake = Fake {
        image_result: Some(("partial".into(), 2)),
        ..Default::default()
    };
    assert!(matches!(
        service(&fake).patch(patch(Some("signature"))).await,
        Err(SettingsPatchError::UnresolvedImages(2))
    ));
    assert_eq!(fake.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn image_errors_preserve_the_sanitized_patch() {
    let fake = Fake {
        fail: Some("images"),
        ..Default::default()
    };
    let output = service(&fake)
        .patch(patch(Some("<b onclick='bad()'>signature</b>")))
        .await
        .unwrap();
    assert_eq!(output.signature.as_deref(), Some("<b>signature</b>"));
    assert!(matches!(
        fake.calls.lock().unwrap().last(),
        Some(Call::Write(_))
    ));
}

#[tokio::test]
async fn patch_preserves_write_failure() {
    let fake = Fake {
        fail: Some("write"),
        ..Default::default()
    };
    assert!(matches!(
        service(&fake).patch(patch(None)).await,
        Err(SettingsPatchError::Database(TestError))
    ));
}

#[tokio::test]
async fn import_prefers_first_own_alias_case_insensitively_over_primary() {
    let fake = Fake {
        aliases: vec![
            ("primary@example.com", Some("primary"), true),
            ("INBOX@EXAMPLE.COM", Some("own"), false),
            (ADDRESS, Some("later own"), false),
        ],
        ..Default::default()
    };
    let output = service(&fake).import(LINK, ADDRESS).await.unwrap();
    assert_eq!(output.signature.as_deref(), Some("own"));
    let calls = fake.calls.lock().unwrap();
    let [
        Call::Token(id),
        Call::Aliases,
        Call::Images(html),
        Call::Write(written),
    ] = calls.as_slice()
    else {
        panic!("unexpected calls: {calls:?}")
    };
    assert_eq!(*id, LINK);
    assert_eq!(html, "own");
    assert_eq!(written.signature_on_replies_forwards, None);
    assert_eq!(written.read_receipts_enabled, None);
}

#[tokio::test]
async fn import_falls_back_to_first_primary_only_when_own_alias_is_absent() {
    let fake = Fake {
        aliases: vec![
            ("other@example.com", Some("other"), false),
            ("primary@example.com", Some("primary"), true),
            ("later@example.com", Some("later"), true),
        ],
        ..Default::default()
    };
    assert_eq!(
        service(&fake)
            .import(LINK, ADDRESS)
            .await
            .unwrap()
            .signature
            .as_deref(),
        Some("primary")
    );
}

#[tokio::test]
async fn empty_own_signature_blocks_primary_fallback() {
    for signature in [None, Some(""), Some(" \t\n")] {
        let fake = Fake {
            aliases: vec![
                (ADDRESS, signature, false),
                ("primary@example.com", Some("primary"), true),
            ],
            ..Default::default()
        };
        assert!(matches!(
            service(&fake).import(LINK, ADDRESS).await,
            Err(SignatureImportError::NoSignature)
        ));
        assert_eq!(fake.calls.lock().unwrap().len(), 2);
    }
}

#[tokio::test]
async fn import_requires_a_nonempty_signature_on_a_selected_alias() {
    for aliases in [
        vec![],
        vec![("other@example.com", Some("other"), false)],
        vec![("primary@example.com", None, true)],
        vec![("primary@example.com", Some(" "), true)],
    ] {
        let fake = Fake {
            aliases,
            ..Default::default()
        };
        assert!(matches!(
            service(&fake).import(LINK, ADDRESS).await,
            Err(SignatureImportError::NoSignature)
        ));
        assert_eq!(fake.calls.lock().unwrap().len(), 2);
    }
}

#[tokio::test]
async fn imported_signature_is_sanitized_before_image_rehosting() {
    let fake = Fake {
        aliases: vec![(
            ADDRESS,
            Some("<b onclick='bad()'>signature</b><script>bad()</script>"),
            false,
        )],
        image_result: Some(("rehosted".into(), 0)),
        ..Default::default()
    };
    assert_eq!(
        service(&fake)
            .import(LINK, ADDRESS)
            .await
            .unwrap()
            .signature
            .as_deref(),
        Some("rehosted")
    );
    let calls = fake.calls.lock().unwrap();
    let Some(Call::Images(html)) = calls.get(2) else {
        panic!("missing rehost")
    };
    assert_eq!(html, "<b>signature</b>");
}

#[tokio::test]
async fn import_rejects_unresolved_images_without_writing() {
    let fake = Fake {
        aliases: vec![(ADDRESS, Some("signature"), false)],
        image_result: Some(("partial".into(), 1)),
        ..Default::default()
    };
    assert!(matches!(
        service(&fake).import(LINK, ADDRESS).await,
        Err(SignatureImportError::UnresolvedImages(1))
    ));
    assert_eq!(fake.calls.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn import_image_errors_save_the_sanitized_signature() {
    let fake = Fake {
        aliases: vec![(ADDRESS, Some("<b onclick='bad()'>signature</b>"), false)],
        fail: Some("images"),
        ..Default::default()
    };
    assert_eq!(
        service(&fake)
            .import(LINK, ADDRESS)
            .await
            .unwrap()
            .signature
            .as_deref(),
        Some("<b>signature</b>")
    );
    assert!(matches!(
        fake.calls.lock().unwrap().last(),
        Some(Call::Write(_))
    ));
}

#[tokio::test]
async fn import_stops_at_and_preserves_each_effect_failure() {
    for fail in ["token", "aliases", "write"] {
        let fake = Fake {
            aliases: vec![(ADDRESS, Some("signature"), false)],
            fail: Some(fail),
            ..Default::default()
        };
        let result = service(&fake).import(LINK, ADDRESS).await;
        match fail {
            "token" => {
                assert!(matches!(
                    result,
                    Err(SignatureImportError::Token(TestError))
                ));
                assert_eq!(fake.calls.lock().unwrap().len(), 1);
            }
            "aliases" => {
                assert!(matches!(
                    result,
                    Err(SignatureImportError::Provider(TestError))
                ));
                assert_eq!(fake.calls.lock().unwrap().len(), 2);
            }
            _ => {
                assert!(matches!(
                    result,
                    Err(SignatureImportError::Database(TestError))
                ));
                assert_eq!(fake.calls.lock().unwrap().len(), 4);
            }
        }
    }
}

impl SignatureImageReader for Fake {
    async fn public_image(&self, url: &str) -> anyhow::Result<Option<Vec<u8>>> {
        assert_eq!(self.fail, Some("public_image"));
        self.calls
            .lock()
            .unwrap()
            .push(Call::PublicImage(url.into()));
        Ok(Some(vec![1]))
    }
    async fn get_message(
        &self,
        _: Uuid,
        _: &str,
    ) -> Result<Option<models_email::email::service::message::Message>, EmailApiError> {
        if self.fail == Some("mailbox_missing") {
            return Ok(None);
        }
        Err(EmailApiError::RateLimited {
            retry_after: Some(std::time::Duration::from_secs(60)),
            origin: email_api_client::domain::models::RateLimitOrigin::Provider {
                concurrency: false,
            },
        })
    }
    async fn get_thread(
        &self,
        _: Uuid,
        _: &str,
    ) -> Result<Vec<models_email::email::service::message::Message>, EmailApiError> {
        panic!("unexpected thread read")
    }
    async fn get_attachment(&self, _: Uuid, _: &str, _: &str) -> Result<Vec<u8>, EmailApiError> {
        panic!("unexpected attachment read")
    }
}

#[tokio::test]
async fn retryable_mailbox_failure_rejects_unresolved_import_without_a_write() {
    let fake = Fake {
        aliases: vec![(ADDRESS, Some("signature"), false)],
        fail: Some("mailbox_images"),
        ..Default::default()
    };
    let error = service(&fake).import(LINK, ADDRESS).await.unwrap_err();
    assert_eq!(
        error.to_string(),
        "Failed to read signature images from Gmail"
    );
    assert!(matches!(
        error,
        SignatureImportError::MailboxImagesUnavailable(EmailApiError::RateLimited { .. })
    ));
    assert_eq!(fake.calls.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn missing_mailbox_image_is_unresolved_not_retryable() {
    let fake = Fake {
        aliases: vec![(ADDRESS, Some("signature"), false)],
        fail: Some("mailbox_missing"),
        ..Default::default()
    };
    assert!(matches!(
        service(&fake).import(LINK, ADDRESS).await,
        Err(SignatureImportError::UnresolvedImages(1))
    ));
    assert_eq!(fake.calls.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn mailbox_failure_is_ignored_when_rehost_reports_no_unresolved_images() {
    let fake = Fake {
        aliases: vec![(ADDRESS, Some("signature"), false)],
        fail: Some("mailbox_images_zero"),
        ..Default::default()
    };
    assert_eq!(
        service(&fake)
            .import(LINK, ADDRESS)
            .await
            .unwrap()
            .signature
            .as_deref(),
        Some("signature")
    );
    assert!(matches!(
        fake.calls.lock().unwrap().last(),
        Some(Call::Write(_))
    ));
}

#[tokio::test]
async fn top_level_rehost_error_still_imports_after_a_retryable_mailbox_failure() {
    let fake = Fake {
        aliases: vec![(ADDRESS, Some("signature"), false)],
        fail: Some("mailbox_images_error"),
        ..Default::default()
    };
    assert_eq!(
        service(&fake)
            .import(LINK, ADDRESS)
            .await
            .unwrap()
            .signature
            .as_deref(),
        Some("signature")
    );
    assert!(matches!(
        fake.calls.lock().unwrap().last(),
        Some(Call::Write(_))
    ));
}

#[tokio::test]
async fn patch_uses_public_reads_even_for_a_mailbox_image_url() {
    let fake = Fake {
        fail: Some("public_image"),
        ..Default::default()
    };
    service(&fake)
        .patch(patch(Some("signature")))
        .await
        .unwrap();
    let calls = fake.calls.lock().unwrap();
    let [Call::Images(_), Call::PublicImage(url), Call::Write(_)] = calls.as_slice() else {
        panic!("unexpected calls: {calls:?}")
    };
    assert_eq!(
        url,
        "https://mail.google.com/mail/u/0?permmsgid=msg-f:1&realattid=logo"
    );
}
