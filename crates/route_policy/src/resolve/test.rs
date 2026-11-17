use super::*;

const PERSON: CallerEvidence = CallerEvidence {
    authenticated: Authenticated::Session,
    program: false,
    scope: ScopeEvidence::Unscoped,
    code_execution: false,
};

#[test]
fn a_person_is_a_person_until_anything_narrower_is_signed() {
    assert_eq!(resolve_caller(PERSON), Some(Caller::Person));
    assert_eq!(
        resolve_caller(CallerEvidence {
            authenticated: Authenticated::ApiCredential,
            ..PERSON
        }),
        Some(Caller::ApiCredential)
    );
}

#[test]
fn the_code_execution_header_only_narrows_a_person_or_an_api_credential() {
    assert_eq!(
        resolve_caller(CallerEvidence {
            code_execution: true,
            ..PERSON
        }),
        Some(Caller::Program)
    );
    assert_eq!(
        resolve_caller(CallerEvidence {
            authenticated: Authenticated::ApiCredential,
            code_execution: true,
            ..PERSON
        }),
        Some(Caller::Program)
    );
    for (authenticated, caller) in [
        (Authenticated::Bot, Caller::Bot),
        (Authenticated::Harness, Caller::Harness),
        (Authenticated::Internal, Caller::Internal),
    ] {
        assert_eq!(
            resolve_caller(CallerEvidence {
                authenticated,
                code_execution: true,
                ..PERSON
            }),
            Some(caller)
        );
    }
    assert_eq!(
        resolve_caller(CallerEvidence {
            authenticated: Authenticated::Nothing,
            code_execution: true,
            ..PERSON
        }),
        None
    );
}

#[test]
fn a_program_token_anywhere_makes_a_program_whatever_authenticated() {
    for authenticated in [
        Authenticated::Session,
        Authenticated::ApiCredential,
        Authenticated::Bot,
        Authenticated::Internal,
        // The program's token verified, but another credential, one that
        // doesn't, was picked to authenticate.
        Authenticated::Nothing,
    ] {
        assert_eq!(
            resolve_caller(CallerEvidence {
                authenticated,
                program: true,
                ..PERSON
            }),
            Some(Caller::Program),
            "{authenticated:?}"
        );
    }
}

#[test]
fn any_scope_is_narrower_than_any_program() {
    for (scope, caller) in [
        (ScopeEvidence::NoSend, Caller::ScopedNoSend),
        (ScopeEvidence::Generation, Caller::ScopedGeneration),
        (ScopeEvidence::ReadOnly, Caller::ScopedReadOnly),
    ] {
        assert_eq!(
            resolve_caller(CallerEvidence {
                authenticated: Authenticated::Nothing,
                program: true,
                scope,
                ..PERSON
            }),
            Some(caller)
        );
    }
}

#[test]
fn the_narrowest_scope_is_read_only_then_generation_then_no_send() {
    assert_eq!(
        ScopeEvidence::NoSend.narrowest(ScopeEvidence::ReadOnly),
        ScopeEvidence::ReadOnly
    );
    assert_eq!(
        ScopeEvidence::Generation.narrowest(ScopeEvidence::NoSend),
        ScopeEvidence::Generation
    );
    assert_eq!(
        ScopeEvidence::Unscoped.narrowest(ScopeEvidence::NoSend),
        ScopeEvidence::NoSend
    );
}
