use std::{collections::VecDeque, sync::Mutex as StdMutex, time::Duration};

use chrono::{DateTime, TimeZone, Utc};
use email::domain::models::{PreviewView, PreviewViewStandardLabel};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use models_pagination::{Base64Str, Cursor, CursorWithValAndFilter, Paginated, PaginatedCursor};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::document::SoupDocument;
use soup::domain::{
    models::{
        EnrichedSoupItem, GroupedSortRequest, IntoSoupReqAst, SoupDocumentServerFacts, SoupErr,
        SoupPropertiesField, SoupType, grouping::ItemGroupingInfo,
    },
    ports::SoupOutput,
};
use uuid::Uuid;

use super::*;

/// One scripted Soup answer: its items and next cursor.
type Chunk = (Vec<SoupItem<()>>, Option<String>);

/// Answers each Soup call with the next scripted chunk and records the
/// requested page sizes. Items come with facts only from a projection call.
#[derive(Default)]
struct ChunkedSoup {
    chunks: StdMutex<VecDeque<Chunk>>,
    limits: StdMutex<Vec<u16>>,
}

impl ChunkedSoup {
    fn script(&self, chunks: Vec<Chunk>) {
        *self.chunks.lock().unwrap() = chunks.into();
    }

    fn limits(&self) -> Vec<u16> {
        self.limits.lock().unwrap().clone()
    }

    fn next_chunk<T>(
        &self,
        limit: u16,
    ) -> PaginatedCursor<SoupItem<()>, String, SimpleSortMethod, T> {
        self.limits.lock().unwrap().push(limit);
        let (items, next) = self
            .chunks
            .lock()
            .unwrap()
            .pop_front()
            .expect("an unscripted Soup call");
        Paginated::from_parts(items, next.map(Base64Str::new_from_string))
    }
}

impl SoupService for ChunkedSoup {
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        Ok(SoupOutput::Simple(self.next_chunk(req.limit)))
    }

    async fn get_user_soup_with_projection<T>(
        &self,
        req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, SoupProjectionHydration>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        Ok(
            SoupOutput::Simple(self.next_chunk(req.limit)).map(|item| SoupProjectionHydration {
                item,
                document_server_facts: Some(SoupDocumentServerFacts {
                    is_email_attachment: false,
                    is_important: true,
                    status_option_ids: Vec::new(),
                }),
                sort_key: None,
            }),
        )
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("id lists use raw Soup pages")
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("id lists use raw Soup pages")
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("id lists use raw Soup pages")
    }

    async fn get_user_soup_grouped(
        &self,
        _req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        Ok(std::iter::empty())
    }

    async fn group_labels<'a>(
        &'a self,
        _user_id: MacroUserIdStr<'a>,
        _group_by: &'a soup::domain::models::grouping::GroupByField,
        _keys: &'a [String],
    ) -> Result<soup::domain::models::grouping::GroupLabels, SoupErr> {
        Ok(Default::default())
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        unreachable!("id lists do not load tag definitions")
    }
}

fn created(n: u128) -> DateTime<Utc> {
    Utc.timestamp_opt(1_700_000_000 - n as i64, 0).unwrap()
}

fn document(n: u128) -> SoupItem<()> {
    SoupItem::Document(SoupDocument {
        appearance: None,
        id: Uuid::from_u128(n),
        document_version_id: 1,
        owner_id: Owner::from_principal_str("macro|owner@example.com").unwrap(),
        name: format!("Document {n}"),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: created(n),
        updated_at: created(n),
        viewed_at: None,
        sub_type: None,
        deleted_at: None,
        extra: (),
    })
}

/// The cursor a Soup page ending on document `n` carries.
fn cursor_after(n: u128, limit: usize) -> String {
    let cursor: CursorWithValAndFilter<String, SimpleSortMethod, EntityFilterAst> = Cursor {
        id: Uuid::from_u128(n).to_string(),
        limit,
        val: CursorVal {
            sort_type: SimpleSortMethod::CreatedAt,
            last_val: created(n),
        },
        filter: EntityFilterAst::default(),
    };
    Base64Str::encode_json(cursor).type_erase()
}

fn request(limit: u16, cursor: Option<&str>) -> SoupRequest<EntityFilterAst> {
    SoupRequest {
        soup_type: SoupType::Expanded,
        limit,
        cursor: match cursor {
            None => {
                SoupQuery::new_sort_simple(SimpleSortMethod::CreatedAt, EntityFilterAst::default())
            }
            Some(cursor) => {
                SoupQuery::new_cursor_simple(decode_simple_cursor(cursor.to_owned()).unwrap())
            }
        },
        sort_direction: SoupSortDirection::Desc,
        user: MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        link_ids: Vec::new(),
    }
}

fn key() -> SimpleSortKey {
    SimpleSortKey {
        sort: SimpleSortMethod::CreatedAt,
        filter: EntityFilterAst::default(),
    }
}

fn ids(page: &PaginatedOpaqueCursor<SoupProjectionHydration>) -> Vec<Uuid> {
    page.items.iter().map(|listed| listed.item.id()).collect()
}

async fn page_of(
    lists: &SoupLaneLists,
    soup: &ChunkedSoup,
    fields: ListedFields,
    limit: u16,
    continuation: Option<&str>,
) -> PaginatedOpaqueCursor<SoupProjectionHydration> {
    lists
        .page(
            soup,
            request(limit, continuation),
            key(),
            fields,
            continuation,
            None,
        )
        .await
        .unwrap()
}

/// A page of an ID-only lane.
async fn page(
    lists: &SoupLaneLists,
    soup: &ChunkedSoup,
    limit: u16,
    continuation: Option<&str>,
) -> PaginatedOpaqueCursor<SoupProjectionHydration> {
    page_of(lists, soup, ListedFields::Ids, limit, continuation).await
}

#[tokio::test]
async fn one_list_per_lane_serves_every_page_with_soup_cursors() {
    let soup = ChunkedSoup::default();
    soup.script(vec![
        ((1..=3).map(document).collect(), Some(cursor_after(3, 3))),
        ((4..=5).map(document).collect(), None),
    ]);
    let lists = SoupLaneLists::default();

    let first = page(&lists, &soup, 2, None).await;
    let second = page(&lists, &soup, 2, first.next_cursor.as_deref()).await;
    let last = page(&lists, &soup, 2, second.next_cursor.as_deref()).await;

    assert_eq!(
        soup.limits(),
        vec![ID_CHUNK, ID_CHUNK],
        "each part of the lane is fetched once"
    );
    assert_eq!(ids(&first), vec![Uuid::from_u128(1), Uuid::from_u128(2)]);
    assert_eq!(first.next_cursor, Some(cursor_after(2, 2)));
    assert_eq!(ids(&second), vec![Uuid::from_u128(3), Uuid::from_u128(4)]);
    assert_eq!(second.next_cursor, Some(cursor_after(4, 2)));
    assert_eq!(ids(&last), vec![Uuid::from_u128(5)]);
    assert_eq!(last.next_cursor, None);
}

#[tokio::test]
async fn a_full_last_page_ends_with_an_empty_page_like_soup_paging() {
    let soup = ChunkedSoup::default();
    soup.script(vec![((1..=2).map(document).collect(), None)]);
    let lists = SoupLaneLists::default();

    let full = page(&lists, &soup, 2, None).await;
    let empty = page(&lists, &soup, 2, full.next_cursor.as_deref()).await;

    assert_eq!(full.next_cursor, Some(cursor_after(2, 2)));
    assert!(empty.items.is_empty());
    assert_eq!(empty.next_cursor, None);
    assert_eq!(soup.limits().len(), 1);
}

#[tokio::test]
async fn a_page_that_does_not_continue_the_list_starts_a_new_one() {
    let soup = ChunkedSoup::default();
    soup.script(vec![
        ((1..=3).map(document).collect(), None),
        ((3..=4).map(document).collect(), None),
    ]);
    let lists = SoupLaneLists::default();

    page(&lists, &soup, 2, None).await;
    // A valid cursor, but not the one the list's last page returned.
    let resumed = page(&lists, &soup, 2, Some(&cursor_after(2, 3))).await;

    assert_eq!(
        soup.limits().len(),
        2,
        "an unknown cursor builds its own list"
    );
    assert_eq!(ids(&resumed), vec![Uuid::from_u128(3), Uuid::from_u128(4)]);
}

#[tokio::test]
async fn the_lane_is_fetched_as_its_pages_need_it() {
    let soup = ChunkedSoup::default();
    soup.script(vec![
        ((1..=4).map(document).collect(), Some(cursor_after(4, 4))),
        ((5..=6).map(document).collect(), None),
    ]);
    let lists = SoupLaneLists::default();

    let first = page(&lists, &soup, 2, None).await;
    let second = page(&lists, &soup, 2, first.next_cursor.as_deref()).await;
    assert_eq!(soup.limits().len(), 1, "two pages from the first statement");

    let third = page(&lists, &soup, 2, second.next_cursor.as_deref()).await;
    assert_eq!(soup.limits().len(), 2, "the next one when they are served");
    assert_eq!(ids(&third), vec![Uuid::from_u128(5), Uuid::from_u128(6)]);
}

#[tokio::test]
async fn a_lane_that_selects_fields_is_listed_with_its_projection() {
    let soup = ChunkedSoup::default();
    soup.script(vec![((1..=3).map(document).collect(), None)]);
    let lists = SoupLaneLists::default();

    let first = page_of(&lists, &soup, ListedFields::Items, 2, None).await;
    let last = page_of(
        &lists,
        &soup,
        ListedFields::Items,
        2,
        first.next_cursor.as_deref(),
    )
    .await;

    assert_eq!(
        soup.limits(),
        vec![ITEM_CHUNK],
        "one statement for both pages"
    );
    assert_eq!(first.next_cursor, Some(cursor_after(2, 2)));
    assert_eq!(ids(&last), vec![Uuid::from_u128(3)]);
    assert!(
        first
            .items
            .iter()
            .chain(&last.items)
            .all(|listed| listed.document_server_facts.is_some()),
        "items keep the facts their statement loaded"
    );
}

#[tokio::test]
async fn an_id_only_lane_is_listed_without_projection_facts() {
    let soup = ChunkedSoup::default();
    soup.script(vec![((1..=2).map(document).collect(), None)]);
    let lists = SoupLaneLists::default();

    let only = page(&lists, &soup, 5, None).await;

    assert!(
        only.items
            .iter()
            .all(|listed| listed.document_server_facts.is_none())
    );
}

#[tokio::test]
async fn a_page_that_selects_differently_starts_a_new_list() {
    let soup = ChunkedSoup::default();
    soup.script(vec![
        ((1..=3).map(document).collect(), None),
        ((3..=4).map(document).collect(), None),
    ]);
    let lists = SoupLaneLists::default();

    let first = page(&lists, &soup, 2, None).await;
    let resumed = page_of(
        &lists,
        &soup,
        ListedFields::Items,
        2,
        first.next_cursor.as_deref(),
    )
    .await;

    assert_eq!(soup.limits(), vec![ID_CHUNK, ITEM_CHUNK]);
    assert_eq!(ids(&resumed), vec![Uuid::from_u128(3), Uuid::from_u128(4)]);
}

#[tokio::test(start_paused = true)]
async fn items_fetched_too_long_ago_are_read_again_from_the_page() {
    let soup = ChunkedSoup::default();
    soup.script(vec![
        ((1..=6).map(document).collect(), None),
        ((13..=16).map(document).collect(), None),
    ]);
    let lists = SoupLaneLists::default();

    let first = page_of(&lists, &soup, ListedFields::Items, 2, None).await;
    tokio::time::advance(ITEM_LIST_MAX_AGE - Duration::from_secs(1)).await;
    let second = page_of(
        &lists,
        &soup,
        ListedFields::Items,
        2,
        first.next_cursor.as_deref(),
    )
    .await;
    assert_eq!(ids(&second), vec![Uuid::from_u128(3), Uuid::from_u128(4)]);
    assert_eq!(soup.limits().len(), 1, "still young enough to serve");

    tokio::time::advance(Duration::from_secs(1)).await;
    let third = page_of(
        &lists,
        &soup,
        ListedFields::Items,
        2,
        second.next_cursor.as_deref(),
    )
    .await;

    assert_eq!(
        soup.limits(),
        vec![ITEM_CHUNK, ITEM_CHUNK / 2],
        "the lane is read again, fewer items at once"
    );
    assert_eq!(
        ids(&third),
        vec![Uuid::from_u128(13), Uuid::from_u128(14)],
        "the page is what the new statement returned"
    );
}

#[tokio::test(start_paused = true)]
async fn ids_are_served_whatever_their_age() {
    let soup = ChunkedSoup::default();
    soup.script(vec![((1..=4).map(document).collect(), None)]);
    let lists = SoupLaneLists::default();

    let first = page(&lists, &soup, 2, None).await;
    tokio::time::advance(ITEM_LIST_MAX_AGE * 4).await;
    let second = page(&lists, &soup, 2, first.next_cursor.as_deref()).await;

    assert_eq!(soup.limits().len(), 1);
    assert_eq!(ids(&second), vec![Uuid::from_u128(3), Uuid::from_u128(4)]);
}

#[tokio::test]
async fn a_page_larger_than_a_statement_is_still_one_statement() {
    let soup = ChunkedSoup::default();
    soup.script(vec![((1..=3).map(document).collect(), None)]);
    let lists = SoupLaneLists::default();
    let limit = ITEM_CHUNK + 1;

    page_of(&lists, &soup, ListedFields::Items, limit, None).await;

    assert_eq!(soup.limits(), vec![limit]);
}
