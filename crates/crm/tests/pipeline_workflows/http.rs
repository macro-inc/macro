use super::*;
use std::sync::Mutex;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use crm::domain::crm_transfer::{
    CrmTransferRecords, CrmTransferServiceImpl, CsvFile, CsvFiles, TransferError,
};
use crm::inbound::{
    pipeline_workflows::{self, PipelineWorkflowRouterState},
    pipelines::{self, PipelineRouterState},
};
use macro_authorization::{
    CredentialOrigin, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoBotAuthorizer,
    NoUserApiKeyAuthorizer, ValidatedCredential, ValidatedIdentity,
};
use serde_json::{Value, json};
use tower::ServiceExt;

/// Signs every request in as the owner.
#[derive(Clone)]
struct OwnerToken;
impl JwtValidator for OwnerToken {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        if jwt != "owner" {
            return Err(rootcause::Report::new(
                MacroAuthorizationError::InvalidCredentials,
            ));
        }
        Ok(ValidatedCredential {
            origin: CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: OWNER.into(),
                fusion_user_id: "test-fusion-user".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

/// Keeps saved CSV files in memory.
#[derive(Clone, Default)]
struct SavedFiles(Arc<Mutex<Vec<(Uuid, String, String)>>>);
impl CsvFiles for SavedFiles {
    async fn read(&self, _: &Viewer, _: Uuid) -> Result<CsvFile, TransferError> {
        Err(TransferError::File("only CSV text is imported here".into()))
    }
    async fn save(&self, _: &Viewer, name: &str, text: String) -> Result<Uuid, TransferError> {
        let id = Uuid::now_v7();
        self.0.lock().unwrap().push((id, name.to_owned(), text));
        Ok(id)
    }
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", "Bearer owner")
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn http_routes_add_find_update_remove_edit_and_move_csv_by_name(pool: PgPool) {
    let Fixture {
        workflows,
        pipelines: pipeline_service,
        crm,
        access,
        acme,
        globex,
        ..
    } = fixture(&pool).await;
    sqlx::query!(
        "INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction)
         VALUES ($1, $2, 'pat@acme.test', 'Pat Kim', now(), now())",
        Uuid::now_v7(),
        acme
    )
    .execute(&pool)
    .await
    .unwrap();
    let sales = sales(&workflows, PipelineSharing::Private).await;
    let id = sales.pipeline.pipeline.id;
    let workflows = Arc::new(workflows);
    let files = SavedFiles::default();
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        OwnerToken,
        InternalAuthConfig {
            api_key: "test-only".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    // Mounted the way document_storage_service mounts both routers.
    let app = Router::new().nest(
        "/crm",
        Router::new()
            .nest(
                "/pipelines",
                pipelines::router(PipelineRouterState {
                    service: pipeline_service,
                    access: access.clone(),
                    authorization: authorization.clone(),
                }),
            )
            .merge(pipeline_workflows::router(PipelineWorkflowRouterState {
                workflows: workflows.clone(),
                transfer: Arc::new(CrmTransferServiceImpl::new(
                    workflows,
                    CrmTransferRecords::new(crm, access),
                    files.clone(),
                )),
                authorization,
            })),
    );

    let (status, added) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries"),
        Some(json!({"entries": [
            {"recordId": acme, "set": [{"field": "Stage", "value": "Demo"}, {"field": "Revenue", "value": "1000"}]},
            {"recordId": globex, "set": [{"field": "stage", "value": "prospect"}, {"field": "Revenue", "value": "500"}]},
        ]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{added}");
    assert_eq!(added["added"].as_array().unwrap().len(), 2);
    assert_eq!(added["added"][0]["record"]["name"], "Acme");
    assert_eq!(
        added["added"][0]["fields"]["Stage"],
        json!({"type": "labels", "value": ["Demo"]})
    );
    assert_eq!(
        added["added"][0]["fields"]["Revenue"],
        json!({"type": "number", "value": 1000.0})
    );

    let (status, again) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries"),
        Some(json!({"entries": [{"email": "pat@acme.test"}]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["added"], json!([]));
    assert_eq!(again["alreadyPresent"][0]["record"]["id"], json!(acme));

    let (status, refused) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries"),
        Some(json!({"entries": [{"recordId": acme, "email": "pat@acme.test"}]})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        refused["message"],
        "Give each entry at most one of recordId or email."
    );

    let (status, found) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries/find"),
        Some(json!({"sortBy": "Revenue", "descending": true})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found["matched"], 2);
    assert_eq!(found["complete"], true);
    assert_eq!(found["entries"][0]["record"]["name"], "Acme");
    assert_eq!(found["entries"][1]["record"]["name"], "Globex");
    assert_eq!(
        found["totals"],
        json!([{"field": "Revenue", "sum": 1500.0}])
    );
    assert_eq!(
        found["counts"],
        json!([{"field": "Stage", "counts": [
            {"label": "Prospect", "count": 1},
            {"label": "Demo", "count": 1},
            {"label": "Won", "count": 0},
        ], "empty": 0}])
    );
    assert_eq!(found["pipeline"]["id"], json!(id));
    assert_eq!(found["pipeline"]["fields"][0]["type"], "company");
    let version = found["pipeline"]["version"].as_i64().unwrap();

    let (status, filtered) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries/find"),
        Some(json!({"filters": [{"field": "Stage", "value": "Demo"}], "limit": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{filtered}");
    assert_eq!(filtered["matched"], 1);
    assert_eq!(filtered["entries"][0]["record"]["id"], json!(acme));

    let (status, too_many) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries/find"),
        Some(json!({"limit": 5001})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{too_many}");

    let (status, updated) = call(
        &app,
        "PATCH",
        &format!("/crm/pipelines/{id}/entries"),
        Some(json!({
            "updates": [{"recordId": globex, "set": [{"field": "Stage", "value": "Won"}]}],
            "baseVersion": version,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(
        updated["updated"][0]["changes"],
        json!([{
            "field": "Stage",
            "before": {"type": "labels", "value": ["Prospect"]},
            "after": {"type": "labels", "value": ["Won"]},
        }])
    );

    let (status, stale) = call(
        &app,
        "PATCH",
        &format!("/crm/pipelines/{id}/entries"),
        Some(json!({
            "updates": [{"recordId": globex, "set": [{"field": "Stage", "value": "Demo"}]}],
            "baseVersion": version,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{stale}");

    let (status, by_record) = call(
        &app,
        "POST",
        "/crm/pipelines/record-entries",
        Some(json!({"recordIds": [globex]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{by_record}");
    assert_eq!(by_record.as_array().unwrap().len(), 1);
    assert_eq!(by_record[0]["pipeline"]["id"], json!(id));
    assert_eq!(by_record[0]["entries"][0]["record"]["id"], json!(globex));

    let (status, details) = call(&app, "GET", "/crm/pipelines/details", None).await;
    assert_eq!(status, StatusCode::OK, "{details}");
    assert_eq!(details.as_array().unwrap().len(), 1);
    assert_eq!(details[0]["id"], json!(id));
    assert_eq!(details[0]["name"], "Sales");
    assert_eq!(details[0]["fields"][0]["type"], "company");
    let stage = details[0]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|field| field["name"] == "Stage")
        .unwrap();
    assert_eq!(stage["options"], json!(["Prospect", "Demo", "Won"]));
    assert!(details[0]["version"].as_i64().unwrap() > version);

    let (status, searched) =
        call(&app, "GET", "/crm/pipelines/entry-search?search=glob", None).await;
    assert_eq!(status, StatusCode::OK, "{searched}");
    assert_eq!(searched[0]["entries"][0]["record"]["name"], "Globex");

    let (status, csv) = call(&app, "GET", &format!("/crm/pipelines/{id}/csv"), None).await;
    assert_eq!(status, StatusCode::OK, "{csv}");
    assert_eq!(csv["name"], "Sales");
    assert_eq!(csv["rows"], 2);
    let text = csv["csv"].as_str().unwrap();
    assert!(text.starts_with("Company,Domain,Stage,"), "{text}");
    assert!(text.contains("Globex,globex.com,Won,"), "{text}");

    let (status, exported) = call(&app, "POST", &format!("/crm/pipelines/{id}/export"), None).await;
    assert_eq!(status, StatusCode::OK, "{exported}");
    assert_eq!(exported["fileName"], "Sales");
    assert_eq!(exported["rows"], 2);
    {
        let saved = files.0.lock().unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(exported["documentId"], json!(saved[0].0));
        assert_eq!(saved[0].2, text);
    }

    let (status, removed) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/entries/remove"),
        Some(json!({"recordIds": [acme]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{removed}");
    assert_eq!(removed["removed"][0]["record"]["id"], json!(acme));

    let (status, imported) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/import"),
        Some(json!({"csv": "Company,Domain,Stage,Color\nInitech,initech.com,Demo,Blue\n"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{imported}");
    assert_eq!(imported["pipelineId"], json!(id));
    assert_eq!(imported["added"], 1);
    assert_eq!(imported["createdRecords"], 1);
    assert_eq!(imported["filledFields"], json!(["Stage"]));
    assert_eq!(imported["ignoredColumns"], json!(["Color"]));

    let (status, companies) = call(
        &app,
        "POST",
        "/crm/companies/import",
        Some(json!({
            "csv": "Company,Domain,Stage\nUmbrella,umbrella.com,Won\nGlobex,globex.com,\n",
            "pipelineId": id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{companies}");
    assert_eq!(companies["created"], 1);
    assert_eq!(companies["existing"], 1);
    assert_eq!(companies["pipeline"]["pipelineId"], json!(id));
    assert_eq!(companies["pipeline"]["added"], 1);

    let (status, both) = call(
        &app,
        "POST",
        "/crm/companies/import",
        Some(json!({"csv": "Company,Domain\nHooli,hooli.com\n", "documentId": Uuid::now_v7()})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{both}");

    let (status, edited) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{id}/edit"),
        Some(json!({
            "name": "Enterprise",
            "addFields": [{"name": "Priority", "type": "select", "options": ["High", "Low"]}],
            "addOptions": [{"field": "Stage", "labels": ["Lost"]}],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["name"], "Enterprise");
    let fields = edited["fields"].as_array().unwrap();
    let stage = fields
        .iter()
        .find(|field| field["name"] == "Stage")
        .unwrap();
    assert_eq!(stage["options"], json!(["Prospect", "Demo", "Won", "Lost"]));
    let priority = fields
        .iter()
        .find(|field| field["name"] == "Priority")
        .unwrap();
    assert_eq!(priority["type"], "select");
    assert_eq!(priority["options"], json!(["High", "Low"]));

    let (status, generic) = call(
        &app,
        "POST",
        "/crm/pipelines",
        Some(json!({"name": "Launch"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generic}");
    let generic_id = generic["id"].as_str().unwrap();
    let (status, rows) = call(
        &app,
        "POST",
        &format!("/crm/pipelines/{generic_id}/entries"),
        Some(json!({"entries": [{"set": [{"field": "Name", "value": "Site"}]}]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rows}");
    assert_eq!(rows["added"][0]["record"], Value::Null);
    assert_eq!(
        rows["added"][0]["fields"]["Name"],
        json!({"type": "text", "value": "Site"})
    );

    let (status, hiring) = call(
        &app,
        "POST",
        "/crm/pipelines/create",
        Some(json!({
            "name": "Hiring",
            "recordType": "contact",
            "stages": ["Sourced", "Interview", "Hired"],
            "fields": [{"name": "Role", "type": "select", "options": ["Engineer", "Designer"]}],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{hiring}");
    assert_eq!(hiring["name"], "Hiring");
    assert_eq!(hiring["recordType"], "contact");
    assert_eq!(hiring["sharing"], "private");
    let fields = hiring["fields"].as_array().unwrap();
    let names: Vec<&str> = fields
        .iter()
        .map(|field| field["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Contact", "Stage", "Owner", "Revenue", "Role"]);
    let stage = fields
        .iter()
        .find(|field| field["name"] == "Stage")
        .unwrap();
    assert_eq!(stage["options"], json!(["Sourced", "Interview", "Hired"]));
    let role = fields.iter().find(|field| field["name"] == "Role").unwrap();
    assert_eq!(role["type"], "select");
    assert_eq!(role["options"], json!(["Engineer", "Designer"]));

    // A field the pipeline cannot take fails after the pipeline exists, and
    // the error says so, so a caller does not retry into a duplicate.
    let (status, partial) = call(
        &app,
        "POST",
        "/crm/pipelines/create",
        Some(json!({
            "name": "Partners",
            "recordType": "company",
            "fields": [{"name": "Notes", "type": "text", "options": ["a"]}],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{partial}");
    assert!(
        partial
            .to_string()
            .contains("Created pipeline \\\"Partners\\\""),
        "{partial}"
    );

    // The pipeline routes still answer beside the workflow routes.
    let (status, read) = call(&app, "GET", &format!("/crm/pipelines/{id}"), None).await;
    assert_eq!(status, StatusCode::OK, "{read}");
    assert_eq!(read["name"], "Enterprise");
}
