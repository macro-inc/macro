//! The APS client over the connectors fake, answering Autodesk's published
//! example responses (see `fixtures/README.md`).

use std::sync::Arc;
use std::time::Duration;

use connectors::ApiResponse;
use connectors::fake::{FakeConnection, FakeConnectors};
use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::time::Instant;

use super::*;

const HUBS: &str = include_str!("../../../fixtures/hubs.json");
const PROJECTS: &str = include_str!("../../../fixtures/projects.json");
const PROJECTS_PAGED: &str = include_str!("../../../fixtures/projects_paged.json");
const TOP_FOLDERS: &str = include_str!("../../../fixtures/top_folders.json");
const FOLDER_CONTENTS: &str = include_str!("../../../fixtures/folder_contents.json");
const ITEM: &str = include_str!("../../../fixtures/item.json");
const VERSIONS: &str = include_str!("../../../fixtures/versions.json");
const SIGNED_COMPLETE: &str = include_str!("../../../fixtures/signeds3download_complete.json");
const SIGNED_CHUNKED: &str = include_str!("../../../fixtures/signeds3download_chunked.json");

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("designer@example.com").unwrap()
}

fn answer(status: StatusCode, body: &str) -> ApiResponse {
    ApiResponse {
        status,
        headers: HeaderMap::new(),
        body: body.to_owned(),
    }
}

fn rate_limited(retry_after: &str) -> ApiResponse {
    let mut response = answer(StatusCode::TOO_MANY_REQUESTS, "{}");
    response
        .headers
        .insert(http::header::RETRY_AFTER, retry_after.parse().unwrap());
    response
}

/// A published example as the last page of its listing.
fn last_page(fixture: &str) -> String {
    let mut page: serde_json::Value = serde_json::from_str(fixture).unwrap();
    page["links"].as_object_mut().unwrap().remove("next");
    page.to_string()
}

/// A connected user whose calls answer `responses` in turn.
async fn reader(
    responses: impl IntoIterator<Item = ApiResponse>,
) -> (
    FakeConnectors,
    ApsClient<ConnectedTransport<connectors::Connectors>>,
) {
    let fake = FakeConnectors::new().with_connection(
        &user(),
        FakeConnection::app(AUTODESK_APP).answering_in_turn(responses),
    );
    let reader = ConnectedAps::new(Arc::new(fake.build()))
        .for_user(&user())
        .await
        .unwrap()
        .unwrap();
    (fake, reader)
}

fn urls(fake: &FakeConnectors) -> Vec<String> {
    fake.api_calls().into_iter().map(|call| call.url).collect()
}

fn hub() -> HubId {
    HubId::parse("a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE").unwrap()
}

fn project() -> ApsProjectId {
    ApsProjectId::parse("b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d").unwrap()
}

fn item_id() -> ItemId {
    ItemId::parse("urn:adsk.wipprod:dm.lineage:b909RzMKR4mhc3O7UBY_8g").unwrap()
}

#[tokio::test]
async fn hubs_are_read_with_a_get_of_the_hubs_listing() {
    let (fake, reader) = reader([answer(StatusCode::OK, HUBS)]).await;

    let hubs = reader.hubs().await.unwrap();

    assert_eq!(
        hubs,
        vec![
            Hub {
                id: HubId::parse("a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE").unwrap(),
                name: "my team hub".into(),
            },
            Hub {
                id: HubId::parse("a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjI=").unwrap(),
                name: "my personal hub".into(),
            },
        ]
    );
    let calls = fake.api_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].method, Method::GET);
    assert_eq!(
        calls[0].url,
        "https://developer.api.autodesk.com/project/v1/hubs"
    );
    assert_eq!(calls[0].body, None);
}

#[tokio::test]
async fn projects_follow_links_next_until_the_last_page() {
    let (fake, reader) = reader([
        answer(StatusCode::OK, PROJECTS_PAGED),
        answer(StatusCode::OK, PROJECTS),
    ])
    .await;

    let projects = reader.projects(&hub()).await.unwrap();

    let names: Vec<_> = projects.iter().map(|project| project.id.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjEjMjAyMzAzMTcwMDAwMDAx",
            "a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjEjMjAyMzAzMTcwMDAwMDAx",
            "b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d",
        ]
    );
    assert_eq!(
        urls(&fake),
        vec![
            "https://developer.api.autodesk.com/project/v1/hubs/a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE/projects?page%5Bnumber%5D=0",
            "https://developer.api.autodesk.com/project/v1/hubs/a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE/projects?page%5Bnumber%5D=1",
        ]
    );
}

#[tokio::test]
async fn top_folders_are_named_as_autodesk_shows_them() {
    let (fake, reader) = reader([answer(StatusCode::OK, TOP_FOLDERS)]).await;

    let folders = reader.top_folders(&hub(), &project()).await.unwrap();

    assert_eq!(
        folders,
        vec![Folder {
            id: ApsFolderId::parse("urn:adsk.wipprod:dm.folder:hC6k4hndRWaeIVhIjvHu8w").unwrap(),
            name: "Plans".into(),
        }]
    );
    assert_eq!(
        urls(&fake),
        vec![
            "https://developer.api.autodesk.com/project/v1/hubs/a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE/projects/b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d/topFolders"
        ]
    );
}

#[tokio::test]
async fn a_folder_page_lists_folders_and_items_with_their_tip_version() {
    let (fake, reader) = reader([answer(StatusCode::OK, FOLDER_CONTENTS)]).await;
    let folder_id = ApsFolderId::parse("urn:adsk.wipprod:dm.folder:sdfedf8wefl").unwrap();

    let page = reader
        .folder_contents(&project(), &folder_id, 3)
        .await
        .unwrap();

    assert_eq!(
        page,
        FolderPage {
            entries: vec![
                FolderEntry::Folder(Folder {
                    id: ApsFolderId::parse("urn:adsk.wipprod:dm.folder:hC6k4hndRWaeIVhIjvHu8w")
                        .unwrap(),
                    name: "Plans".into(),
                }),
                FolderEntry::Item(FusionItem {
                    id: ItemId::parse("urn:adsk.wipprod:dm.lineage:hC6k4hndRWaeIVhIjvHu8w")
                        .unwrap(),
                    name: "my file".into(),
                    latest_version: Some(2),
                }),
            ],
            next_page: Some(4),
        }
    );
    assert_eq!(
        urls(&fake),
        vec![
            "https://developer.api.autodesk.com/data/v1/projects/b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d/folders/urn:adsk.wipprod:dm.folder:sdfedf8wefl/contents?page%5Bnumber%5D=3&page%5Blimit%5D=50"
        ]
    );
}

#[tokio::test]
async fn the_last_folder_page_has_no_next_page() {
    let (_fake, reader) = reader([answer(StatusCode::OK, &last_page(FOLDER_CONTENTS))]).await;
    let folder_id = ApsFolderId::parse("urn:adsk.wipprod:dm.folder:sdfedf8wefl").unwrap();

    let page = reader
        .folder_contents(&project(), &folder_id, 0)
        .await
        .unwrap();

    assert_eq!(page.next_page, None);
}

#[tokio::test]
async fn an_item_is_read_with_its_latest_version() {
    let (fake, reader) = reader([answer(StatusCode::OK, ITEM)]).await;
    let item_id = ItemId::parse("urn:adsk.wipprod:dm.lineage:hC6k4hndRWaeIVhIjvHu8w").unwrap();

    let item = reader.item(&project(), &item_id).await.unwrap();

    assert_eq!(
        item,
        FusionItem {
            id: item_id,
            name: "my_model.rvt".into(),
            latest_version: Some(2),
        }
    );
    assert_eq!(
        urls(&fake),
        vec![
            "https://developer.api.autodesk.com/data/v1/projects/b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d/items/urn:adsk.wipprod:dm.lineage:hC6k4hndRWaeIVhIjvHu8w"
        ]
    );
}

#[tokio::test]
async fn versions_carry_their_storage_and_extension_across_pages() {
    let (fake, reader) = reader([
        answer(StatusCode::OK, VERSIONS),
        answer(StatusCode::OK, &last_page(VERSIONS)),
    ])
    .await;

    let versions = reader.versions(&project(), &item_id()).await.unwrap();

    assert_eq!(versions.len(), 4);
    assert_eq!(
        versions[0],
        FusionVersion {
            id: VersionId::parse("urn:adsk.wipprod:fs.file:vf.b909RzMKR4mhc3O7UBY_8g?version=2")
                .unwrap(),
            number: 2,
            created_at: Some("2016-04-01T11:12:35Z".parse().unwrap()),
            size: None,
            // The example has no `fileType`; the name's extension stands in.
            extension: Some("pdf".into()),
            storage: Some(StorageObject {
                bucket_key: "wip.dm.prod".into(),
                object_key: "9f8bdc3f-e29c-4ada-ab7b-bb8dfa821163.pdf".into(),
            }),
        }
    );
    assert_eq!(versions[1].number, 1);
    assert_eq!(
        urls(&fake),
        vec![
            "https://developer.api.autodesk.com/data/v1/projects/b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d/items/urn:adsk.wipprod:dm.lineage:b909RzMKR4mhc3O7UBY_8g/versions?page%5Bnumber%5D=0",
            "https://developer.api.autodesk.com/data/v1/projects/b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d/items/urn:adsk.wipprod:dm.lineage:b909RzMKR4mhc3O7UBY_8g/versions?page%5Bnumber%5D=1",
        ]
    );
}

/// A versions page with one version, written here: no published example
/// shows a Fusion design's version.
fn one_version(attributes: serde_json::Value, storage_id: &str) -> String {
    serde_json::json!({
        "jsonapi": {"version": "1.0"},
        "links": {"self": {"href": "/data/v1/projects/p/items/i/versions"}},
        "data": [{
            "type": "versions",
            "id": "urn:adsk.wipprod:fs.file:vf.design?version=1",
            "attributes": attributes,
            "relationships": {
                "storage": {"data": {"type": "objects", "id": storage_id}}
            }
        }]
    })
    .to_string()
}

#[tokio::test]
async fn a_design_named_without_a_suffix_takes_its_stored_objects_extension() {
    let page = one_version(
        serde_json::json!({"name": "Bracket", "displayName": "Bracket", "versionNumber": 1}),
        "urn:adsk.objects:os.object:wip.dm.prod/2a6d61f2-f1a9-4f6c-8f2b-6e3b0d0f6f0e.f3d",
    );
    let (_fake, reader) = reader([answer(StatusCode::OK, &page)]).await;

    let versions = reader.versions(&project(), &item_id()).await.unwrap();

    // The import resolves `f3d` to a Fusion design document
    // (`domain::service::test::a_fusion_design_version_imports_as_an_f3d_document`).
    assert_eq!(versions[0].extension.as_deref(), Some("f3d"));
}

#[tokio::test]
async fn a_fusion_design_version_with_no_other_hint_is_f3d() {
    let page = one_version(
        serde_json::json!({
            "name": "Bracket",
            "versionNumber": 1,
            "extension": {"type": "versions:autodesk.fusion360:Design", "version": "1.0"}
        }),
        "urn:adsk.objects:os.object:wip.dm.prod/2a6d61f2-f1a9-4f6c-8f2b-6e3b0d0f6f0e",
    );
    let (_fake, reader) = reader([answer(StatusCode::OK, &page)]).await;

    let versions = reader.versions(&project(), &item_id()).await.unwrap();

    assert_eq!(versions[0].extension.as_deref(), Some("f3d"));
}

#[tokio::test]
async fn a_version_with_no_hint_of_its_type_has_no_extension() {
    let page = one_version(
        serde_json::json!({"name": "Bracket", "versionNumber": 1}),
        "urn:adsk.objects:os.object:wip.dm.prod/2a6d61f2-f1a9-4f6c-8f2b-6e3b0d0f6f0e",
    );
    let (_fake, reader) = reader([answer(StatusCode::OK, &page)]).await;

    let versions = reader.versions(&project(), &item_id()).await.unwrap();

    assert_eq!(versions[0].extension, None);
}

#[tokio::test]
async fn a_signed_download_names_the_object_and_answers_one_url() {
    let (fake, reader) = reader([answer(StatusCode::OK, SIGNED_COMPLETE)]).await;
    let storage = StorageObject {
        bucket_key: "wip.dm.prod".into(),
        object_key: "folder/9f8bdc3f.f3d".into(),
    };

    let signed = reader.signed_download(&storage).await.unwrap();

    assert_eq!(signed.parts.len(), 1);
    assert!(signed.parts[0].starts_with("https://oss-bucket-name.s3.amazonaws.com/"));
    assert_eq!(signed.size, Some(221983));
    // The object key's `/` stays inside its one segment.
    assert_eq!(
        urls(&fake),
        vec![
            "https://developer.api.autodesk.com/oss/v2/buckets/wip.dm.prod/objects/folder%2F9f8bdc3f.f3d/signeds3download"
        ]
    );
}

#[tokio::test]
async fn a_chunked_object_answers_its_chunks_in_byte_order() {
    let (_fake, reader) = reader([answer(StatusCode::OK, SIGNED_CHUNKED)]).await;
    let storage = StorageObject {
        bucket_key: "wip.dm.prod".into(),
        object_key: "unmerged.json".into(),
    };

    let signed = reader.signed_download(&storage).await.unwrap();

    assert_eq!(signed.parts.len(), 2);
    assert!(signed.parts[0].contains("uuid-fcdf6275"));
    assert!(signed.parts[1].contains("uuid-cc685997"));
    assert_eq!(signed.size, Some(19715187));
}

#[tokio::test]
async fn refusals_and_outages_are_typed() {
    let cases = [
        (answer(StatusCode::UNAUTHORIZED, "{}"), "needs reauth"),
        (answer(StatusCode::FORBIDDEN, "{}"), "forbidden"),
        (answer(StatusCode::NOT_FOUND, "{}"), "not found"),
        (answer(StatusCode::SERVICE_UNAVAILABLE, "{}"), "unavailable"),
        (answer(StatusCode::OK, "not json"), "invalid"),
        (answer(StatusCode::BAD_REQUEST, "{}"), "internal"),
    ];
    for (response, expected) in cases {
        let (_fake, reader) = reader([response]).await;
        let error = reader.hubs().await.unwrap_err();
        let kind = match error {
            ApsError::NeedsReauth => "needs reauth",
            ApsError::Forbidden => "forbidden",
            ApsError::NotFound => "not found",
            ApsError::Upstream(UpstreamError {
                failure: UpstreamFailure::Unavailable,
                ..
            }) => "unavailable",
            ApsError::Upstream(UpstreamError {
                failure: UpstreamFailure::InvalidResponse,
                ..
            }) => "invalid",
            ApsError::Internal(_) => "internal",
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(kind, expected);
    }
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_is_retried_once_after_retry_after() {
    let (fake, reader) = reader([rate_limited("5"), answer(StatusCode::OK, HUBS)]).await;
    let started = Instant::now();

    assert_eq!(reader.hubs().await.unwrap().len(), 2);

    assert_eq!(fake.api_calls().len(), 2);
    assert!(Instant::now() - started >= Duration::from_secs(5));
}

#[tokio::test(start_paused = true)]
async fn a_second_rate_limit_is_reported_with_its_wait() {
    let (fake, reader) = reader([rate_limited("5"), rate_limited("7")]).await;

    let error = reader.hubs().await.unwrap_err();

    assert!(matches!(
        error,
        ApsError::RateLimited { retry_after: Some(wait) } if wait == Duration::from_secs(7)
    ));
    assert_eq!(fake.api_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_wait_too_long_for_one_call_is_reported_at_once() {
    let (fake, reader) = reader([rate_limited("120")]).await;
    let started = Instant::now();

    let error = reader.hubs().await.unwrap_err();

    assert!(matches!(error, ApsError::RateLimited { .. }));
    assert_eq!(fake.api_calls().len(), 1);
    assert_eq!(Instant::now(), started);
}

/// Autodesk is reached only through a usable `autodesk` connection; anything
/// else is "not connected".
#[tokio::test]
async fn without_a_usable_connection_there_is_no_reader() {
    let user = user();
    let unconnected = FakeConnectors::new().with_catalog_app(AUTODESK_APP);
    let disabled =
        FakeConnectors::new().with_connection(&user, FakeConnection::app(AUTODESK_APP).disabled());
    let needs_reauth = FakeConnectors::new()
        .with_connection(&user, FakeConnection::app(AUTODESK_APP).needs_reauth());

    for fake in [unconnected, disabled, needs_reauth] {
        let connections = ConnectedAps::new(Arc::new(fake.build()));
        assert!(connections.for_user(&user).await.unwrap().is_none());
    }
}

mod live_env {
    macro_env_var::maybe_env_vars! {
        /// A three-legged APS access token with `data:read`, for the live test.
        pub struct ApsAccessToken;
    }
}

/// Sends APS requests with a bearer token, standing in for a connection in
/// the live test.
struct BearerTransport {
    http: reqwest::Client,
    token: String,
}

impl ApsTransport for BearerTransport {
    async fn get(&self, url: &Url) -> Result<TransportResponse, ApsError> {
        let response = self
            .http
            .get(url.clone())
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(internal)?;
        let status = response.status();
        let retry_after = response
            .headers()
            .get(http::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok()?.parse().ok())
            .map(Duration::from_secs);
        let body = response.text().await.map_err(internal)?;
        Ok(TransportResponse {
            status,
            retry_after,
            body,
        })
    }
}

/// Step 0 of the plan against a real Autodesk account: walk from the first
/// hub down to the first item, list its versions, and download the oldest
/// one with storage. Run with `APS_ACCESS_TOKEN` set to a three-legged token
/// (`data:read`) of a test account holding a Fusion design saved twice:
/// `cargo test -p fusion_import -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "needs APS_ACCESS_TOKEN for a real Autodesk test account"]
async fn live_a_real_account_walks_down_to_a_downloadable_version() {
    use crate::domain::ports::{Download, SignedDownloads};
    use crate::outbound::signed_download::HttpSignedDownloads;

    let token = live_env::ApsAccessToken::new()
        .and_then(|token| token.value().map(|value| value.trim().to_owned()))
        .filter(|token| !token.is_empty())
        .expect("set APS_ACCESS_TOKEN");
    let reader = ApsClient::new(BearerTransport {
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap(),
        token,
    });

    let hubs = reader.hubs().await.unwrap();
    eprintln!("hubs: {}", hubs.len());
    let hub = hubs.first().expect("the account has a hub");
    let projects = reader.projects(&hub.id).await.unwrap();
    eprintln!("projects in the first hub: {}", projects.len());
    let project = projects.first().expect("the hub has a project");

    // Breadth-first through the project's folders to the first item.
    let mut folders: Vec<ApsFolderId> = reader
        .top_folders(&hub.id, &project.id)
        .await
        .unwrap()
        .into_iter()
        .map(|folder| folder.id)
        .collect();
    let mut found = None;
    while found.is_none() && !folders.is_empty() {
        let folder_id = folders.remove(0);
        let page = reader
            .folder_contents(&project.id, &folder_id, 0)
            .await
            .unwrap();
        for entry in page.entries {
            match entry {
                FolderEntry::Folder(folder) => folders.push(folder.id),
                FolderEntry::Item(item) => {
                    found.get_or_insert(item);
                }
            }
        }
    }
    let item = found.expect("the project holds an item");
    eprintln!("first item: latest version {:?}", item.latest_version);

    let mut versions = reader.versions(&project.id, &item.id).await.unwrap();
    versions.sort_by_key(|version| version.number);
    for version in &versions {
        eprintln!(
            "version {}: extension {:?}, size {:?}, storage {}",
            version.number,
            version.extension,
            version.size,
            version.storage.is_some()
        );
    }
    let stored = versions
        .iter()
        .find_map(|version| version.storage.as_ref())
        .expect("a version has storage");

    let signed = reader.signed_download(stored).await.unwrap();
    eprintln!(
        "signed parts: {}, size {:?}",
        signed.parts.len(),
        signed.size
    );
    let download = HttpSignedDownloads::new()
        .unwrap()
        .fetch(&signed, crate::domain::service::MAX_VERSION_BYTES)
        .await
        .unwrap();
    match download {
        Download::Bytes(bytes) => {
            eprintln!("downloaded {} bytes", bytes.len());
            assert!(!bytes.is_empty());
        }
        Download::TooLarge => eprintln!("the oldest stored version is over the cap"),
    }
}
