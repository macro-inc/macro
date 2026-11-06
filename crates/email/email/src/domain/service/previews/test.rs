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
fn authorized_threads_render_in_their_owning_inboxes_with_an_exact_id_filter() {
    let viewer = MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap();
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let own_link = Uuid::from_u128(10);
    let teammate_link = Uuid::from_u128(11);

    let request = authorized_threads_request(
        viewer.clone(),
        vec![first, second],
        vec![own_link, teammate_link],
    );

    assert_eq!(request.link_ids, vec![own_link, teammate_link]);
    assert_eq!(request.macro_id, viewer);
    assert_eq!(request.limit, Some(2));
    assert!(matches!(
        request.view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::All)
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
