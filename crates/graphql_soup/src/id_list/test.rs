use std::{collections::VecDeque, sync::Mutex as StdMutex};

use chrono::{DateTime, TimeZone, Utc};
use email::domain::models::{PreviewView, PreviewViewStandardLabel};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use models_pagination::{Base64Str, Cursor, CursorWithValAndFilter, Paginated, PaginatedCursor};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::document::SoupDocument;
use soup::domain::{
    models::{
        EnrichedSoupItem, GroupedSortRequest, IntoSoupReqAst, SoupErr, SoupPropertiesField,
        SoupType, grouping::ItemGroupingInfo,
    },
    ports::SoupOutput,
};
use uuid::Uuid;

use super::*;

/// Answers each `get_user_soup` call with the next scripted chunk and records
/// the requested page sizes.
#[derive(Default)]
struct ChunkedSoup {
    chunks: StdMutex<VecDeque<(Vec<SoupItem<()>>, Option<String>)>>,
    limits: StdMutex<Vec<u16>>,
}

impl ChunkedSoup {
    fn script(&self, chunks: Vec<(Vec<SoupItem<()>>, Option<String>)>) {
        *self.chunks.lock().unwrap() = chunks.into();
    }

    fn limits(&self) -> Vec<u16> {
        self.limits.lock().unwrap().clone()
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
        self.limits.lock().unwrap().push(req.limit);
        let (items, next) = self
            .chunks
            .lock()
            .unwrap()
            .pop_front()
            .expect("an unscripted Soup call");
        let page: PaginatedCursor<SoupItem<()>, String, SimpleSortMethod, T> =
            Paginated::from_parts(items, next.map(Base64Str::new_from_string));
        Ok(SoupOutput::Simple(page))
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

fn ids(page: &PaginatedOpaqueCursor<SoupItem<()>>) -> Vec<Uuid> {
    page.items.iter().map(Identify::id).collect()
}

async fn page(
    lists: &SoupIdLists,
    soup: &ChunkedSoup,
    limit: u16,
    continuation: Option<&str>,
) -> PaginatedOpaqueCursor<SoupItem<()>> {
    lists
        .page(
            soup,
            request(limit, continuation),
            key(),
            continuation,
            None,
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn one_list_per_lane_serves_every_page_with_soup_cursors() {
    let soup = ChunkedSoup::default();
    soup.script(vec![
        ((1..=3).map(document).collect(), Some(cursor_after(3, 3))),
        ((4..=5).map(document).collect(), None),
    ]);
    let lists = SoupIdLists::default();

    let first = page(&lists, &soup, 2, None).await;
    let second = page(&lists, &soup, 2, first.next_cursor.as_deref()).await;
    let last = page(&lists, &soup, 2, second.next_cursor.as_deref()).await;

    assert_eq!(
        soup.limits(),
        vec![LIST_CHUNK, LIST_CHUNK],
        "the list is fetched once"
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
    let lists = SoupIdLists::default();

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
    let lists = SoupIdLists::default();

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
