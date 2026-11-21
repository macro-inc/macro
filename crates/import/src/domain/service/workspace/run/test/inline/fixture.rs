use super::*;
use import_notion::domain::views::{NotionView, ViewScope};

#[derive(Default)]
pub(super) struct Inline {
    pub(super) external_rows: usize,
    pub(super) external_title: Option<String>,
    pub(super) transient_query: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub(super) incomplete_views: bool,
    pub(super) query_failures: std::collections::HashMap<NotionId, u16>,
    pub(super) notion_reads: Option<Arc<Mutex<Vec<(NotionId, bool)>>>>,
}
impl NotionApi for Inline {
    async fn page(&self, id: &NotionId) -> std::result::Result<NotionPage, NotionError> {
        let original = if self.external_rows > 0 {
            page_id('f')
        } else {
            id.clone()
        };
        let mut page = Pages::default().page(&original).await?;
        if self.external_rows > 0 {
            page.id = id.clone();
            page.url = id.url();
        }
        page.title = "Row".into();
        page.parent = NotionParent::DataSource {
            data_source: page_id('d'),
            database: page_id('a'),
        };
        Ok(page)
    }
    async fn page_markdown(&self, id: &NotionId) -> std::result::Result<PageMarkdown, NotionError> {
        let markdown = if *id == page_id('e') {
            "Before\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=cccccccccccccccccccccccccccccccc\" inline=\"true\">Work</database>\nBetween\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\" inline=\"true\">Work</database>\nAfter".to_owned()
        } else if self.external_rows > 0 {
            format!(
                "<database url=\"https://www.notion.so/66666666666666666666666666666666\">{}</database>",
                self.external_title.as_deref().unwrap_or("External plans")
            )
        } else {
            "Row before\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\" inline=\"true\">Work</database>\nRow after".to_owned()
        };
        Ok(PageMarkdown {
            markdown,
            unknown_block_ids: vec![],
        })
    }
    async fn data_source(
        &self,
        id: &NotionId,
    ) -> std::result::Result<NotionDataSource, NotionError> {
        if let Some(reads) = &self.notion_reads {
            reads.lock().unwrap().push((id.clone(), true));
        }
        Ok(NotionDataSource {
            id: id.clone(),
            database_id: if *id == page_id('d') {
                page_id('a')
            } else {
                page_id('6')
            },
            title: "Work".into(),
            database_parent: if *id == page_id('d') {
                NotionParent::Page { id: page_id('e') }
            } else {
                NotionParent::Workspace
            },
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "title".into(),
                name: "Name".into(),
                kind: NotionPropertyKind::Title,
            }],
        })
    }
    async fn database_sources(
        &self,
        container: &NotionId,
    ) -> std::result::Result<Vec<NotionId>, NotionError> {
        if self.external_rows > 0 && *container == page_id('6') {
            return Ok(vec![page_id('7')]);
        }
        Ok(vec![page_id('d')])
    }
    async fn list_views(
        &self,
        scope: &ViewScope,
        _: Option<String>,
    ) -> std::result::Result<Paged<NotionId>, NotionError> {
        if self.incomplete_views
            && matches!(scope, ViewScope::DataSource(id) if *id == page_id('d'))
        {
            return Err(NotionError::IncompleteViewList);
        }
        if self.external_rows > 0 && matches!(scope, ViewScope::Database(id) if *id == page_id('6'))
        {
            return Ok(Paged {
                results: vec![page_id('8')],
                next_cursor: None,
            });
        }
        if matches!(scope, ViewScope::DataSource(id) if *id != page_id('d')) {
            return Ok(Paged {
                results: vec![],
                next_cursor: None,
            });
        }
        Ok(Paged {
            results: vec![page_id('b'), page_id('c')],
            next_cursor: None,
        })
    }
    async fn retrieve_view(&self, id: &NotionId) -> std::result::Result<NotionView, NotionError> {
        if self.external_rows > 0 && *id == page_id('8') {
            return Ok(serde_json::from_value(serde_json::json!({"object":"view", "id":id, "name":"External plans", "type":"table", "parent":{"database_id":page_id('6')}, "data_source_id":page_id('7')})).unwrap());
        }
        Ok(serde_json::from_value(serde_json::json!({
            "object":"view", "id":id, "name":"Work", "type":"table",
            "parent":{"database_id":page_id('a')}, "data_source_id":page_id('d'),
            "filter": if *id == page_id('c') { Some(serde_json::json!({"property":"unknown", "people":{"contains":"me"}})) } else { None },
        })).unwrap())
    }
    async fn query_data_source(
        &self,
        id: &NotionId,
        _: Option<String>,
    ) -> std::result::Result<RowsPage, NotionError> {
        if let Some(status) = self.query_failures.get(id) {
            if let Some(reads) = &self.notion_reads {
                reads.lock().unwrap().push((id.clone(), false));
            }
            return Err(NotionError::Upstream {
                status: *status,
                body: "private query payload".into(),
            });
        }
        if self
            .transient_query
            .as_ref()
            .is_some_and(|fail| fail.swap(false, std::sync::atomic::Ordering::SeqCst))
        {
            return Err(NotionError::Upstream {
                status: 503,
                body: format!("temporarily unavailable for {id}"),
            });
        }
        let rows = if *id == page_id('d') {
            if self.external_rows == 0 {
                vec![self.page(&page_id('f')).await?]
            } else {
                let mut rows = Vec::new();
                for n in 1..=self.external_rows {
                    rows.push(
                        self.page(&NotionId::parse(&format!("{n:032x}")).unwrap())
                            .await?,
                    );
                }
                rows
            }
        } else {
            vec![]
        };
        Ok(RowsPage {
            rows,
            next: RowsNext::End,
        })
    }
    async fn users(
        &self,
        _: Option<String>,
    ) -> std::result::Result<Paged<NotionUser>, NotionError> {
        Ok(Paged {
            results: vec![],
            next_cursor: None,
        })
    }
    async fn search(
        &self,
        _: SearchObject,
        _: Option<String>,
    ) -> std::result::Result<Paged<SearchHit>, NotionError> {
        unreachable!("approved snapshot")
    }
}
pub(super) struct InlineConnected;
impl NotionConnections for InlineConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline::default()))
    }
}
