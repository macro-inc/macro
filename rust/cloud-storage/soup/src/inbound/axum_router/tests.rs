use axum::{
    Extension, Router,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use model_user::UserContext;
use serde_json::json;
use tower::util::ServiceExt;

use crate::{
    domain::{
        models::SoupErr,
        ports::{SoupOutput, SoupService},
    },
    inbound::axum_router::{SoupRouterState, soup_router},
};

static CURSOR: &str = "eyJpZCI6ImUzNmM5MTJlLTU2M2MtNDIxZS1iMTAzLWE0YjAwY2ZmMzBlZSIsImxpbWl0IjoxMDAsInZhbCI6eyJzb3J0X3R5cGUiOiJ1cGRhdGVkX2F0IiwibGFzdF92YWwiOiIyMDI1LTExLTA3VDE5OjEyOjU5Ljc4MFoifX0=";

struct MockSoup;

impl SoupService for MockSoup {
    async fn get_user_soup(
        &self,
        _req: crate::domain::models::SoupRequest,
    ) -> Result<SoupOutput, SoupErr> {
        Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
    }
}

fn mock_router() -> Router {
    soup_router(SoupRouterState::new(MockSoup)).layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }))
}

#[tokio::test]
async fn it_should_deserialize_empty_filter() {
    let router = mock_router();

    let request = Request::builder()
        .uri(format!("/soup?cursor={CURSOR}"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(bytes.as_ref()).unwrap();
    assert_eq!(
        json,
        json!({
            "message": "An internal server error has occurred"
        })
    );
}
