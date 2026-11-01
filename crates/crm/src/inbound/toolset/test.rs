use ai_toolset::schema::generate_validated_input_schema;

use super::{CreateCompany, CreateContact, crm_error};
use crate::domain::model::CrmError;

#[test]
fn create_tools_have_valid_schemas() {
    let company = generate_validated_input_schema::<CreateCompany>().expect("valid schema");
    assert_eq!(company.name, "CreateCompany");
    let contact = generate_validated_input_schema::<CreateContact>().expect("valid schema");
    assert_eq!(contact.name, "CreateContact");
}

#[test]
fn creation_conflicts_explain_what_to_change() {
    for (error, expected) in [
        (CrmError::CompanyAlreadyExistsForTeam, "already tracks"),
        (
            CrmError::ContactAlreadyExistsForCompany,
            "already has a contact",
        ),
        (CrmError::ContactEmailDomainMismatch, "company's domains"),
        (CrmError::CrmDisabledForTeam, "turned off"),
    ] {
        let description = crm_error(error).description;
        assert!(description.contains(expected), "{description}");
    }
}
