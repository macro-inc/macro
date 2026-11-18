use super::*;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::UserProvider;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;

const LINK: Uuid = Uuid::from_u128(10);
const CONTACT: Uuid = Uuid::from_u128(20);
const SOURCE: &str = "https://example.com/photo#original";
const UPLOADED_SOURCE: &str = "https://example.com/photo#returned";
const DESTINATION: &str = "https://example.com/stored-photo";

#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    Find(String),
    Upload(String),
    Insert(String, String),
    Upsert,
    Link(Uuid),
    Notify(String, Uuid),
}

struct State {
    calls: Vec<Call>,
    contacts: Vec<Contact>,
    fault: Option<&'static str>,
    mapping: Option<String>,
    uploaded: Option<(String, String)>,
    link: Option<Link>,
}

#[derive(Clone)]
struct Fake(Arc<Mutex<State>>);

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct Failure(&'static str);

impl Fake {
    fn call(&self, name: &'static str, call: Call) -> anyhow::Result<()> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        if state.fault == Some(name) {
            return Err(anyhow::Error::new(Failure(name)));
        }
        Ok(())
    }
}

impl SfsPhotoMappings for Fake {
    async fn find(&self, source: &str) -> anyhow::Result<Option<String>> {
        self.call("find", Call::Find(source.into()))?;
        Ok(self.0.lock().unwrap().mapping.clone())
    }

    async fn insert(&self, source: String, destination: String) -> anyhow::Result<()> {
        self.call("insert", Call::Insert(source, destination))
    }
}

impl SfsPhotoContacts for Fake {
    async fn upsert(&self, contact: Contact) -> anyhow::Result<()> {
        self.0.lock().unwrap().contacts.push(contact);
        self.call("upsert", Call::Upsert)
    }

    async fn link(&self, link_id: Uuid) -> anyhow::Result<Option<Link>> {
        self.call("link", Call::Link(link_id))?;
        Ok(self.0.lock().unwrap().link.clone())
    }
}

impl SfsPhotoUploader for Fake {
    async fn fetch_and_upload(&self, source: &str) -> anyhow::Result<Option<(String, String)>> {
        self.call("upload", Call::Upload(source.into()))?;
        Ok(self.0.lock().unwrap().uploaded.clone())
    }
}

impl PhotoSyncedNotifier for Fake {
    async fn photo_synced(&self, macro_id: &str, link_id: Uuid) {
        self.0
            .lock()
            .unwrap()
            .calls
            .push(Call::Notify(macro_id.into(), link_id));
    }
}

fn setup() -> (SfsPhotoUploadService<Fake, Fake, Fake, Fake>, Fake) {
    let fake = Fake(Arc::new(Mutex::new(State {
        calls: Vec::new(),
        contacts: Vec::new(),
        fault: None,
        mapping: None,
        uploaded: Some((UPLOADED_SOURCE.into(), DESTINATION.into())),
        link: Some(Link {
            id: LINK,
            macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
            fusionauth_user_id: "owner".into(),
            email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
            provider: UserProvider::Gmail,
            is_sync_active: true,
            is_primary: true,
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: Default::default(),
            updated_at: Default::default(),
        }),
    })));
    (
        SfsPhotoUploadService {
            mappings: fake.clone(),
            contacts: fake.clone(),
            uploader: fake.clone(),
            notifier: fake.clone(),
        },
        fake,
    )
}

fn contact() -> Contact {
    Contact {
        id: CONTACT,
        link_id: LINK,
        name: Some("Contact".into()),
        email_address: Some("owner@example.com".into()),
        original_photo_url: Some(SOURCE.into()),
        sfs_photo_url: Some("https://example.com/old-photo".into()),
    }
}

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn subscriber(output: &Output) -> impl tracing::Subscriber + Send + Sync + 'static {
    let output = output.clone();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .without_time()
        .with_ansi(false)
        .with_target(false)
        .with_writer(move || output.clone())
        .finish()
}

fn debug_lines(output: &Output) -> Vec<String> {
    String::from_utf8(output.0.lock().unwrap().clone())
        .unwrap()
        .lines()
        .filter(|line| line.starts_with("DEBUG "))
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn malformed_body_retains_its_original_error_without_effects() {
    let (service, fake) = setup();
    let output = Output::default();
    let SfsPhotoUploadDisposition::LeaveForRedelivery(error) = service
        .process(Err(
            anyhow::Error::new(Failure("decode")).context("original context")
        ))
        .with_subscriber(subscriber(&output))
        .await
    else {
        panic!("invalid bodies must remain available for redelivery");
    };
    assert_eq!(error.downcast_ref::<Failure>().unwrap().0, "decode");
    assert_eq!(format!("{error:#}"), "original context: decode");
    assert!(fake.0.lock().unwrap().calls.is_empty());
    assert!(output.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_photo_fails_before_mapping_lookup() {
    let (service, fake) = setup();
    let mut data = contact();
    data.original_photo_url = None;
    let SfsPhotoUploadDisposition::LeaveForRedelivery(error) = service.process(Ok(data)).await
    else {
        panic!("missing photo must retain the delivery");
    };
    assert_eq!(error.to_string(), "Contact has no photo URL");
    assert!(fake.0.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn present_empty_photo_still_reaches_mapping_lookup_and_upload() {
    let (service, fake) = setup();
    let mut data = contact();
    data.original_photo_url = Some(String::new());
    fake.0.lock().unwrap().uploaded = None;
    let SfsPhotoUploadDisposition::LeaveForRedelivery(error) = service.process(Ok(data)).await
    else {
        panic!("unsupported URL must retain the delivery");
    };
    assert_eq!(error.to_string(), "URL not uploaded to SFS");
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [Call::Find(String::new()), Call::Upload(String::new())]
    );
}

#[tokio::test]
async fn cached_destinations_including_empty_are_used_without_upload() {
    for destination in ["", DESTINATION] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().mapping = Some(destination.into());
        let output = Output::default();
        assert!(matches!(
            service
                .process(Ok(contact()))
                .with_subscriber(subscriber(&output))
                .await,
            SfsPhotoUploadDisposition::Delete
        ));
        let state = fake.0.lock().unwrap();
        assert_eq!(
            state.calls,
            [
                Call::Find(SOURCE.into()),
                Call::Upsert,
                Call::Link(LINK),
                Call::Notify("macro|owner@example.com".into(), LINK)
            ]
        );
        let saved = &state.contacts[0];
        assert_eq!(saved.id, CONTACT);
        assert_eq!(saved.link_id, LINK);
        assert_eq!(saved.name.as_deref(), Some("Contact"));
        assert_eq!(saved.email_address.as_deref(), Some("owner@example.com"));
        assert_eq!(saved.original_photo_url.as_deref(), Some(SOURCE));
        assert_eq!(saved.sfs_photo_url.as_deref(), Some(destination));
        assert!(debug_lines(&output).is_empty());
    }
}

#[tokio::test]
async fn fresh_upload_and_failed_mapping_read_preserve_order_and_all_debug_fields() {
    for fault in [None, Some("find")] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().fault = fault;
        let output = Output::default();
        assert!(matches!(
            service
                .process(Ok(contact()))
                .with_subscriber(subscriber(&output))
                .await,
            SfsPhotoUploadDisposition::Delete
        ));
        let state = fake.0.lock().unwrap();
        assert_eq!(
            state.calls,
            [
                Call::Find(SOURCE.into()),
                Call::Upload(SOURCE.into()),
                Call::Insert(UPLOADED_SOURCE.into(), DESTINATION.into()),
                Call::Upsert,
                Call::Link(LINK),
                Call::Notify("macro|owner@example.com".into(), LINK)
            ]
        );
        assert_eq!(
            state.contacts[0].original_photo_url.as_deref(),
            Some(SOURCE)
        );
        assert_eq!(
            state.contacts[0].sfs_photo_url.as_deref(),
            Some(DESTINATION)
        );
        assert_eq!(
            debug_lines(&output),
            [
                format!("DEBUG Uploading photo to SFS url={SOURCE:?}"),
                format!(
                    "DEBUG Successfully uploaded to SFS old_url={UPLOADED_SOURCE:?} new_url={DESTINATION:?}"
                ),
                "DEBUG Successfully inserted SFS mapping".into(),
            ]
        );
    }
}

#[tokio::test]
async fn upload_error_is_replaced_and_unsupported_url_keeps_its_distinct_error() {
    for fails in [false, true] {
        let (service, fake) = setup();
        {
            let mut state = fake.0.lock().unwrap();
            state.uploaded = None;
            if fails {
                state.fault = Some("upload");
            }
        }
        let output = Output::default();
        let SfsPhotoUploadDisposition::LeaveForRedelivery(error) = service
            .process(Ok(contact()))
            .with_subscriber(subscriber(&output))
            .await
        else {
            panic!("upload failure must retain the delivery");
        };
        assert_eq!(
            error.to_string(),
            if fails {
                "Unable to fetch and upload file to SFS"
            } else {
                "URL not uploaded to SFS"
            }
        );
        assert!(error.downcast_ref::<Failure>().is_none());
        assert_eq!(
            fake.0.lock().unwrap().calls,
            [Call::Find(SOURCE.into()), Call::Upload(SOURCE.into())]
        );
        assert_eq!(
            debug_lines(&output),
            [format!("DEBUG Uploading photo to SFS url={SOURCE:?}")]
        );
    }
}

#[tokio::test]
async fn failed_mapping_insert_still_upserts_refreshes_and_deletes() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().fault = Some("insert");
    let output = Output::default();
    assert!(matches!(
        service
            .process(Ok(contact()))
            .with_subscriber(subscriber(&output))
            .await,
        SfsPhotoUploadDisposition::Delete
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            Call::Find(SOURCE.into()),
            Call::Upload(SOURCE.into()),
            Call::Insert(UPLOADED_SOURCE.into(), DESTINATION.into()),
            Call::Upsert,
            Call::Link(LINK),
            Call::Notify("macro|owner@example.com".into(), LINK)
        ]
    );
    assert_eq!(
        debug_lines(&output),
        [
            format!("DEBUG Uploading photo to SFS url={SOURCE:?}"),
            format!(
                "DEBUG Successfully uploaded to SFS old_url={UPLOADED_SOURCE:?} new_url={DESTINATION:?}"
            )
        ]
    );
}

#[tokio::test]
async fn failed_contact_write_deletes_without_reading_the_link() {
    let (service, fake) = setup();
    {
        let mut state = fake.0.lock().unwrap();
        state.mapping = Some(DESTINATION.into());
        state.fault = Some("upsert");
    }
    assert!(matches!(
        service.process(Ok(contact())).await,
        SfsPhotoUploadDisposition::Delete
    ));
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [Call::Find(SOURCE.into()), Call::Upsert]
    );
}

#[tokio::test]
async fn absent_email_skips_link_lookup_but_other_nonmatching_values_do_not() {
    for email in [
        None,
        Some(String::new()),
        Some("sender@example.com".into()),
        Some(" owner@example.com ".into()),
        Some("a".repeat(320)),
    ] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().mapping = Some(DESTINATION.into());
        let mut data = contact();
        data.email_address = email.clone();
        assert!(matches!(
            service.process(Ok(data)).await,
            SfsPhotoUploadDisposition::Delete
        ));
        let mut expected = vec![Call::Find(SOURCE.into()), Call::Upsert];
        if email.is_some() {
            expected.push(Call::Link(LINK));
        }
        assert_eq!(fake.0.lock().unwrap().calls, expected);
    }
}

#[tokio::test]
async fn self_contact_matches_ascii_case_without_trimming() {
    for email in ["owner@example.com", "OWNER@EXAMPLE.COM"] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().mapping = Some(DESTINATION.into());
        let mut data = contact();
        data.email_address = Some(email.into());
        assert!(matches!(
            service.process(Ok(data)).await,
            SfsPhotoUploadDisposition::Delete
        ));
        assert_eq!(
            fake.0.lock().unwrap().calls,
            [
                Call::Find(SOURCE.into()),
                Call::Upsert,
                Call::Link(LINK),
                Call::Notify("macro|owner@example.com".into(), LINK)
            ]
        );
    }
}

#[tokio::test]
async fn missing_or_failed_link_read_deletes_without_refreshing() {
    for fails in [false, true] {
        let (service, fake) = setup();
        {
            let mut state = fake.0.lock().unwrap();
            state.mapping = Some(DESTINATION.into());
            state.link = None;
            if fails {
                state.fault = Some("link");
            }
        }
        assert!(matches!(
            service.process(Ok(contact())).await,
            SfsPhotoUploadDisposition::Delete
        ));
        assert_eq!(
            fake.0.lock().unwrap().calls,
            [Call::Find(SOURCE.into()), Call::Upsert, Call::Link(LINK)]
        );
    }
}
