use super::{CompanyDomainEdit, CompanyDomainEditor, CompanyDomainUpdate, LockedCompanyDomains};
use crate::domain::model::{CompanyDomainHolder, CrmError};
use uuid::Uuid;

fn company(domains: &[&str], team_named: bool, email_sync: bool) -> LockedCompanyDomains {
    LockedCompanyDomains {
        domains: domains.iter().map(|domain| (*domain).to_owned()).collect(),
        team_named,
        email_sync,
        holder: None,
    }
}

#[test]
fn adding_a_domain_the_company_holds_changes_nothing() {
    let current = company(&["example.com", "example.org"], false, true);
    let edit = CompanyDomainUpdate::Add("example.org".into())
        .resolve(&current, CompanyDomainEditor::Member)
        .expect("a repeated add is answered like the first");
    assert_eq!(edit, CompanyDomainEdit::Unchanged);
}

#[test]
fn adding_a_new_domain_inserts_it() {
    let current = company(&["example.com"], false, false);
    let edit = CompanyDomainUpdate::Add("example.org".into())
        .resolve(&current, CompanyDomainEditor::Member)
        .expect("any member may add a domain");
    assert_eq!(edit, CompanyDomainEdit::Insert);
}

#[test]
fn a_domain_another_company_tracks_is_refused_naming_that_company() {
    let holder = CompanyDomainHolder {
        company_id: Uuid::now_v7(),
        name: Some("Example".into()),
        hidden: false,
    };
    let current = LockedCompanyDomains {
        holder: Some(holder.clone()),
        ..company(&["example.com"], false, true)
    };

    let err = CompanyDomainUpdate::Add("example.org".into())
        .resolve(&current, CompanyDomainEditor::Member)
        .expect_err("the domain belongs to another company");
    assert!(matches!(err, CrmError::CompanyDomainTaken(Some(named)) if named == holder));
}

#[test]
fn an_archived_holder_is_named_to_admins_only() {
    let holder = CompanyDomainHolder {
        company_id: Uuid::now_v7(),
        name: Some("Archived".into()),
        hidden: true,
    };
    let current = LockedCompanyDomains {
        holder: Some(holder.clone()),
        ..company(&["example.com"], false, true)
    };
    let add = CompanyDomainUpdate::Add("example.org".into());

    let member = add
        .resolve(&current, CompanyDomainEditor::Member)
        .expect_err("refused for a member");
    assert!(matches!(member, CrmError::CompanyDomainTaken(None)));

    let admin = add
        .resolve(&current, CompanyDomainEditor::Admin)
        .expect_err("refused for an admin");
    assert!(matches!(admin, CrmError::CompanyDomainTaken(Some(named)) if named == holder));
}

#[test]
fn removing_a_domain_the_company_does_not_hold_changes_nothing() {
    let current = company(&["example.com"], false, false);
    let edit = CompanyDomainUpdate::Remove("example.org".into())
        .resolve(&current, CompanyDomainEditor::Member)
        .expect("a repeated remove is answered like the first");
    assert_eq!(edit, CompanyDomainEdit::Unchanged);
}

#[test]
fn the_primary_domain_that_names_the_company_stays() {
    let current = company(&["example.com", "example.org"], false, true);
    let err = CompanyDomainUpdate::Remove("example.com".into())
        .resolve(&current, CompanyDomainEditor::Admin)
        .expect_err("the name comes from this domain");
    assert!(matches!(err, CrmError::InvalidRequest(message) if message.contains("rename")));

    let secondary = CompanyDomainUpdate::Remove("example.org".into())
        .resolve(&current, CompanyDomainEditor::Member)
        .expect("a further domain can go");
    assert_eq!(
        secondary,
        CompanyDomainEdit::Delete {
            lifts_exclusion: false
        }
    );
}

#[test]
fn a_team_named_company_may_lose_its_primary_domain() {
    let current = company(&["example.com"], true, true);
    let edit = CompanyDomainUpdate::Remove("example.com".into())
        .resolve(&current, CompanyDomainEditor::Member)
        .expect("the team's own name stays");
    assert_eq!(
        edit,
        CompanyDomainEdit::Delete {
            lifts_exclusion: false
        }
    );
}

#[test]
fn only_an_admin_removes_a_domain_from_a_company_whose_sync_is_off() {
    let current = company(&["example.com", "example.org"], false, false);
    let remove = CompanyDomainUpdate::Remove("example.org".into());

    let member = remove
        .resolve(&current, CompanyDomainEditor::Member)
        .expect_err("a member cannot lift the company's exclusion");
    assert!(matches!(member, CrmError::CompanyDomainAdminRequired));

    let admin = remove
        .resolve(&current, CompanyDomainEditor::Admin)
        .expect("an admin can");
    assert_eq!(
        admin,
        CompanyDomainEdit::Delete {
            lifts_exclusion: true
        }
    );
}
