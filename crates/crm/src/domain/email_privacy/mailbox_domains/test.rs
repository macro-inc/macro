use super::*;

#[test]
fn domain_guard_uses_the_thread_veto_direction_and_label_boundary() {
    let mailboxes = [ConnectedMailboxDomain {
        domain: "Mail.Example.com".into(),
        is_caller: true,
    }];
    for scope in [EmailBlockScope::Team, EmailBlockScope::Personal] {
        for domain in ["mail.example.com", "EXAMPLE.COM"] {
            assert!(matches!(
                validate(domain, scope, &mailboxes),
                Err(CrmError::BlocksConnectedMailbox(
                    MailboxDomainConflict::Company
                ))
            ));
        }
        for domain in ["sub.mail.example.com", "ample.com", "unrelated.example.org"] {
            assert!(validate(domain, scope, &mailboxes).is_ok());
        }
    }
}

#[test]
fn team_guard_covers_other_members_but_personal_guard_does_not() {
    let mailboxes = [ConnectedMailboxDomain {
        domain: "example.com".into(),
        is_caller: false,
    }];
    assert!(validate("example.com", EmailBlockScope::Team, &mailboxes).is_err());
    assert!(validate("example.com", EmailBlockScope::Personal, &mailboxes).is_ok());
    assert!(validate("example.com", EmailBlockScope::Team, &[]).is_ok());
}

#[test]
fn personal_provider_warning_does_not_claim_colleagues_are_excluded() {
    let mailboxes = [ConnectedMailboxDomain {
        domain: "gmail.com".into(),
        is_caller: true,
    }];
    for scope in [EmailBlockScope::Team, EmailBlockScope::Personal] {
        assert_eq!(
            conflict("gmail.com", scope, &mailboxes),
            Some(MailboxDomainConflict::PersonalProvider)
        );
        let entries = vec!["gmail.com".into(), "example.com".into()];
        assert_eq!(
            warnings(&entries, scope, &mailboxes),
            BTreeMap::from([("gmail.com".into(), MailboxDomainConflict::PersonalProvider)])
        );
        assert_eq!(
            entries.len(),
            2,
            "warnings never remove existing exclusions"
        );
    }
}
