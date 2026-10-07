//! Registration protects the review boundary on interactive hosts.
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
fn interactive_hosts_defer_access_but_allow_direct_draft_work() {
    let tools = forms_toolset::<UncalledService>();
    assert!(tools.user_tools.contains_key("SetFormAccess"));
    assert_eq!(tools.user_tools.len(), 1);
    for name in ["CreateForm", "ReadForm", "EditForm", "ListForms"] {
        assert!(tools.tools.contains_key(name), "{name}");
        assert!(!tools.user_tools.contains_key(name), "{name}");
    }
}

#[test]
fn headless_hosts_never_return_unfinishable_pending_reviews() {
    let tools = direct_toolset::<UncalledService>();
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
            "requestId",
            "strict qualification",
        ),
        (schemars::schema_for!(ReadForm), "formId", "hidden booking"),
        (schemars::schema_for!(EditForm), "changes", "CRDT updates"),
        (schemars::schema_for!(ListForms), "query", "public forms"),
        (
            schemars::schema_for!(SetFormAccess),
            "draft",
            "Cancellation",
        ),
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
