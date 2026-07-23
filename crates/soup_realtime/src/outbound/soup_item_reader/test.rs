use std::io;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::{document::SoupDocument, item::SoupItem};
use soup::domain::{
    models::{
        AdvancedSortParams, GroupedSortRequest, SimpleSortRequest, SoupPropertiesField,
        grouping::ItemGroupingInfo,
    },
    ports::SoupRepo,
};
use uuid::Uuid;

use super::*;

const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";

type RecordedQuery = (String, Vec<(String, EntityType)>);
type RecordedQueries = Arc<Mutex<Vec<RecordedQuery>>>;

struct RecordingSoupRepo {
    calls: RecordedQueries,
    items: Mutex<Option<Result<Vec<SoupItem<()>>, io::Error>>>,
}

impl SoupRepo for RecordingSoupRepo {
    type Err = io::Error;
    type GroupedItems = std::vec::IntoIter<ItemGroupingInfo>;

    async fn expanded_generic_cursor_soup<'a>(
        &self,
        _req: SimpleSortRequest<'a>,
    ) -> Result<Vec<SoupItem<()>>, Self::Err> {
        unreachable!("unexpected generic cursor query")
    }

    async fn unexpanded_generic_cursor_soup<'a>(
        &self,
        _req: SimpleSortRequest<'a>,
    ) -> Result<Vec<SoupItem<()>>, Self::Err> {
        unreachable!("unexpected generic cursor query")
    }

    async fn expanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> Result<Vec<SoupItem<()>>, Self::Err> {
        self.calls.lock().expect("calls lock").push((
            req.user_id.as_ref().to_string(),
            req.entities
                .iter()
                .map(|entity| (entity.entity_id.to_string(), entity.entity_type))
                .collect(),
        ));
        self.items
            .lock()
            .expect("items lock")
            .take()
            .expect("one expanded query expected")
    }

    async fn unexpanded_soup_by_ids<'a>(
        &self,
        _req: AdvancedSortParams<'a>,
    ) -> Result<Vec<SoupItem<()>>, Self::Err> {
        unreachable!("unexpected unexpanded query")
    }

    async fn populate_properties<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
        _items: Vec<SoupItem<()>>,
    ) -> Result<Vec<SoupItem<SoupPropertiesField>>, Self::Err> {
        unreachable!("unexpected properties query")
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, Self::Err> {
        unreachable!("unexpected tag query")
    }

    async fn expanded_grouped_cursor_soup<'a>(
        &self,
        _req: GroupedSortRequest<'a>,
    ) -> Result<Self::GroupedItems, Self::Err> {
        unreachable!("unexpected grouped query")
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|reader@example.com".to_string()).expect("valid user id")
}

fn timestamp(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).expect("valid timestamp")
}

fn document_item(id: &str, viewed_at: Option<DateTime<Utc>>) -> SoupItem<()> {
    SoupItem::Document(SoupDocument {
        id: Uuid::parse_str(id).expect("valid document id"),
        document_version_id: 7,
        owner_id: user(),
        name: "Realtime document".to_string(),
        file_type: Some("md".to_string()),
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: timestamp(1),
        updated_at: timestamp(2),
        viewed_at,
        sub_type: None,
        deleted_at: None,
        extra: (),
    })
}

fn reader_with(
    items: Result<Vec<SoupItem<()>>, io::Error>,
) -> (SoupRepoItemReader<RecordingSoupRepo>, RecordedQueries) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let repo = RecordingSoupRepo {
        calls: calls.clone(),
        items: Mutex::new(Some(items)),
    };
    (SoupRepoItemReader::new(repo), calls)
}

#[tokio::test]
async fn uses_expanded_query_for_requested_user_and_entity() {
    let viewed_at = Some(timestamp(3));
    let (reader, calls) = reader_with(Ok(vec![document_item(DOCUMENT_ID, viewed_at)]));
    let entity = EntityType::Document.with_entity_string(DOCUMENT_ID.to_string());

    let item = reader
        .read_for_user(user(), &entity)
        .await
        .expect("read succeeds")
        .expect("item exists");

    match item {
        SoupItem::Document(document) => {
            assert_eq!(document.name, "Realtime document");
            assert_eq!(document.viewed_at, viewed_at);
        }
        _ => panic!("expected document item"),
    }
    assert_eq!(
        calls.lock().expect("calls lock").as_slice(),
        &[(
            "macro|reader@example.com".to_string(),
            vec![(DOCUMENT_ID.to_string(), EntityType::Document)]
        )]
    );
}

#[tokio::test]
async fn returns_none_when_requested_item_is_absent() {
    let other_id = "00000000-0000-0000-0000-000000000002";
    let (reader, _) = reader_with(Ok(vec![document_item(other_id, None)]));
    let entity = EntityType::Document.with_entity_string(DOCUMENT_ID.to_string());

    assert!(
        reader
            .read_for_user(user(), &entity)
            .await
            .expect("read succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn rejects_duplicate_matching_items() {
    let (reader, _) = reader_with(Ok(vec![
        document_item(DOCUMENT_ID, None),
        document_item(DOCUMENT_ID, Some(timestamp(4))),
    ]));
    let entity = EntityType::Document.with_entity_string(DOCUMENT_ID.to_string());

    reader
        .read_for_user(user(), &entity)
        .await
        .expect_err("duplicate items violate the repository contract");
}

#[tokio::test]
async fn rejects_non_document_entities_without_querying() {
    let (reader, calls) = reader_with(Ok(Vec::new()));
    let entity = EntityType::Project.with_entity_string(DOCUMENT_ID.to_string());

    reader
        .read_for_user(user(), &entity)
        .await
        .expect_err("projects are unsupported");
    assert!(calls.lock().expect("calls lock").is_empty());
}

#[tokio::test]
async fn propagates_repository_failures() {
    let (reader, _) = reader_with(Err(io::Error::other("query unavailable")));
    let entity = EntityType::Document.with_entity_string(DOCUMENT_ID.to_string());

    reader
        .read_for_user(user(), &entity)
        .await
        .expect_err("repository failure propagates");
}
