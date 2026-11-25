// Synthetic REST shapes follow Notion-Version 2026-03-11:
// https://developers.notion.com/reference/view
// https://developers.notion.com/reference/retrieve-page-markdown
use super::*;
use import_notion::domain::model::*;
use import_notion::domain::ports::{NotionApi, NotionError};
use import_notion::domain::views::{NotionView, ViewScope};
use serde_json::json;

#[derive(Default)]
struct LinkedNotion {
    denied: bool,
    body: Option<&'static str>,
    body_calls: std::sync::atomic::AtomicUsize,
    source_calls: std::sync::atomic::AtomicUsize,
    container_calls: std::sync::atomic::AtomicUsize,
    view_list_calls: std::sync::atomic::AtomicUsize,
    view_calls: std::sync::atomic::AtomicUsize,
    source_gate: Option<tokio::sync::Semaphore>,
    row_calls: std::sync::atomic::AtomicUsize,
    gate: Option<tokio::sync::Semaphore>,
    fail_body: bool,
    unavailable_view: Option<NotionId>,
}
impl NotionApi for LinkedNotion {
    async fn page_markdown(&self, _: &NotionId) -> Result<PageMarkdown, NotionError> {
        self.body_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let _permit = match &self.gate {
            Some(gate) => Some(gate.acquire().await.unwrap()),
            None => None,
        };
        if self.fail_body {
            return Err(NotionError::Upstream {
                status: 503,
                body: "temporarily unavailable".into(),
            });
        }
        if let Some(body) = self.body {
            return Ok(PageMarkdown {
                markdown: body.into(),
                unknown_block_ids: vec![],
            });
        }
        Ok(PageMarkdown {
            markdown: "Before\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=cccccccccccccccccccccccccccccccc\" inline=\"true\">Linked work</database>\nBetween\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\" inline=\"true\">Linked work</database>\nAfter".into(),
            unknown_block_ids: vec![],
        })
    }
    async fn database_sources(&self, _: &NotionId) -> Result<Vec<NotionId>, NotionError> {
        self.container_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(vec![])
    }
    async fn list_views(
        &self,
        scope: &ViewScope,
        cursor: Option<String>,
    ) -> Result<Paged<NotionId>, NotionError> {
        self.view_list_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            scope,
            &ViewScope::Database(NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap())
        );
        Ok(match cursor.as_deref() {
            None => Paged {
                results: vec![NotionId::parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap()],
                next_cursor: Some("second".into()),
            },
            Some("second") => Paged {
                results: vec![NotionId::parse("cccccccccccccccccccccccccccccccc").unwrap()],
                next_cursor: None,
            },
            _ => unreachable!(),
        })
    }
    async fn retrieve_view(&self, id: &NotionId) -> Result<NotionView, NotionError> {
        self.view_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.unavailable_view.as_ref() == Some(id) {
            return Err(NotionError::NotFound);
        }
        Ok(serde_json::from_value(json!({
            "object":"view", "id":id, "name":"Work", "type":"table",
            "parent":{"type":"database_id","database_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            "data_source_id":"dddddddddddddddddddddddddddddddd"
        }))
        .unwrap())
    }
    async fn data_source(&self, id: &NotionId) -> Result<NotionDataSource, NotionError> {
        self.source_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let _permit = match &self.source_gate {
            Some(gate) => Some(gate.acquire().await.unwrap()),
            None => None,
        };
        if self.denied {
            return Err(NotionError::NotFound);
        }
        Ok(NotionDataSource {
            id: id.clone(),
            database_id: NotionId::parse("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee").unwrap(),
            title: "Work".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![],
        })
    }
    async fn search(
        &self,
        _: SearchObject,
        _: Option<String>,
    ) -> Result<Paged<SearchHit>, NotionError> {
        unreachable!()
    }
    async fn page(&self, _: &NotionId) -> Result<NotionPage, NotionError> {
        unreachable!()
    }
    async fn query_data_source(
        &self,
        _: &NotionId,
        _: Option<String>,
    ) -> Result<RowsPage, NotionError> {
        self.row_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(RowsPage {
            rows: vec![],
            next: RowsNext::End,
        })
    }
    async fn users(&self, _: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
        unreachable!()
    }
}

#[tokio::test]
async fn empty_linked_containers_use_paginated_views_and_keep_repeated_positions() {
    let page = NotionId::parse("11111111111111111111111111111111").unwrap();
    let resolved = resolve_page(
        &LinkedNotion {
            denied: false,
            ..Default::default()
        },
        &page,
    )
    .await
    .unwrap();
    assert_eq!(resolved.body.occurrences.len(), 2);
    assert_eq!(
        resolved.body.occurrences[0].sources[0].id.as_str(),
        "dddddddddddddddddddddddddddddddd"
    );
    assert_eq!(
        resolved.body.occurrences[1].sources[0].id,
        resolved.body.occurrences[0].sources[0].id
    );
    assert_eq!(
        resolved.body.occurrences[1].key.as_ref().unwrap().ordinal,
        1
    );
    let container = NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
    assert_eq!(
        resolved.views[&container][0].id().as_str(),
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
    assert_eq!(
        resolved.views[&container][1].id().as_str(),
        "cccccccccccccccccccccccccccccccc"
    );
    assert!(
        resolved
            .body
            .occurrences
            .iter()
            .all(|occurrence| occurrence.losses.is_empty())
    );
}

#[tokio::test]
async fn a_repeated_linked_source_is_one_reviewed_dependency() {
    let page = NotionId::parse("11111111111111111111111111111111").unwrap();
    let discovered = discover(
        &LinkedNotion {
            denied: false,
            ..Default::default()
        },
        Inventory {
            pages: vec![NotionPage {
                id: page.clone(),
                title: "Project".into(),
                url: page.url(),
                parent: NotionParent::Workspace,
                created: "2026-11-17T00:00:00Z".parse().unwrap(),
                last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
                in_trash: false,
                properties: Default::default(),
            }],
            data_sources: vec![],
        },
        &super::super::write::Cancel::default(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(discovered.inventory.data_sources.len(), 1);
    let source = NotionId::parse("dddddddddddddddddddddddddddddddd").unwrap();
    assert_eq!(
        discovered.dependencies[&source].referenced_by,
        vec![page.clone()]
    );
    assert_eq!(discovered.inline_on[&source], vec![page.clone()]);
    // Referencing a source already selected still records its placement, without
    // presenting it as an external dependency or creating another mapping.
    let selected = discover(
        &LinkedNotion {
            denied: false,
            ..Default::default()
        },
        discovered.inventory,
        &super::super::write::Cancel::default(),
        &|_| {},
    )
    .await
    .unwrap();
    assert!(selected.dependencies.is_empty());
    assert_eq!(selected.inventory.data_sources.len(), 1);
    assert_eq!(selected.inline_on[&source], vec![page]);
    let tree = super::super::plan::PlanTree::with_databases(&selected);
    assert_eq!(
        tree.nodes
            .iter()
            .find(|node| node.id == source)
            .unwrap()
            .inline_on,
        selected.inline_on[&source]
    );
}

#[tokio::test]
async fn an_unreadable_linked_source_remains_a_disabled_review_dependency() {
    let page = NotionId::parse("11111111111111111111111111111111").unwrap();
    let discovered = discover(
        &LinkedNotion {
            denied: true,
            ..Default::default()
        },
        Inventory {
            pages: vec![NotionPage {
                id: page.clone(),
                title: "Project".into(),
                url: page.url(),
                parent: NotionParent::Workspace,
                created: "2026-11-17T00:00:00Z".parse().unwrap(),
                last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
                in_trash: false,
                properties: Default::default(),
            }],
            data_sources: vec![],
        },
        &super::super::write::Cancel::default(),
        &|_| {},
    )
    .await
    .unwrap();
    assert!(discovered.inventory.data_sources.is_empty());
    let source = NotionId::parse("dddddddddddddddddddddddddddddddd").unwrap();
    assert_eq!(discovered.dependencies[&source].referenced_by, vec![page]);
    assert_eq!(
        discovered.dependencies[&source].unavailable,
        Some(ReadFailure::NotFound)
    );
}

mod discovery;
