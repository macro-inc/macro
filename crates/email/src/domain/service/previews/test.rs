use super::*;
use frecency::domain::models::{
    FrecencyByIdsRequest, FrecencyPageRequest, FrecencyPageResponse, FrecencyQueryErr,
};
use macro_user_id::user_id::MacroUserIdStr;

struct PanicFrecencyService;

impl FrecencyQueryService for PanicFrecencyService {
    async fn get_frecency_page(
        &self,
        _query: FrecencyPageRequest<'_>,
    ) -> Result<FrecencyPageResponse, FrecencyQueryErr> {
        panic!("frecency page lookup should not run")
    }

    async fn get_frecencies_by_ids(
        &self,
        _request: FrecencyByIdsRequest<'_>,
    ) -> Result<FrecencyPageResponse, FrecencyQueryErr> {
        panic!("frecency by-id lookup should not run")
    }
}

#[tokio::test]
async fn skips_frecency_lookup_when_not_requested() {
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let ids = [EntityType::EmailThread.with_entity_string("thread-id".to_owned())];
    let scores = get_frecency_scores(&PanicFrecencyService, false, user_id, &ids)
        .await
        .unwrap();

    assert!(scores.is_empty());
}

#[test]
fn a_request_without_a_limit_gets_the_documented_page_of_twenty() {
    assert_eq!(page_limit(None), 20);
    assert_eq!(page_limit(Some(7)), 7);
    assert_eq!(page_limit(Some(0)), 1);
    assert_eq!(page_limit(Some(501)), 500);
}

#[test]
fn authorized_threads_render_in_their_owning_inboxes_with_an_exact_id_filter() {
    let viewer = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let own_link = Uuid::from_u128(10);
    let teammate_link = Uuid::from_u128(11);

    let request = authorized_threads_request(
        viewer.clone(),
        PreviewViewStandardLabel::Spam,
        vec![first, second],
        vec![own_link, teammate_link],
    );

    assert_eq!(request.link_ids, vec![own_link, teammate_link]);
    assert_eq!(request.macro_id, viewer);
    assert_eq!(request.limit, Some(2));
    assert!(matches!(
        request.view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Spam)
    ));
    assert!(!request.include_frecency);
    assert!(request.team_receipt.is_none());
    assert!(request.crm_scope.is_none());
    let Query::Sort(SimpleSortMethod::UpdatedAt, Some(filter)) = request.query else {
        panic!("expected an updated-at sort over the thread filter");
    };
    assert_eq!(ored_thread_ids(&filter), vec![first, second]);
}

fn ored_thread_ids(expr: &Expr<EmailLiteral>) -> Vec<Uuid> {
    match expr {
        Expr::Literal(EmailLiteral::ThreadId(id)) => vec![*id],
        Expr::Or(left, right) => {
            let mut ids = ored_thread_ids(left);
            ids.extend(ored_thread_ids(right));
            ids
        }
        Expr::And(..) | Expr::Not(..) | Expr::Literal(_) => {
            panic!("the thread filter must only OR thread ids")
        }
    }
}

#[test]
fn a_short_page_that_goes_on_gets_a_cursor_below_where_the_read_walked() {
    use models_pagination::{Base64Str, Cursor, CursorVal, Paginated};

    let walked_to = (
        chrono::DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
            .unwrap()
            .with_timezone(&chrono::Utc),
        uuid::Uuid::from_u128(7),
    );
    let short: PaginatedCursor<u8, uuid::Uuid, SimpleSortMethod, ()> =
        Paginated::from_parts(vec![], None);
    let page = continued(short, Some(walked_to), 50, SimpleSortMethod::UpdatedAt);
    let cursor = page
        .next_cursor
        .expect("the list goes on")
        .decode_json()
        .unwrap();
    assert_eq!((cursor.val.last_val, cursor.id), walked_to);
    assert_eq!(cursor.limit, 50);

    // The end of the mail, and a full page's own cursor, are left as they are.
    let end: PaginatedCursor<u8, uuid::Uuid, SimpleSortMethod, ()> =
        Paginated::from_parts(vec![1], None);
    assert!(
        continued(end, None, 50, SimpleSortMethod::UpdatedAt)
            .next_cursor
            .is_none()
    );
    let own = Base64Str::encode_json(Cursor {
        id: uuid::Uuid::from_u128(1),
        limit: 1,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: walked_to.0,
        },
        filter: (),
    });
    let full: PaginatedCursor<u8, uuid::Uuid, SimpleSortMethod, ()> =
        Paginated::from_parts(vec![1], Some(own));
    let kept = continued(full, Some(walked_to), 1, SimpleSortMethod::UpdatedAt);
    assert_eq!(
        kept.next_cursor.unwrap().decode_json().unwrap().id,
        uuid::Uuid::from_u128(1)
    );
}
