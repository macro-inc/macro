use super::*;
use crate::domain::models::{ImportTargetReservation, Initiator};
use crate::domain::models::{NotionAnnotations, NotionRichText, NotionRichTextKind};
use crate::domain::ports::{ImportedDocumentProperties, ImportedTaskProperties};
use crate::domain::service::test::admission::{NoConnector, Repo, user};
use crate::domain::service::{
    ActiveImport, ApiSources, ImportServiceImpl, NoLinearSource, NoSlackSource,
};
use chrono::{DateTime, Utc};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(in crate::domain::service) fn nid(n: u32) -> NotionId {
    NotionId::parse(&format!("{n:032x}")).unwrap()
}

pub(in crate::domain::service) fn at(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339).unwrap().to_utc()
}

pub(in crate::domain::service) fn plain(text: &str) -> Vec<NotionRichText> {
    vec![NotionRichText {
        kind: NotionRichTextKind::Text { link: None },
        plain_text: text.to_string(),
        annotations: NotionAnnotations::default(),
    }]
}

pub(in crate::domain::service) fn block(n: u32, kind: NotionBlockKind) -> NotionBlock {
    NotionBlock {
        id: nid(n),
        kind,
        has_children: false,
        children: Vec::new(),
    }
}

pub(in crate::domain::service) fn page(
    n: u32,
    title: &str,
    parent: NotionParent,
    edited: &str,
) -> NotionPage {
    NotionPage {
        id: nid(n),
        url: format!("https://www.notion.so/{}", nid(n)),
        title: title.to_string(),
        icon_emoji: None,
        last_edited_time: at(edited),
        last_edited_by: Some("me".into()),
        archived: false,
        parent,
        properties: Vec::new(),
    }
}

/// An in-memory Notion workspace.
#[derive(Default)]
pub(in crate::domain::service) struct FakeWorkspace {
    pub owner: Option<NotionOwner>,
    pub search: Vec<NotionPage>,
    pub pages: BTreeMap<NotionId, NotionPage>,
    /// Children by parent id, served two per cursor page.
    pub children: BTreeMap<NotionId, Vec<NotionBlock>>,
    pub containers: BTreeMap<NotionId, NotionContainer>,
    pub block_parents: BTreeMap<NotionId, NotionParent>,
    pub reads: AtomicUsize,
    /// How long each children read takes.
    pub read_delay: std::time::Duration,
}

/// A Notion source over a shared [`FakeWorkspace`].
#[derive(Default, Clone)]
pub(in crate::domain::service) struct FakeNotion(pub Arc<FakeWorkspace>);

impl FakeNotion {
    pub(in crate::domain::service) fn new(workspace: FakeWorkspace) -> Self {
        Self(Arc::new(workspace))
    }
}

impl FakeWorkspace {
    pub(in crate::domain::service) fn with_pages(
        owner: NotionOwner,
        pages: Vec<NotionPage>,
    ) -> Self {
        Self {
            owner: Some(owner),
            pages: pages
                .iter()
                .map(|page| (page.id.clone(), page.clone()))
                .collect(),
            search: pages,
            ..Self::default()
        }
    }
}

impl NotionSource for FakeNotion {
    type Session = FakeNotion;

    fn open(&self, _: &MacroUserIdStr<'static>) -> FakeNotion {
        self.clone()
    }
}

impl NotionSession for FakeNotion {
    async fn owner(&self) -> Result<NotionOwner, ApiSourceError> {
        self.0
            .owner
            .clone()
            .ok_or(ApiSourceError::NotConnected(ImportSource::Notion))
    }
    async fn search_pages(&self, cursor: Option<&str>) -> Result<NotionSearchPage, ApiSourceError> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        // Ten results per page, so pagination is exercised.
        let start: usize = cursor.map_or(0, |cursor| cursor.parse().unwrap());
        let end = (start + 10).min(self.0.search.len());
        Ok(NotionSearchPage {
            pages: self.0.search[start..end].to_vec(),
            next_cursor: (end < self.0.search.len()).then(|| end.to_string()),
        })
    }
    async fn page(&self, id: &NotionId) -> Result<NotionPage, ApiSourceError> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        self.0
            .pages
            .get(id)
            .cloned()
            .ok_or(ApiSourceError::NotFound)
    }
    async fn database(&self, id: &NotionId) -> Result<NotionContainer, ApiSourceError> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        self.0
            .containers
            .get(id)
            .cloned()
            .ok_or(ApiSourceError::NotFound)
    }
    async fn data_source_database(&self, _: &NotionId) -> Result<NotionId, ApiSourceError> {
        Err(ApiSourceError::NotFound)
    }
    async fn block_parent(&self, id: &NotionId) -> Result<NotionParent, ApiSourceError> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        self.0
            .block_parents
            .get(id)
            .cloned()
            .ok_or(ApiSourceError::NotFound)
    }
    async fn children(
        &self,
        id: &NotionId,
        cursor: Option<&str>,
    ) -> Result<NotionBlockPage, ApiSourceError> {
        self.0.reads.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(self.0.read_delay).await;
        let all = self.0.children.get(id).ok_or(ApiSourceError::NotFound)?;
        let start: usize = cursor.map_or(0, |cursor| cursor.parse().unwrap());
        let end = (start + 2).min(all.len());
        Ok(NotionBlockPage {
            blocks: all[start..end]
                .iter()
                .map(|block| NotionBlock {
                    children: Vec::new(),
                    ..block.clone()
                })
                .collect(),
            next_cursor: (end < all.len()).then(|| end.to_string()),
        })
    }
}

#[derive(Default)]
pub(in crate::domain::service) struct FakeImages {
    pub fail: bool,
    pub calls: AtomicUsize,
}

impl ImageRehoster for FakeImages {
    async fn rehost(&self, url: &str, limit_bytes: usize) -> Result<RehostedImage, RehostError> {
        assert_eq!(limit_bytes, IMAGE_LIMIT_BYTES);
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(RehostError::TooLarge { limit_bytes });
        }
        Ok(RehostedImage {
            id: format!("sfs-{call}"),
            url: format!(
                "https://static.example.test/file/sfs-{call}?from={}",
                url.len()
            ),
            width: 640,
            height: 480,
        })
    }
}

/// Records every task, document and folder an import creates.
#[derive(Default)]
pub(in crate::domain::service) struct DocCreator {
    /// (name, markdown, properties) per created task.
    pub tasks: Mutex<Vec<(String, String, ImportedTaskProperties)>>,
    pub docs: Mutex<Vec<CreatedDoc>>,
    /// (id, name, parent) per created folder.
    pub folders: Mutex<Vec<(Uuid, String, Option<Uuid>)>>,
    /// Folders the user deleted since.
    pub deleted: Mutex<Vec<Uuid>>,
}

impl DocCreator {
    /// Folder names by path from the root, e.g. `Notion/Team Home`.
    pub(in crate::domain::service) fn folder_path(&self, folder: Uuid) -> String {
        let folders = self.folders.lock().unwrap();
        let mut names = Vec::new();
        let mut current = Some(folder);
        while let Some(id) = current {
            let (_, name, parent) = folders.iter().find(|(f, _, _)| *f == id).unwrap();
            names.push(name.clone());
            current = *parent;
        }
        names.reverse();
        names.join("/")
    }
}

#[derive(Debug, Clone)]
pub(in crate::domain::service) struct CreatedDoc {
    pub id: String,
    pub name: String,
    pub markdown: String,
    pub properties: ImportedDocumentProperties,
    pub folder: Option<Uuid>,
}

impl EntityCreator for DocCreator {
    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
        properties: &ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        self.tasks
            .lock()
            .unwrap()
            .push((name.into(), markdown.into(), properties.clone()));
        Ok(Uuid::now_v7().to_string())
    }
    async fn create_markdown_doc(
        &self,
        _: &MacroUserIdStr<'static>,
        name: &str,
        markdown: &str,
        properties: &ImportedDocumentProperties,
        folder: Option<Uuid>,
    ) -> anyhow::Result<String> {
        let id = Uuid::now_v7().to_string();
        self.docs.lock().unwrap().push(CreatedDoc {
            id: id.clone(),
            name: name.to_string(),
            markdown: markdown.to_string(),
            properties: properties.clone(),
            folder,
        });
        Ok(id)
    }
    async fn create_folder(
        &self,
        _: &MacroUserIdStr<'static>,
        name: &str,
        parent: Option<Uuid>,
    ) -> anyhow::Result<Uuid> {
        // Take a while, as a real create does, so concurrent page imports
        // race for the same folders.
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let id = Uuid::now_v7();
        self.folders
            .lock()
            .unwrap()
            .push((id, name.to_string(), parent));
        Ok(id)
    }
    async fn folder_usable(
        &self,
        _: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        Ok(!self.deleted.lock().unwrap().contains(&folder))
    }
    async fn create_channel(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &ImportTargetReservation,
        _: &[String],
    ) -> anyhow::Result<Uuid> {
        unreachable!("notion imports create documents")
    }
}

/// Plan and import one claimed row, as a batch of one.
pub(in crate::domain::service) async fn import_one(
    service: &NotionTestService,
    row: &ImportEntity,
) -> RowOutcome {
    let session = service.apis.notion().open(&user());
    let (facts, plan) = plan_batch(&session, std::slice::from_ref(row)).await;
    import_notion_row(service, &session, &user(), row, &facts[0], &plan).await
}

pub(in crate::domain::service) type NotionTestService = ImportServiceImpl<
    Repo,
    NoConnector,
    DocCreator,
    NoSlackSource,
    ApiSources<NoLinearSource, FakeNotion, FakeImages>,
>;

pub(in crate::domain::service) fn notion_service(
    notion: FakeWorkspace,
    images: FakeImages,
) -> NotionTestService {
    ImportServiceImpl::new(
        Repo::with_roster(Vec::new()),
        Arc::new(NoConnector),
        Arc::new(DocCreator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_api_sources(Arc::new(ApiSources::new(
        NoLinearSource,
        FakeNotion::new(notion),
        images,
    )))
}

#[test]
fn names_are_the_plain_title_with_an_emoji_icon() {
    assert_eq!(document_name("Q4 Plan", Some("🚀")), "🚀 Q4 Plan");
    assert_eq!(document_name("  Q4 Plan ", None), "Q4 Plan");
    assert_eq!(document_name("", Some("🚀")), "🚀 Untitled");
}

#[test]
fn discovery_metadata_records_who_edited_last() {
    let mut mine = page(1, "Mine", NotionParent::Workspace, "2026-10-07T00:00:00Z");
    mine.icon_emoji = Some("🚀".into());
    let meta = notion_doc_meta(&mine, &NotionOwner::User("me".into()));
    assert_eq!(meta.edited_by_user, Some(true));
    assert_eq!(meta.icon_emoji.as_deref(), Some("🚀"));
    assert_eq!(meta.parent, Some(NotionParent::Workspace));
    assert_eq!(
        notion_doc_meta(&mine, &NotionOwner::User("someone".into())).edited_by_user,
        Some(false)
    );
    assert_eq!(
        notion_doc_meta(&mine, &NotionOwner::NotAUser).edited_by_user,
        None
    );
}

#[tokio::test(start_paused = true)]
async fn discovery_keeps_fresh_real_pages_and_skips_archived_and_stub_rows() {
    let database = NotionParent::Database(nid(900).as_str().to_string());
    let mut archived = page(
        3,
        "Archived",
        NotionParent::Workspace,
        "2026-10-05T00:00:00Z",
    );
    archived.archived = true;
    let pages = vec![
        page(1, "Fresh", NotionParent::Workspace, "2026-10-07T00:00:00Z"),
        page(2, "Long row", database.clone(), "2026-10-06T00:00:00Z"),
        archived,
        page(4, "Stub row", database, "2026-10-04T00:00:00Z"),
        page(
            5,
            "Older",
            NotionParent::Page(nid(1).as_str().to_string()),
            "2026-10-03T00:00:00Z",
        ),
    ];
    let mut notion = FakeWorkspace::with_pages(NotionOwner::User("me".into()), pages);
    notion.children.insert(
        nid(2),
        vec![block(
            20,
            NotionBlockKind::Paragraph(plain(&"x".repeat(DATABASE_ROW_MIN_CHARS))),
        )],
    );
    notion.children.insert(
        nid(4),
        vec![block(40, NotionBlockKind::Paragraph(plain("todo")))],
    );
    let service = notion_service(notion, FakeImages::default());

    let staged = gather_notion(&service, &user(), GatherMode::Onboarding)
        .await
        .unwrap();

    assert_eq!(staged, 3);
    let rows = service.repo.rows();
    let staged_ids: Vec<&str> = rows.iter().map(|row| row.foreign_id.as_str()).collect();
    assert_eq!(
        staged_ids,
        [nid(1).as_str(), nid(2).as_str(), nid(5).as_str()]
    );
    assert!(
        rows.iter()
            .all(|row| row.initiator == Initiator::Onboarding)
    );
    let meta: NotionDocMeta = serde_json::from_value(rows[0].metadata.clone()).unwrap();
    assert_eq!(meta.title, "Fresh");
    assert_eq!(meta.edited_by_user, Some(true));
}

#[tokio::test(start_paused = true)]
async fn discovery_caps_at_thirty_pages() {
    let pages: Vec<NotionPage> = (1..=45)
        .map(|n| {
            page(
                n,
                &format!("Page {n}"),
                NotionParent::Workspace,
                "2026-10-01T00:00:00Z",
            )
        })
        .collect();
    let service = notion_service(
        FakeWorkspace::with_pages(NotionOwner::NotAUser, pages),
        FakeImages::default(),
    );
    let staged = gather_notion(&service, &user(), GatherMode::Manual)
        .await
        .unwrap();
    assert_eq!(staged, MAX_NOTION_PAGES);
    assert!(
        service
            .repo
            .rows()
            .iter()
            .all(|row| row.initiator == Initiator::Manual)
    );
}

#[tokio::test(start_paused = true)]
async fn users_without_a_pipedream_notion_connection_are_skipped() {
    let service = notion_service(FakeWorkspace::default(), FakeImages::default());
    let staged = gather_notion(&service, &user(), GatherMode::Onboarding)
        .await
        .unwrap();
    assert_eq!(staged, 0);
    assert!(service.repo.rows().is_empty());
}

#[tokio::test(start_paused = true)]
async fn discovery_stops_judging_rows_when_its_time_is_up() {
    // A tracker database's short rows fill the freshest results, and each
    // is judged with a slow read: judging them all would outlast the gather.
    let database = NotionParent::Database(nid(900).as_str().to_string());
    let mut pages = vec![page(
        1,
        "Fresh",
        NotionParent::Workspace,
        "2026-10-07T00:00:00Z",
    )];
    pages.extend((2..=50).map(|n| page(n, "Stub row", database.clone(), "2026-10-06T00:00:00Z")));
    let mut notion = FakeWorkspace::with_pages(NotionOwner::NotAUser, pages);
    for n in 2..=50 {
        notion.children.insert(
            nid(n),
            vec![block(n, NotionBlockKind::Paragraph(plain("todo")))],
        );
    }
    notion.read_delay = std::time::Duration::from_secs(10);
    let service = notion_service(notion, FakeImages::default());

    let started = tokio::time::Instant::now();
    let staged = gather_notion(&service, &user(), GatherMode::Onboarding)
        .await
        .unwrap();

    assert!(started.elapsed() < crate::domain::service::GATHER_TIMEOUT);
    assert_eq!(staged, 1, "what qualified before time ran out is staged");
    assert_eq!(service.repo.rows()[0].foreign_id, nid(1).as_str());
}

/// A workspace with one page, "Plan", whose body is `blocks`.
fn one_page(blocks: Vec<NotionBlock>) -> FakeWorkspace {
    let mut notion = FakeWorkspace::with_pages(
        NotionOwner::NotAUser,
        vec![page(
            1,
            "Plan",
            NotionParent::Workspace,
            "2026-10-07T00:00:00Z",
        )],
    );
    notion.children.insert(nid(1), blocks);
    notion
}

async fn staged_row(service: &NotionTestService, n: u32) -> ImportEntity {
    let page = service.apis.notion().0.pages[&nid(n)].clone();
    let metadata = serde_json::to_value(notion_doc_meta(&page, &NotionOwner::NotAUser)).unwrap();
    service
        .stage_inner(
            &user(),
            Initiator::Onboarding,
            ImportSource::Notion,
            nid(n).as_str(),
            metadata,
            false,
        )
        .await
        .unwrap();
    let row = service
        .repo
        .rows()
        .into_iter()
        .find(|row| row.foreign_id == nid(n).as_str())
        .unwrap();
    service
        .repo
        .mark_importing(&user(), &[row.id])
        .await
        .unwrap()
        .pop()
        .unwrap()
}

#[tokio::test(start_paused = true)]
async fn a_page_imports_with_its_name_source_link_and_rehosted_images() {
    let mut first = page(1, "Plan", NotionParent::Workspace, "2026-10-07T00:00:00Z");
    first.icon_emoji = Some("🚀".into());
    let mut notion = FakeWorkspace::with_pages(NotionOwner::NotAUser, vec![first]);
    notion.children.insert(
        nid(1),
        vec![
            block(10, NotionBlockKind::Paragraph(plain("Hello"))),
            block(
                11,
                NotionBlockKind::Image {
                    file: crate::domain::models::NotionFile {
                        url: "https://prod-files-secure.s3.amazonaws.com/a.png?sig=1".into(),
                        hosted: true,
                        name: None,
                    },
                    caption: plain("Diagram"),
                },
            ),
        ],
    );
    let service = notion_service(notion, FakeImages::default());
    let row = staged_row(&service, 1).await;

    let outcome = import_one(&service, &row).await;

    assert_eq!(outcome, RowOutcome::Imported);
    let docs = service.creator.docs.lock().unwrap();
    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0].name, "🚀 Plan");
    assert_eq!(
        service.creator.folder_path(docs[0].folder.unwrap()),
        "Notion"
    );
    assert_eq!(
        docs[0].properties,
        ImportedDocumentProperties {
            values: vec![crate::domain::models::ImportedDocumentProperty {
                name: SOURCE_PROPERTY.into(),
                value: crate::domain::models::ImportedDocumentPropertyValue::Link {
                    urls: vec![format!("https://www.notion.so/{}", nid(1))],
                    multi: false,
                },
            }],
            tags: Vec::new(),
        }
    );
    assert!(docs[0].markdown.starts_with("Hello\n\n<m-image>{"));
    assert!(docs[0].markdown.contains(r#""srcType":"sfs","id":"sfs-0""#));
    assert!(docs[0].markdown.contains(r#""alt":"Diagram""#));
    let row = service.repo.get(&user(), row.id).await.unwrap().unwrap();
    assert_eq!(row.status, ImportStatus::Imported);
    assert_eq!(row.entity_id.as_deref(), Some(docs[0].id.as_str()));
    assert_eq!(row.team_id, None, "imported pages stay private");
}

#[tokio::test(start_paused = true)]
async fn images_that_cannot_be_rehosted_become_links_to_the_page() {
    let service = notion_service(
        one_page(vec![block(
            11,
            NotionBlockKind::Image {
                file: crate::domain::models::NotionFile {
                    url: "https://prod-files-secure.s3.amazonaws.com/huge.png?sig=1".into(),
                    hosted: true,
                    name: None,
                },
                caption: Vec::new(),
            },
        )]),
        FakeImages {
            fail: true,
            ..FakeImages::default()
        },
    );
    let row = staged_row(&service, 1).await;

    assert_eq!(import_one(&service, &row).await, RowOutcome::Imported);
    let docs = service.creator.docs.lock().unwrap();
    assert_eq!(
        docs[0].markdown,
        format!("[Image](https://www.notion.so/{})", nid(1))
    );
}

#[tokio::test(start_paused = true)]
async fn empty_pages_are_excluded_not_failed() {
    let service = notion_service(
        one_page(vec![block(10, NotionBlockKind::Paragraph(Vec::new()))]),
        FakeImages::default(),
    );
    let row = staged_row(&service, 1).await;

    let outcome = import_one(&service, &row).await;

    assert_eq!(outcome, RowOutcome::Skipped);
    assert!(service.creator.docs.lock().unwrap().is_empty());
    assert!(service.repo.get(&user(), row.id).await.unwrap().is_none());
}

#[tokio::test(start_paused = true)]
async fn unreadable_pages_fail_with_a_readable_reason() {
    let mut notion = one_page(Vec::new());
    notion.children.clear();
    let service = notion_service(notion, FakeImages::default());
    let row = staged_row(&service, 1).await;

    assert_eq!(import_one(&service, &row).await, RowOutcome::Failed);
    let row = service.repo.get(&user(), row.id).await.unwrap().unwrap();
    assert_eq!(row.status, ImportStatus::Staged);
    assert_eq!(
        row.last_error.as_deref(),
        Some("the Notion page is not shared with the connection")
    );
}

#[tokio::test(start_paused = true)]
async fn links_to_imported_pages_become_document_mentions() {
    let mut notion = FakeWorkspace::with_pages(
        NotionOwner::NotAUser,
        vec![
            page(1, "Index", NotionParent::Workspace, "2026-10-07T00:00:00Z"),
            page(2, "Spec", NotionParent::Workspace, "2026-10-06T00:00:00Z"),
        ],
    );
    notion.children.insert(
        nid(2),
        vec![block(20, NotionBlockKind::Paragraph(plain("The spec.")))],
    );
    notion.children.insert(
        nid(1),
        vec![
            block(10, NotionBlockKind::LinkToPage(nid(2))),
            block(11, NotionBlockKind::LinkToPage(nid(3))),
        ],
    );
    let service = notion_service(notion, FakeImages::default());
    let spec = staged_row(&service, 2).await;
    import_one(&service, &spec).await;
    let index = staged_row(&service, 1).await;
    import_one(&service, &index).await;

    let docs = service.creator.docs.lock().unwrap();
    let spec_id = &docs[0].id;
    assert_eq!(
        docs[1].markdown,
        format!(
            "<m-document-mention>{{\"documentId\":\"{spec_id}\",\"blockName\":\"md\",\"documentName\":\"Spec\",\"blockParams\":{{}},\"collapsed\":false}}</m-document-mention>\n\n[Notion page](https://www.notion.so/{})",
            nid(3)
        )
    );
}

#[test]
fn database_rows_need_a_real_body() {
    let short = vec![block(1, NotionBlockKind::Paragraph(plain("todo")))];
    assert!(body_text_chars(&short) < DATABASE_ROW_MIN_CHARS);
    let long = vec![
        block(
            1,
            NotionBlockKind::Heading {
                level: 2,
                text: plain(&"a".repeat(100)),
                toggleable: false,
            },
        ),
        block(
            2,
            NotionBlockKind::BulletedListItem(plain(&"b".repeat(100))),
        ),
        block(3, NotionBlockKind::Divider),
    ];
    assert_eq!(body_text_chars(&long), 200);
}

#[test]
fn database_row_properties_map_to_macro_values() {
    use crate::domain::models::{
        ImportedDocumentProperty as P, ImportedDocumentPropertyValue as V, NotionProperty,
        NotionPropertyValue as N,
    };
    let property = |name: &str, value: N| NotionProperty {
        name: name.into(),
        value,
    };
    let mapped = document_properties(&[
        property("Areas", N::MultiSelect(vec!["Exports".into()])),
        property(
            "Due",
            N::Date {
                start: "2026-11-15".into(),
                end: None,
            },
        ),
        property("Empty", N::Select(None)),
        property("Estimate", N::Number(Some(8.0))),
        property("Name", N::Title),
        property("Notes", N::RichText("x".repeat(400))),
        property("Owner", N::Skipped),
        property("Shipped", N::Checkbox(false)),
        property("Source", N::Url(Some("https://example.com/theirs".into()))),
        property("Spec", N::Url(Some("https://example.com/spec".into()))),
        property("Status", N::Status(Some("In progress".into()))),
        property("Summary", N::RichText("Streaming exports".into())),
        property("Tags", N::MultiSelect(vec!["Q4".into(), "Infra".into()])),
        property("Team", N::Select(Some("Platform".into()))),
    ]);
    let select = |values: &[&str], multi| V::Select {
        values: values.iter().map(|value| value.to_string()).collect(),
        multi,
    };
    assert_eq!(mapped.tags, ["Q4", "Infra"]);
    assert_eq!(
        mapped.values,
        [
            P {
                name: "Areas".into(),
                value: select(&["Exports"], true)
            },
            P {
                name: "Due".into(),
                value: V::Date {
                    value: "2026-11-15".into()
                }
            },
            P {
                name: "Estimate".into(),
                value: V::Number { value: 8.0 }
            },
            P {
                name: "Shipped".into(),
                value: V::Boolean { value: false }
            },
            P {
                name: "Spec".into(),
                value: V::Link {
                    urls: vec!["https://example.com/spec".into()],
                    multi: false
                },
            },
            P {
                name: "Status".into(),
                value: select(&["In progress"], false)
            },
            P {
                name: "Summary".into(),
                value: V::String {
                    value: "Streaming exports".into()
                }
            },
            P {
                name: "Team".into(),
                value: select(&["Platform"], false)
            },
        ]
    );
}

/// Home ─┬─ Plan ── Checklist, and Projects (database) ── Row.
fn nested_workspace() -> FakeWorkspace {
    let mut home = page(
        1,
        "Team Home",
        NotionParent::Workspace,
        "2026-07-01T00:00:00Z",
    );
    home.icon_emoji = Some("🏠".into());
    let plan = page(
        2,
        "Plan",
        NotionParent::Page(nid(1).as_str().into()),
        "2026-10-07T00:00:00Z",
    );
    let checklist = page(
        3,
        "Checklist",
        NotionParent::Page(nid(2).as_str().into()),
        "2026-10-06T00:00:00Z",
    );
    let row = page(
        5,
        "Row",
        NotionParent::Database(nid(4).as_str().into()),
        "2026-10-05T00:00:00Z",
    );
    let mut workspace =
        FakeWorkspace::with_pages(NotionOwner::NotAUser, vec![plan, checklist, row]);
    workspace.pages.insert(nid(1), home);
    workspace.containers.insert(
        nid(4),
        NotionContainer {
            id: nid(4),
            title: "Projects".into(),
            icon_emoji: None,
            parent: NotionParent::Page(nid(1).as_str().into()),
        },
    );
    for n in [2, 3, 5] {
        workspace.children.insert(
            nid(n),
            vec![block(n * 10, NotionBlockKind::Paragraph(plain("Body")))],
        );
    }
    workspace
}

async fn import_batch(service: &NotionTestService, pages: &[u32]) {
    let mut rows = Vec::new();
    for n in pages {
        rows.push(staged_row(service, *n).await);
    }
    import_notion_rows(service, &user(), rows, 3).await;
}

#[tokio::test(start_paused = true)]
async fn pages_land_in_folders_mirroring_their_notion_structure() {
    let service = notion_service(nested_workspace(), FakeImages::default());
    import_batch(&service, &[2, 3, 5]).await;

    let docs = service.creator.docs.lock().unwrap().clone();
    let placed: Vec<(String, String)> = docs
        .iter()
        .map(|doc| {
            (
                doc.name.clone(),
                service.creator.folder_path(doc.folder.unwrap()),
            )
        })
        .collect();
    assert_eq!(
        placed,
        [
            ("Plan".to_string(), "Notion/🏠 Team Home/Plan".to_string()),
            (
                "Checklist".to_string(),
                "Notion/🏠 Team Home/Plan".to_string()
            ),
            (
                "Row".to_string(),
                "Notion/🏠 Team Home/Projects".to_string()
            ),
        ]
    );
    // Root, Team Home, Plan, Projects: each created once.
    assert_eq!(service.creator.folders.lock().unwrap().len(), 4);
}

#[tokio::test(start_paused = true)]
async fn reruns_reuse_folders_and_recreate_deleted_ones() {
    let service = notion_service(nested_workspace(), FakeImages::default());
    import_batch(&service, &[2]).await;
    let folders_after_first = service.creator.folders.lock().unwrap().len();
    assert_eq!(folders_after_first, 2, "Notion and Team Home");

    // A later row reuses the existing folders.
    import_batch(&service, &[5]).await;
    assert_eq!(
        service.creator.folders.lock().unwrap().len(),
        3,
        "only Projects is new"
    );

    // A folder the user deleted is replaced rather than filed into.
    let team_home = service.creator.folders.lock().unwrap()[1].0;
    service.creator.deleted.lock().unwrap().push(team_home);
    import_batch(&service, &[3]).await;
    let docs = service.creator.docs.lock().unwrap().clone();
    let checklist = docs.iter().find(|doc| doc.name == "Checklist").unwrap();
    assert_eq!(
        service.creator.folder_path(checklist.folder.unwrap()),
        "Notion/🏠 Team Home/Plan"
    );
    assert_eq!(
        service
            .creator
            .folders
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, name, _)| name == "🏠 Team Home")
            .count(),
        2
    );
}

#[tokio::test(start_paused = true)]
async fn titles_of_ancestors_label_links_to_unimported_pages() {
    let mut workspace = nested_workspace();
    workspace
        .children
        .insert(nid(2), vec![block(20, NotionBlockKind::LinkToPage(nid(1)))]);
    let service = notion_service(workspace, FakeImages::default());
    import_batch(&service, &[2]).await;
    let docs = service.creator.docs.lock().unwrap();
    assert_eq!(
        docs[0].markdown,
        format!("[🏠 Team Home](https://www.notion.so/{})", nid(1))
    );
}

#[tokio::test]
async fn a_run_surfaces_only_its_own_active_imports_on_home() {
    let mut workspace = nested_workspace();
    // Every page was edited yesterday, Checklist and Plan by the user.
    let yesterday = chrono::Utc::now() - chrono::Duration::days(1);
    for page in workspace.pages.values_mut() {
        page.last_edited_time = yesterday;
    }
    // Row was last edited by a teammate: not the user's active work.
    workspace.pages.get_mut(&nid(5)).unwrap().last_edited_by = Some("teammate".into());
    let surfaced: Arc<Mutex<Vec<ActiveImport>>> = Arc::default();
    let service = notion_service(workspace, FakeImages::default()).with_active_import_notifier({
        let surfaced = surfaced.clone();
        Arc::new(move |_, items| {
            surfaced.lock().unwrap().extend(items);
            Box::pin(async {})
        })
    });

    // An earlier import of Checklist is not part of this run.
    import_batch(&service, &[3]).await;
    let mut run = Vec::new();
    for n in [2, 5] {
        let page = service.apis.notion().0.pages[&nid(n)].clone();
        let metadata =
            serde_json::to_value(notion_doc_meta(&page, &NotionOwner::User("me".into()))).unwrap();
        service
            .stage_inner(
                &user(),
                Initiator::Onboarding,
                ImportSource::Notion,
                nid(n).as_str(),
                metadata,
                false,
            )
            .await
            .unwrap();
        let row = service
            .repo
            .rows()
            .into_iter()
            .find(|row| row.foreign_id == nid(n).as_str())
            .unwrap();
        run.push(
            service
                .repo
                .mark_importing(&user(), &[row.id])
                .await
                .unwrap()
                .pop()
                .unwrap(),
        );
    }
    let ids: Vec<uuid::Uuid> = run.iter().map(|row| row.id).collect();
    import_notion_rows(&service, &user(), run, 3).await;
    service
        .surface_active_imports(&user(), ImportSource::Notion, &ids)
        .await;

    let surfaced = surfaced.lock().unwrap();
    assert_eq!(surfaced.len(), 1);
    assert_eq!(surfaced[0].name, "Plan");
    assert_eq!(surfaced[0].source, ImportSource::Notion);
}
