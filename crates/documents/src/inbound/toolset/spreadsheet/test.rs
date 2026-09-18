use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn spreadsheet_tools_have_valid_model_schemas() {
    assert!(generate_validated_input_schema::<ReadSpreadsheet>().is_ok());
    assert!(generate_validated_input_schema::<CalculateSpreadsheet>().is_ok());
    assert!(generate_validated_input_schema::<EditSpreadsheet>().is_ok());
}

#[test]
fn edit_operations_reject_unknown_actions_and_style_properties() {
    assert!(
        serde_json::from_value::<SpreadsheetOperation>(serde_json::json!({
            "type":"execute_code","code":"arbitrary code"
        }))
        .is_err()
    );
    assert!(serde_json::from_value::<SpreadsheetOperation>(serde_json::json!({
        "type":"format_cells","sheetId":"sheet1","range":"A1","style":{"value":"unexpected write"}
    })).is_err());
}

#[tokio::test]
async fn cancelled_request_never_starts_the_worker_operation() {
    let req = RequestContext::new(
        macro_user_id::user_id::MacroUserIdStr::try_from("macro|test@example.com".to_owned())
            .unwrap(),
    );
    req.cancel.cancel();
    let started = std::sync::atomic::AtomicBool::new(false);
    let error = cancellable(&req, async {
        started.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    })
    .await
    .unwrap_err();
    assert!(!started.load(std::sync::atomic::Ordering::SeqCst));
    assert!(error.description.contains("cancelled"));
}
