//! Forms tools execute directly on every host.
use super::*;
use crate::domain::authoring::*;

struct UncalledService;
impl FormsAuthoringService for UncalledService {
    async fn create_form(&self, _: Viewer, _: Create) -> Result<MutationResult, AuthoringError> {
        unreachable!("registration never calls a service")
    }
    async fn read_form(&self, _: Viewer, _: Read) -> Result<ReadResult, AuthoringError> {
        unreachable!("registration never calls a service")
    }
    async fn edit_form(&self, _: Viewer, _: Edit) -> Result<MutationResult, AuthoringError> {
        unreachable!("registration never calls a service")
    }
    async fn list_forms(&self, _: Viewer, _: List) -> Result<ListResult, AuthoringError> {
        unreachable!("registration never calls a service")
    }
    async fn set_form_access(
        &self,
        _: Viewer,
        _: SetAccess,
    ) -> Result<MutationResult, AuthoringError> {
        unreachable!("registration never calls a service")
    }
}

#[test]
fn interactive_hosts_execute_access_without_a_review() {
    let tools = forms_toolset::<UncalledService>();
    assert!(tools.user_tools.is_empty());
    assert!(tools.tools.contains_key("SetFormAccess"));
    for name in ["CreateForm", "ReadForm", "EditForm", "ListForms"] {
        assert!(tools.tools.contains_key(name), "{name}");
        assert!(!tools.user_tools.contains_key(name), "{name}");
    }
}

#[test]
fn headless_hosts_never_return_unfinishable_pending_reviews() {
    let tools = forms_toolset::<UncalledService>();
    assert!(tools.user_tools.is_empty());
    for name in [
        "CreateForm",
        "ReadForm",
        "EditForm",
        "ListForms",
        "SetFormAccess",
    ] {
        assert!(tools.tools.contains_key(name), "{name}");
    }
}

#[test]
fn tool_schemas_keep_workflow_instructions_and_flat_arguments() {
    let schemas = [
        (
            schemars::schema_for!(CreateForm),
            "name",
            "strict qualification",
        ),
        (schemars::schema_for!(ReadForm), "formId", "hidden booking"),
        (schemars::schema_for!(EditForm), "changes", "CRDT updates"),
        (schemars::schema_for!(ListForms), "query", "public forms"),
        (schemars::schema_for!(SetFormAccess), "draft", "immediately"),
    ];
    for (schema, argument, instruction) in schemas {
        let value = schema.to_value();
        assert!(
            value["description"]
                .as_str()
                .is_some_and(|text| text.contains(instruction)),
            "Missing {instruction}"
        );
        assert!(
            value["properties"].get(argument).is_some(),
            "Missing flat {argument}"
        );
    }
}

#[test]
fn tool_schemas_do_not_advertise_retry_or_operation_identity() {
    for schema in [
        schemars::schema_for!(CreateForm),
        schemars::schema_for!(EditForm),
        schemars::schema_for!(SetFormAccess),
    ] {
        assert!(schema.to_value()["properties"].get("requestId").is_none());
    }
    assert!(
        schemars::schema_for!(ReadForm).to_value()["properties"]
            .get("operationId")
            .is_none()
    );
}

#[test]
fn sharing_has_no_review_revision_contract() {
    let schema = schemars::schema_for!(SetFormAccess).to_value();
    assert!(schema["properties"].get("baseRevision").is_none());
    assert!(
        schemars::schema_for!(SavedForm).to_value()["properties"]
            .get("revision")
            .is_none()
    );
}
