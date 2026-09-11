//! Offline Mail tab predicates over canonical thread facts and preview membership.
use super::*;
use item_filters::SharedEmailFilter;

/// Stable, separately versioned Mail projection; existing Soup profiles remain usable.
pub fn profile() -> Profile {
    Profile::new(token("soup-mail-v2"))
}
/// Email thread partition.
pub fn partition() -> Token {
    token("email")
}
/// Mail-owned fact vocabulary.
pub fn token(value: &str) -> Token {
    Token::new(value).expect("static Mail token")
}

/// Compile email-only Mail tabs. Readable inbox scope comes from emailLinks;
/// Shared uses actual thread grants plus the Mail UI's different-owner policy.
/// Owner inequality alone never establishes shared eligibility.
pub fn compile(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
    view: &str,
    links: &[Uuid],
    viewer: &str,
) -> Result<LocalCompileOutcome, CompileError> {
    let unsupported = || LocalCompileOutcome::Unsupported(UnsupportedReason::Literal("email"));
    if !matches!(view, "ALL" | "INBOX" | "DRAFTS" | "SENT")
        || ast.properties_filter.is_some()
        || ast.email_filter.crm_scope.is_some()
        || links.len() > 100
    {
        return Ok(unsupported());
    }
    for result in [
        unsupported_partition(
            ast.document_filter.as_deref(),
            "document",
            |l| matches!(l, DocumentLiteral::Id(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.project_filter.as_deref(),
            "project",
            |l| matches!(l, ProjectLiteral::ProjectIdSelf(id) | ProjectLiteral::ProjectId(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.chat_filter.as_deref(),
            "chat",
            |l| matches!(l, ChatLiteral::ChatId(id) if id.is_nil()),
        ),
    ] {
        if result.is_err() {
            return Ok(unsupported());
        }
    }
    let mut rest = ast.clone();
    rest.email_filter.tree = Some(std::sync::Arc::new(Expr::val(EmailLiteral::ThreadId(
        Uuid::nil(),
    ))));
    if !matches!(check_soup_flat_v3(&rest, request), Eligibility::Supported) {
        return Ok(unsupported());
    }
    if !supported(ast.email_filter.tree.as_deref(), true) {
        return Ok(unsupported());
    }
    let mut sharing = Vec::new();
    collect_sharing(ast.email_filter.tree.as_deref(), &mut sharing);
    if sharing.windows(2).any(|pair| pair[0] != pair[1]) {
        return Ok(unsupported());
    }
    let sharing = sharing
        .first()
        .copied()
        .unwrap_or(&SharedEmailFilter::Exclude);
    let sort = token(match view {
        "INBOX" => "mail-inbox-ts",
        "SENT" => "mail-sent-ts",
        _ => "mail-all-ts",
    });
    let mut predicate = compile_expr(ast.email_filter.tree.as_deref(), |literal| {
        Ok(match literal {
            EmailLiteral::ThreadId(id) => exact_uuid(vocabulary::id(), id),
            EmailLiteral::Owner(id) => exact_uuid(token("mail-link-id"), id),
            EmailLiteral::Read(value) => boolean("mail-read", *value),
            EmailLiteral::InboxVisible(value) => boolean("mail-inbox", *value),
            EmailLiteral::Importance(value) => boolean("mail-signal", *value),
            EmailLiteral::UpdatedAt(value) => date_expr(sort.clone(), value),
            EmailLiteral::Shared(_) => PredicateExpr::All,
            EmailLiteral::CalendarOnly(true) => boolean("mail-calendar", true),
            EmailLiteral::CalendarOnly(false) => PredicateExpr::All,
            _ => unreachable!("Mail eligibility checked"),
        })
    })?;
    let owned_scope = links
        .iter()
        .map(|id| exact_uuid(token("mail-link-id"), id))
        .reduce(|a, b| PredicateExpr::Or(Box::new(a), Box::new(b)))
        .unwrap_or(PredicateExpr::None);
    let shared_scope = boolean("mail-shared", true);
    let scope = if links.is_empty() {
        // Soup currently skips the entire email leg when no readable inbox exists.
        PredicateExpr::None
    } else {
        match sharing {
            SharedEmailFilter::Exclude => owned_scope,
            SharedEmailFilter::Include => {
                PredicateExpr::Or(Box::new(owned_scope), Box::new(shared_scope))
            }
            SharedEmailFilter::Only => PredicateExpr::And(
                Box::new(shared_scope),
                Box::new(PredicateExpr::Not(Box::new(exact_utf8(
                    token("mail-owner"),
                    viewer,
                )?))),
            ),
        }
    };
    for gate in [scope, boolean("mail-has-message", true)] {
        predicate = PredicateExpr::And(Box::new(predicate), Box::new(gate));
    }
    if view == "INBOX" {
        predicate = PredicateExpr::And(
            Box::new(predicate),
            Box::new(PredicateExpr::And(
                Box::new(boolean("mail-inbox", true)),
                Box::new(PredicateExpr::I64Range {
                    attribute: sort.clone(),
                    lower: None,
                    upper: None,
                }),
            )),
        );
    }
    if matches!(view, "DRAFTS" | "SENT") {
        let attribute = token(if view == "DRAFTS" {
            "mail-draft-message"
        } else {
            "mail-sent-message"
        });
        predicate = PredicateExpr::And(
            Box::new(predicate),
            Box::new(PredicateExpr::ExactExists { attribute }),
        );
        if view == "SENT" {
            predicate = PredicateExpr::And(
                Box::new(predicate),
                Box::new(PredicateExpr::I64Range {
                    attribute: sort.clone(),
                    lower: None,
                    upper: None,
                }),
            );
        }
    }
    Ok(LocalCompileOutcome::Supported(ValidatedIndexQuery::new(
        IndexQuery {
            profile: profile(),
            partitions: vec![PartitionPredicate {
                partition: partition(),
                predicate,
            }],
            sort_attribute: sort,
            sort_direction: request.direction,
            tie_break_direction: request.direction,
            limit: request.limit,
        },
    )?))
}

/// Canonical Boolean posting shared by projection and compiler.
pub fn boolean(attribute: &str, value: bool) -> PredicateExpr {
    PredicateExpr::Exact {
        attribute: token(attribute),
        value: ExactValue::new([u8::from(value)]).expect("bounded boolean"),
    }
}

fn collect_sharing<'a>(
    expr: Option<&'a Expr<EmailLiteral>>,
    modes: &mut Vec<&'a SharedEmailFilter>,
) {
    match expr {
        Some(Expr::And(a, b)) => {
            collect_sharing(Some(a), modes);
            collect_sharing(Some(b), modes);
        }
        Some(Expr::Literal(EmailLiteral::Shared(mode))) => modes.push(mode),
        _ => {}
    }
}

fn supported(expr: Option<&Expr<EmailLiteral>>, allow_shared: bool) -> bool {
    match expr {
        None => true,
        Some(Expr::And(a, b)) => {
            supported(Some(a), allow_shared) && supported(Some(b), allow_shared)
        }
        Some(Expr::Or(a, b)) => supported(Some(a), false) && supported(Some(b), false),
        Some(Expr::Not(inner)) => supported(Some(inner), false),
        Some(Expr::Literal(EmailLiteral::Shared(_))) => allow_shared,
        Some(Expr::Literal(lit)) => matches!(
            lit,
            EmailLiteral::ThreadId(_)
                | EmailLiteral::Owner(_)
                | EmailLiteral::Read(_)
                | EmailLiteral::InboxVisible(_)
                | EmailLiteral::Importance(_)
                | EmailLiteral::UpdatedAt(_)
                | EmailLiteral::CalendarOnly(_)
        ),
    }
}
