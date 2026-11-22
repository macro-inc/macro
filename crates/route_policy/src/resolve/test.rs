use super::*;

const PERSON: CallerEvidence = CallerEvidence {
    authenticated: Authenticated::Session,
    header: None,
    program: false,
    scope: ScopeEvidence::Unscoped,
    channel_mention: false,
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
    for (header, caller) in [
        (UnverifiedHeader::Bot, Caller::Bot),
        (UnverifiedHeader::Harness, Caller::Harness),
    ] {
        assert_eq!(
            resolve_caller(CallerEvidence {
                header: Some(header),
                code_execution: true,
                ..PERSON
            }),
            Some(Caller::Program),
            "{caller}"
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
        (ScopeEvidence::DryRun, Caller::ScopedDryRun),
        (ScopeEvidence::Unknown, Caller::ScopedUnknown),
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
fn the_narrowest_scope_is_unknown_then_dry_run_then_generation_then_no_send() {
    assert_eq!(
        ScopeEvidence::NoSend.narrowest(ScopeEvidence::DryRun),
        ScopeEvidence::DryRun
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

#[test]
fn an_unknown_scope_is_narrower_than_a_dry_run() {
    assert_eq!(
        ScopeEvidence::DryRun.narrowest(ScopeEvidence::Unknown),
        ScopeEvidence::Unknown
    );
}

#[test]
fn a_channel_mention_is_never_a_program_and_any_scope_still_wins() {
    let mention = CallerEvidence {
        authenticated: Authenticated::ApiCredential,
        program: true,
        channel_mention: true,
        ..PERSON
    };
    assert_eq!(resolve_caller(mention), Some(Caller::ChannelMention));
    assert_eq!(
        resolve_caller(CallerEvidence {
            code_execution: true,
            ..mention
        }),
        Some(Caller::ChannelMention)
    );
    assert_eq!(
        resolve_caller(CallerEvidence {
            scope: ScopeEvidence::Generation,
            ..mention
        }),
        Some(Caller::ScopedGeneration)
    );
}

#[test]
fn a_credential_header_alone_resolves_no_caller() {
    for header in [
        UnverifiedHeader::UserApiKey,
        UnverifiedHeader::Bot,
        UnverifiedHeader::Harness,
        UnverifiedHeader::Internal,
    ] {
        for code_execution in [false, true] {
            assert_eq!(
                resolve_caller(CallerEvidence {
                    authenticated: Authenticated::Nothing,
                    header: Some(header),
                    code_execution,
                    ..PERSON
                }),
                None,
                "{header:?} code_execution={code_execution}"
            );
        }
    }
}

#[test]
fn a_credential_header_beside_a_verified_token_only_narrows_it() {
    for (authenticated, header, caller) in [
        (Authenticated::Session, UnverifiedHeader::Bot, Caller::Bot),
        (
            Authenticated::Session,
            UnverifiedHeader::Harness,
            Caller::Harness,
        ),
        (
            Authenticated::Session,
            UnverifiedHeader::UserApiKey,
            Caller::ApiCredential,
        ),
        (
            Authenticated::Session,
            UnverifiedHeader::Internal,
            Caller::Person,
        ),
        (
            Authenticated::ApiCredential,
            UnverifiedHeader::Internal,
            Caller::ApiCredential,
        ),
        (
            Authenticated::ApiCredential,
            UnverifiedHeader::Bot,
            Caller::Bot,
        ),
    ] {
        assert_eq!(
            resolve_caller(CallerEvidence {
                authenticated,
                header: Some(header),
                ..PERSON
            }),
            Some(caller),
            "{authenticated:?} {header:?}"
        );
    }
    // A program's claim or any scope still wins over a header.
    assert_eq!(
        resolve_caller(CallerEvidence {
            header: Some(UnverifiedHeader::Internal),
            program: true,
            ..PERSON
        }),
        Some(Caller::Program)
    );
}
