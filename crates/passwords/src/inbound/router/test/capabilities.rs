use super::*;
use crate::domain::service::test::fakes::FakeAvailability;
use crate::outbound::availability::PASSWORDS_FLAG;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

#[tokio::test]
async fn can_edit_matches_http_value_and_totp_write_authorization() {
    let (app, repository, provider) = flagged_app(
        Ok(FlagSnapshot::new([(
            PASSWORDS_FLAG.into(),
            FlagValue::Boolean(true),
        )])),
        true,
    );
    let seed = PasswordService {
        repository: repository.clone(),
        provider,
        availability: Arc::new(FakeAvailability),
    };
    let creator = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|creator@example.com")
            .unwrap()
            .into_owned(),
    };
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|synthetic@example.test")
            .unwrap()
            .into_owned(),
    };
    let team = TeamId(Uuid::now_v7());
    for actor in [&creator, &viewer] {
        repository
            .memberships
            .lock()
            .unwrap()
            .insert(actor.user_id.to_string(), vec![team]);
    }
    let item = seed
        .create(
            &creator,
            team,
            WriteItem {
                private: true,
                operation_id: Uuid::now_v7(),
                name: "Credential".into(),
                kind: ItemKind::Login,
                url: None,
                folder_id: None,
                favorite: false,
                expected_version: None,
                values: SecretValues {
                    username: SecretString("account".into()),
                    password: SecretString("synthetic".into()),
                    notes: SecretString(String::new()),
                    fields: vec![],
                },
            },
        )
        .await
        .unwrap();
    let item_path = format!("/teams/{}/items/{}", team.0, item.id.0);
    for permission in [Permission::View, Permission::Edit] {
        seed.share(
            &creator,
            team,
            item.id,
            vec![Grant {
                kind: GranteeKind::User,
                id: viewer.user_id.to_string(),
                permission,
            }],
        )
        .await
        .unwrap();
        let editable = permission == Permission::Edit;
        let update = serde_json::json!({
            "operationId":Uuid::now_v7(), "name":"Edited", "kind":"login", "url":null,
            "folderId":null, "favorite":false, "expectedVersion":item.version,
            "values":{"username":"account","password":"updated","notes":"","fields":[]}
        });
        for (method, path, body, expected) in [
            (
                "GET",
                item_path.clone(),
                serde_json::json!({}),
                StatusCode::OK,
            ),
            (
                "GET",
                format!("/teams/{}/items", team.0),
                serde_json::json!({}),
                StatusCode::OK,
            ),
            (
                "POST",
                format!("{item_path}/reveal"),
                serde_json::json!({}),
                StatusCode::OK,
            ),
            (
                "POST",
                format!("{item_path}/copy"),
                serde_json::json!({}),
                StatusCode::OK,
            ),
            (
                "PUT",
                item_path.clone(),
                update,
                if editable {
                    StatusCode::OK
                } else {
                    StatusCode::NOT_FOUND
                },
            ),
            (
                "PUT",
                format!("{item_path}/totp"),
                serde_json::json!({"key":"JBSWY3DPEHPK3PXP"}),
                if editable {
                    StatusCode::NO_CONTENT
                } else {
                    StatusCode::NOT_FOUND
                },
            ),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&path)
                        .header("authorization", "Bearer session")
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{method} {path}");
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
            if method == "GET" {
                let bytes = to_bytes(response.into_body(), 262144).await.unwrap();
                let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                let metadata = if value.is_array() { &value[0] } else { &value };
                assert_eq!(metadata["canEdit"], editable);
                assert_eq!(metadata["canManage"], false);
            }
        }
    }
}
