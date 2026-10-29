use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use chrono::{TimeZone, Utc};

use super::{full_markdown, inventory};
use crate::domain::model::{
    DataSourceSummary, ImportScope, Inventory, InventoryProgress, NotionDataSource, NotionId,
    NotionPage, NotionParent, NotionUser, PageMarkdown, Paged, SearchHit, SearchObject,
};
use crate::domain::ports::{NotionApi, NotionError};

/// A workspace held in memory. Searches return everything on one page.
#[derive(Default)]
struct FakeWorkspace {
    pages: Vec<NotionPage>,
    data_sources: Vec<NotionDataSource>,
    /// Data sources a database container holds, by database id.
    databases: HashMap<NotionId, Vec<NotionId>>,
    /// Rows by data source id; the first page of a query.
    rows: HashMap<NotionId, Paged<NotionPage>>,
    /// The page after the first, by data source id, for any cursor.
    later_rows: HashMap<NotionId, Vec<NotionPage>>,
    markdown: HashMap<NotionId, PageMarkdown>,
    /// Ids that are databases, which Notion refuses to render as markdown.
    databases_not_pages: Vec<NotionId>,
    markdown_requests: Mutex<Vec<NotionId>>,
    /// Every search, by object type.
    searches: Mutex<Vec<SearchObject>>,
    /// Every data source query, by data source id.
    queries: Mutex<Vec<NotionId>>,
}

impl NotionApi for FakeWorkspace {
    async fn search(
        &self,
        object: SearchObject,
        _cursor: Option<String>,
    ) -> Result<Paged<SearchHit>, NotionError> {
        self.searches.lock().unwrap().push(object);
        let results = match object {
            SearchObject::Page => self.pages.iter().cloned().map(SearchHit::Page).collect(),
            SearchObject::DataSource => self
                .data_sources
                .iter()
                .cloned()
                .map(SearchHit::DataSource)
                .collect(),
        };
        Ok(Paged {
            results,
            next_cursor: None,
        })
    }

    async fn page(&self, id: &NotionId) -> Result<NotionPage, NotionError> {
        self.pages
            .iter()
            .find(|page| &page.id == id)
            .cloned()
            .ok_or(NotionError::NotFound)
    }

    async fn page_markdown(&self, id: &NotionId) -> Result<PageMarkdown, NotionError> {
        self.markdown_requests.lock().unwrap().push(id.clone());
        if self.databases_not_pages.contains(id) {
            return Err(NotionError::Upstream {
                status: 400,
                body: "Provided ID is a database, not a page.".into(),
            });
        }
        self.markdown.get(id).cloned().ok_or(NotionError::NotFound)
    }

    async fn data_source(&self, id: &NotionId) -> Result<NotionDataSource, NotionError> {
        self.data_sources
            .iter()
            .find(|source| &source.id == id)
            .cloned()
            .ok_or(NotionError::NotFound)
    }

    async fn database_sources(&self, database: &NotionId) -> Result<Vec<NotionId>, NotionError> {
        self.databases
            .get(database)
            .cloned()
            .ok_or(NotionError::NotFound)
    }

    async fn query_data_source(
        &self,
        id: &NotionId,
        cursor: Option<String>,
    ) -> Result<Paged<NotionPage>, NotionError> {
        self.queries.lock().unwrap().push(id.clone());
        if cursor.is_some() {
            return Ok(Paged {
                results: self.later_rows.get(id).cloned().unwrap_or_default(),
                next_cursor: None,
            });
        }
        Ok(self.rows.get(id).cloned().unwrap_or(Paged {
            results: Vec::new(),
            next_cursor: None,
        }))
    }

    async fn users(&self, _cursor: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
        Ok(Paged {
            results: Vec::new(),
            next_cursor: None,
        })
    }
}

#[tokio::test]
async fn everything_lists_documents_and_data_sources_with_rows_counted_from_search() {
    let plan = NotionPage {
        id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
        title: "Q3 plan".into(),
        url: "https://www.notion.so/598337872cf94fdf8782e53db20768a5".into(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 3, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let trashed = NotionPage {
        id: NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap(),
        title: "Old notes".into(),
        url: "https://www.notion.so/c7f0aa501f0e4a529a17e2f6f3a3b0c1".into(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 1, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
        in_trash: true,
        properties: BTreeMap::new(),
    };
    let row = NotionPage {
        id: NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap(),
        title: "Ship onboarding".into(),
        url: "https://www.notion.so/ee5f0f84409a440f983aa5315961c6e4".into(),
        parent: NotionParent::DataSource {
            data_source: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
            database: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 2, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let roadmap = NotionDataSource {
        id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
        database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        title: "Roadmap".into(),
        database_parent: NotionParent::Page {
            id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
        },
        in_trash: false,
        properties: vec![],
    };
    let workspace = FakeWorkspace {
        pages: vec![plan.clone(), trashed, row.clone()],
        data_sources: vec![roadmap.clone()],
        rows: HashMap::from([(
            roadmap.id.clone(),
            Paged {
                results: vec![row.clone()],
                next_cursor: Some("more".into()),
            },
        )]),
        later_rows: HashMap::from([(
            roadmap.id.clone(),
            vec![NotionPage {
                id: NotionId::parse("7d0c5bd5b4a04f3a9c7d0c5bd5b4a04f").unwrap(),
                title: "Ship billing".into(),
                ..row.clone()
            }],
        )]),
        ..FakeWorkspace::default()
    };
    let reports = Mutex::new(Vec::new());

    let found = inventory(&workspace, &ImportScope::Everything, &|progress| {
        reports.lock().unwrap().push(progress)
    })
    .await
    .unwrap();

    // Search listed the roadmap's one row, so its rows are not queried
    // (a query would have found a second).
    assert_eq!(
        found,
        Inventory {
            pages: vec![plan],
            data_sources: vec![DataSourceSummary {
                source: roadmap,
                row_count: 1,
                sample_titles: vec!["Ship onboarding".into()],
            }],
        }
    );
    assert_eq!(*workspace.queries.lock().unwrap(), Vec::<NotionId>::new());
    assert_eq!(
        reports.into_inner().unwrap(),
        vec![
            InventoryProgress {
                pages: 1,
                data_sources: 0,
            },
            InventoryProgress {
                pages: 1,
                data_sources: 1,
            },
            InventoryProgress {
                pages: 1,
                data_sources: 1,
            },
        ]
    );
}

#[tokio::test]
async fn roots_keep_their_descendants_through_rows_and_databases() {
    // root page
    //   └ database d98… / data source 1a4… (Roadmap)
    //       └ row ee5…
    //           └ page under the row 9a3…
    //   └ column block b10…
    //       └ page in a column a1b…
    // unrelated page c7f…
    let root = NotionPage {
        id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
        title: "Team".into(),
        url: "https://www.notion.so/598337872cf94fdf8782e53db20768a5".into(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 3, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let row = NotionPage {
        id: NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap(),
        title: "Ship onboarding".into(),
        url: "https://www.notion.so/ee5f0f84409a440f983aa5315961c6e4".into(),
        parent: NotionParent::DataSource {
            data_source: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
            database: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 2, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let under_row = NotionPage {
        id: NotionId::parse("9a3b5ae0c6e6482db0e1ed315ee6dc57").unwrap(),
        title: "Onboarding spec".into(),
        url: "https://www.notion.so/9a3b5ae0c6e6482db0e1ed315ee6dc57".into(),
        parent: NotionParent::Page {
            id: NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap(),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 2, 3, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 2, 3, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let in_column = NotionPage {
        id: NotionId::parse("a1b2c3d4000040008000000000000001").unwrap(),
        title: "Column page".into(),
        url: "https://www.notion.so/a1b2c3d4000040008000000000000001".into(),
        parent: NotionParent::Block {
            id: NotionId::parse("b1000000000040008000000000000000").unwrap(),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 2, 4, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 2, 4, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let unrelated = NotionPage {
        id: NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap(),
        title: "Elsewhere".into(),
        url: "https://www.notion.so/c7f0aa501f0e4a529a17e2f6f3a3b0c1".into(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 1, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let roadmap = NotionDataSource {
        id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
        database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        title: "Roadmap".into(),
        database_parent: NotionParent::Page {
            id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
        },
        in_trash: false,
        properties: vec![],
    };
    let workspace = FakeWorkspace {
        pages: vec![
            root.clone(),
            row,
            under_row.clone(),
            in_column.clone(),
            unrelated,
        ],
        data_sources: vec![roadmap.clone()],
        ..FakeWorkspace::default()
    };

    let found = inventory(
        &workspace,
        &ImportScope::Roots {
            ids: vec![root.id.clone()],
        },
        &|_| {},
    )
    .await
    .unwrap();

    // The column block's owning page is not knowable from search results.
    let titles: Vec<&str> = found.pages.iter().map(|page| page.title.as_str()).collect();
    assert_eq!(titles, vec!["Team", "Onboarding spec"]);
    assert_eq!(
        found.data_sources,
        vec![DataSourceSummary {
            source: roadmap,
            row_count: 1,
            sample_titles: vec!["Ship onboarding".into()],
        }]
    );
}

#[tokio::test]
async fn a_database_root_missing_from_search_is_expanded_into_its_data_sources() {
    let tasks = NotionDataSource {
        id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
        database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        title: "Tasks".into(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![],
    };
    let archive = NotionDataSource {
        id: NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap(),
        database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        title: "Archive".into(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![],
    };
    let other = NotionDataSource {
        id: NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap(),
        database_id: NotionId::parse("9a3b5ae0c6e6482db0e1ed315ee6dc57").unwrap(),
        title: "Other".into(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![],
    };
    // Search only finds the unrelated data source; the root database's
    // sources are reachable by id.
    struct PartialSearch(FakeWorkspace);
    impl NotionApi for PartialSearch {
        async fn search(
            &self,
            object: SearchObject,
            _cursor: Option<String>,
        ) -> Result<Paged<SearchHit>, NotionError> {
            let results = match object {
                SearchObject::Page => vec![],
                SearchObject::DataSource => {
                    vec![SearchHit::DataSource(self.0.data_sources[2].clone())]
                }
            };
            Ok(Paged {
                results,
                next_cursor: None,
            })
        }
        async fn page(&self, id: &NotionId) -> Result<NotionPage, NotionError> {
            self.0.page(id).await
        }
        async fn page_markdown(&self, id: &NotionId) -> Result<PageMarkdown, NotionError> {
            self.0.page_markdown(id).await
        }
        async fn data_source(&self, id: &NotionId) -> Result<NotionDataSource, NotionError> {
            self.0.data_source(id).await
        }
        async fn database_sources(
            &self,
            database: &NotionId,
        ) -> Result<Vec<NotionId>, NotionError> {
            self.0.database_sources(database).await
        }
        async fn query_data_source(
            &self,
            id: &NotionId,
            cursor: Option<String>,
        ) -> Result<Paged<NotionPage>, NotionError> {
            self.0.query_data_source(id, cursor).await
        }
        async fn users(&self, cursor: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
            self.0.users(cursor).await
        }
    }
    let workspace = PartialSearch(FakeWorkspace {
        data_sources: vec![tasks.clone(), archive.clone(), other],
        databases: HashMap::from([(
            NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
            vec![tasks.id.clone(), archive.id.clone()],
        )]),
        ..FakeWorkspace::default()
    });

    let found = inventory(
        &workspace,
        &ImportScope::Roots {
            ids: vec![NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap()],
        },
        &|_| {},
    )
    .await
    .unwrap();

    let titles: Vec<&str> = found
        .data_sources
        .iter()
        .map(|summary| summary.source.title.as_str())
        .collect();
    assert_eq!(titles, vec!["Tasks", "Archive"]);
    assert_eq!(found.pages, vec![]);
    // Search never listed them, so only a query can count their rows.
    assert_eq!(
        *workspace.0.queries.lock().unwrap(),
        vec![tasks.id.clone(), archive.id.clone()]
    );
}

#[tokio::test]
async fn a_data_source_search_shows_no_rows_for_is_queried_page_by_page() {
    let roadmap = NotionDataSource {
        id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
        database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        title: "Roadmap".into(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![],
    };
    let row = NotionPage {
        id: NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap(),
        title: "Ship onboarding".into(),
        url: "https://www.notion.so/ee5f0f84409a440f983aa5315961c6e4".into(),
        parent: NotionParent::DataSource {
            data_source: roadmap.id.clone(),
            database: roadmap.database_id.clone(),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 2, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let workspace = FakeWorkspace {
        data_sources: vec![roadmap.clone()],
        rows: HashMap::from([(
            roadmap.id.clone(),
            Paged {
                results: vec![row.clone()],
                next_cursor: Some("more".into()),
            },
        )]),
        later_rows: HashMap::from([(
            roadmap.id.clone(),
            vec![NotionPage {
                id: NotionId::parse("7d0c5bd5b4a04f3a9c7d0c5bd5b4a04f").unwrap(),
                title: "Ship billing".into(),
                ..row
            }],
        )]),
        ..FakeWorkspace::default()
    };

    let found = inventory(&workspace, &ImportScope::Everything, &|_| {})
        .await
        .unwrap();

    assert_eq!(
        found.data_sources,
        vec![DataSourceSummary {
            source: roadmap.clone(),
            row_count: 2,
            sample_titles: vec!["Ship onboarding".into(), "Ship billing".into()],
        }]
    );
    assert_eq!(
        *workspace.queries.lock().unwrap(),
        vec![roadmap.id.clone(), roadmap.id]
    );
}

#[tokio::test]
async fn a_workspace_whose_rows_search_lists_costs_two_searches_and_no_row_queries() {
    // Three databases of three rows each, under one page. Counting rows by
    // querying cost a query per data source (and per hundred rows) on top
    // of the searches: 3 here, and 24 data sources with 3,900 rows cost at
    // least 54 on a real workspace.
    let home = NotionPage {
        id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
        title: "Home".into(),
        url: "https://www.notion.so/598337872cf94fdf8782e53db20768a5".into(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 3, 2, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    };
    let sources: Vec<NotionDataSource> = ["1", "2", "3"]
        .into_iter()
        .map(|digit| NotionDataSource {
            id: NotionId::parse(&format!("{digit}a44be1209534631a1d67d4c2b1b4a2f")).unwrap(),
            database_id: NotionId::parse(&format!("{digit}9824bdc84454327be8b5b47500af6ce"))
                .unwrap(),
            title: format!("Tracker {digit}"),
            database_parent: NotionParent::Page {
                id: home.id.clone(),
            },
            in_trash: false,
            properties: vec![],
        })
        .collect();
    let mut pages = vec![home.clone()];
    for (source_index, source) in sources.iter().enumerate() {
        for row_index in 0..3 {
            pages.push(NotionPage {
                id: NotionId::parse(&format!(
                    "{source_index}{row_index}5f0f84409a440f983aa5315961c6e4"
                ))
                .unwrap(),
                title: format!("Row {row_index}"),
                parent: NotionParent::DataSource {
                    data_source: source.id.clone(),
                    database: source.database_id.clone(),
                },
                ..home.clone()
            });
        }
    }
    let workspace = FakeWorkspace {
        pages,
        data_sources: sources.clone(),
        ..FakeWorkspace::default()
    };

    let found = inventory(&workspace, &ImportScope::Everything, &|_| {})
        .await
        .unwrap();

    assert_eq!(found.pages, vec![home]);
    assert_eq!(
        found
            .data_sources
            .iter()
            .map(|summary| (summary.source.title.as_str(), summary.row_count))
            .collect::<Vec<_>>(),
        vec![("Tracker 1", 3), ("Tracker 2", 3), ("Tracker 3", 3)]
    );
    assert_eq!(
        *workspace.searches.lock().unwrap(),
        vec![SearchObject::Page, SearchObject::DataSource]
    );
    assert_eq!(*workspace.queries.lock().unwrap(), Vec::<NotionId>::new());
}

#[tokio::test]
async fn full_markdown_splices_unknown_blocks_into_their_placeholders() {
    let page = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    let toggle = NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap();
    let nested = NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap();
    let orphan = NotionId::parse("9a3b5ae0c6e6482db0e1ed315ee6dc57").unwrap();
    let workspace = FakeWorkspace {
        markdown: HashMap::from([
            (
                page.clone(),
                PageMarkdown {
                    markdown: "# Plan\n\n<unknown url=\"https://www.notion.so/598337872cf94fdf8782e53db20768a5#c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1\" alt=\"toggle\"/>\n\nEnd".into(),
                    unknown_block_ids: vec![toggle.clone(), orphan.clone()],
                },
            ),
            (
                toggle,
                PageMarkdown {
                    markdown: "<details>\n<summary>More</summary>\n<unknown url=\"https://www.notion.so/x#ee5f0f84409a440f983aa5315961c6e4\" alt=\"table\"/>\n</details>\n".into(),
                    unknown_block_ids: vec![nested.clone()],
                },
            ),
            (
                nested,
                PageMarkdown {
                    markdown: "| a | b |".into(),
                    unknown_block_ids: vec![],
                },
            ),
            (
                orphan,
                PageMarkdown {
                    markdown: "Trailing block".into(),
                    unknown_block_ids: vec![],
                },
            ),
        ]),
        ..FakeWorkspace::default()
    };

    let markdown = full_markdown(&workspace, &page).await.unwrap();

    assert_eq!(
        markdown,
        "# Plan\n\n<details>\n<summary>More</summary>\n| a | b |\n</details>\n\nEnd\n\nTrailing block"
    );
    assert_eq!(workspace.markdown_requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn full_markdown_keeps_the_placeholder_of_an_unreadable_block() {
    let page = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    let workspace = FakeWorkspace {
        markdown: HashMap::from([(
            page.clone(),
            PageMarkdown {
                markdown: "Intro <unknown alt=\"c7f0aa501f0e4a529a17e2f6f3a3b0c1\"/>".into(),
                unknown_block_ids: vec![
                    NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap(),
                ],
            },
        )]),
        ..FakeWorkspace::default()
    };

    let markdown = full_markdown(&workspace, &page).await.unwrap();

    assert_eq!(
        markdown,
        "Intro <unknown alt=\"c7f0aa501f0e4a529a17e2f6f3a3b0c1\"/>"
    );
}

#[tokio::test]
async fn a_database_embedded_in_a_page_keeps_its_placeholder_instead_of_failing_the_page() {
    let page = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    let embedded = NotionId::parse("e617ab741aa546b19d317930ff338b29").unwrap();
    let workspace = FakeWorkspace {
        markdown: HashMap::from([(
            page.clone(),
            PageMarkdown {
                markdown: "Welcome <unknown alt=\"e617ab741aa546b19d317930ff338b29\"/> Outro"
                    .into(),
                unknown_block_ids: vec![embedded.clone()],
            },
        )]),
        databases_not_pages: vec![embedded],
        ..FakeWorkspace::default()
    };

    let markdown = full_markdown(&workspace, &page).await.unwrap();

    assert_eq!(
        markdown,
        "Welcome <unknown alt=\"e617ab741aa546b19d317930ff338b29\"/> Outro"
    );
}
