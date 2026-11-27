use ai_toolset::schema::generate_validated_input_schema;

use super::{AddCompanyDomain, CreateCompany, CreateContact, RemoveCompanyDomain, crm_error};
use crate::domain::model::{CompanyDomainHolder, CrmError};

#[test]
fn create_tools_have_valid_schemas() {
    let company = generate_validated_input_schema::<CreateCompany>().expect("valid schema");
    assert_eq!(company.name, "CreateCompany");
    let contact = generate_validated_input_schema::<CreateContact>().expect("valid schema");
    assert_eq!(contact.name, "CreateContact");
}

#[test]
fn domain_tools_have_valid_schemas() {
    let add = generate_validated_input_schema::<AddCompanyDomain>().expect("valid schema");
    assert_eq!(add.name, "AddCompanyDomain");
    let remove = generate_validated_input_schema::<RemoveCompanyDomain>().expect("valid schema");
    assert_eq!(remove.name, "RemoveCompanyDomain");
}

#[test]
fn a_domain_conflict_names_the_company_holding_it() {
    let holder = uuid::Uuid::now_v7();
    let description = crm_error(CrmError::CompanyDomainTaken(Some(CompanyDomainHolder {
        company_id: holder,
        name: Some("Example".into()),
        hidden: false,
    })))
    .description;
    assert!(description.contains("Example"), "{description}");
    assert!(description.contains(&holder.to_string()), "{description}");
}

#[test]
fn creation_conflicts_explain_what_to_change() {
    for (error, expected) in [
        (CrmError::CompanyAlreadyExistsForTeam, "already tracks"),
        (
            CrmError::ContactAlreadyExistsForCompany,
            "already has a contact",
        ),
        (CrmError::CrmDisabledForTeam, "turned off"),
    ] {
        let description = crm_error(error).description;
        assert!(description.contains(expected), "{description}");
    }
}
