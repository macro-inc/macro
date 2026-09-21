use super::*;
use crate::domain::ports::editing::MockEditingWorkerService;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use models_permissions::share_permission::access_level::AccessLevel;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "local-spreadsheet-test-secret";
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|sheets@macro.com".to_owned()).unwrap()
}
fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}
fn request() -> SpreadsheetRequest {
    SpreadsheetRequest::Read {
        sheet_id: None,
        ranges: None,
        include_styles: None,
    }
}
fn response() -> SpreadsheetResponse {
    SpreadsheetResponse::Read {
        revision: "revision".into(),
        sheets: vec![],
        ranges: vec![],
        warnings: vec![],
    }
}
fn lookup(file_type: &str) -> MockSpreadsheetDocumentLookup {
    let mut lookup = MockSpreadsheetDocumentLookup::new();
    let file_type = file_type.to_owned();
    lookup
        .expect_file_type()
        .withf(|id| id == DOCUMENT)
        .times(1)
        .returning(move |_| {
            let file_type = file_type.clone();
            Box::pin(async move { Ok(Some(file_type)) })
        });
    lookup
}

#[tokio::test]
async fn reads_mint_only_view_access_and_preserve_delegated_actor() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_spreadsheet()
        .times(1)
        .returning(|id, token, request| {
            assert_eq!(id, DOCUMENT);
            assert!(matches!(request, SpreadsheetRequest::Read { .. }));
            let claims: serde_json::Value =
                macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
            assert_eq!(claims["document_id"], DOCUMENT);
            assert_eq!(claims["access_level"], "view");
            assert_eq!(claims["user_id"], "macro|sheets@macro.com");
            assert_eq!(claims["actor"], "macro|ai@macro.com");
            Box::pin(async { Ok(response()) })
        });
    let service = SpreadsheetService::new(
        Arc::new(lookup("spreadsheet")),
        Arc::new(worker),
        SECRET.into(),
    );
    service
        .read(
            receipt(AccessLevel::View),
            &user(),
            "macro|ai@macro.com",
            request(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn edits_forward_exact_revision_with_edit_token() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_spreadsheet().times(1).returning(|_, token, request| {
        let claims: serde_json::Value = macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
        assert_eq!(claims["access_level"], "edit");
        assert!(matches!(request, SpreadsheetRequest::Edit { expected_revision, operations } if expected_revision == "seen" && operations.len() == 1));
        Box::pin(async { Ok(response()) })
    });
    let service = SpreadsheetService::new(
        Arc::new(lookup("spreadsheet")),
        Arc::new(worker),
        SECRET.into(),
    );
    service
        .edit(
            receipt(AccessLevel::Edit),
            &user(),
            "macro|ai@macro.com",
            "seen".into(),
            vec![SpreadsheetOperation::AddSheet {
                name: "Forecast".into(),
            }],
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn imported_files_cannot_enter_native_spreadsheet_worker() {
    let worker = MockEditingWorkerService::new();
    let service =
        SpreadsheetService::new(Arc::new(lookup("xlsx")), Arc::new(worker), SECRET.into());
    let error = service
        .read(
            receipt(AccessLevel::View),
            &user(),
            "macro|ai@macro.com",
            request(),
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("native Macro spreadsheet"));
}

#[tokio::test]
async fn read_receipt_cannot_smuggle_an_edit_request() {
    let service = SpreadsheetService::new(
        Arc::new(MockSpreadsheetDocumentLookup::new()),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
    );
    let error = service
        .read(
            receipt(AccessLevel::View),
            &user(),
            "macro|ai@macro.com",
            SpreadsheetRequest::Edit {
                expected_revision: "r".into(),
                operations: vec![],
            },
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("edit access"));
}

#[tokio::test]
async fn missing_revision_or_empty_batch_never_calls_ports() {
    let service = SpreadsheetService::new(
        Arc::new(MockSpreadsheetDocumentLookup::new()),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
    );
    assert!(
        service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                "macro|ai@macro.com",
                "".into(),
                vec![]
            )
            .await
            .is_err()
    );
    assert!(
        service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                "macro|ai@macro.com",
                "r".into(),
                vec![]
            )
            .await
            .is_err()
    );
}

#[test]
fn view_and_comment_permissions_cannot_mint_edit_receipt() {
    for access_level in [AccessLevel::View, AccessLevel::Comment] {
        assert!(
            EntityAccessReceipt::<EditAccessLevel>::try_new_authenticated_user(
                user(),
                Entity {
                    entity_id: DOCUMENT.to_owned(),
                    entity_type: EntityType::Document
                },
                EntityPermission::AccessLevel { access_level }
            )
            .is_err()
        );
    }
}

#[test]
fn worker_json_contract_omits_optional_fields_and_round_trips_response() {
    assert_eq!(
        serde_json::to_value(request()).unwrap(),
        serde_json::json!({"action":"read"})
    );
    let parsed: SpreadsheetResponse = serde_json::from_value(serde_json::json!({
        "action":"read", "revision":"r", "warnings":[],
        "sheets":[{"id":"sheet1","name":"Sheet1","rowCount":200,"columnCount":26,"usedRange":"A1:A1","populatedCells":1,"formulaCells":1,"errorCells":0}],
        "ranges":[{"sheetId":"sheet1","sheetName":"Sheet1","range":"A1","truncated":false,"cells":[{"address":"A1","source":"=1+1","formula":"=1+1","type":"number","value":2,"display":"2"}]}]
    })).unwrap();
    assert!(
        matches!(parsed, SpreadsheetResponse::Read { ranges, .. } if ranges[0].cells[0].source == "=1+1")
    );
}

#[test]
fn imported_styles_round_trip_through_the_ai_contract() {
    let json = serde_json::json!({
        "numberFormat": "#,##0.00;[Red](#,##0.00)",
        "fontName": "Calibri",
        "borderBottomStyle": "double",
        "borderBottomColor": "#123456"
    });
    let style: super::models::SpreadsheetStyle = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(serde_json::to_value(style).unwrap(), json);
    assert!(
        serde_json::from_value::<super::models::SpreadsheetStyle>(
            serde_json::json!({"borderBottomStyle":"bogus"})
        )
        .is_err()
    );
}
