use super::*;
use item_filters::ast::email::AttachmentKind;

fn compiled(tree: Expr<EmailLiteral>) -> String {
    let mut ast = excluded_deferred_partitions();
    ast.document_filter = Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil()))));
    ast.project_filter = Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))));
    ast.chat_filter = Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))));
    ast.email_filter.tree = Some(Arc::new(tree));
    let LocalCompileOutcome::Supported(query) = mail::compile(
        &ast,
        request(),
        "ALL",
        &[Uuid::from_u128(1)],
        "macro|viewer@example.com",
    )
    .unwrap() else {
        panic!("{:?} compiles", ast.email_filter.tree)
    };
    format!("{:?}", query.as_query().partitions)
}

#[test]
fn an_attachment_kind_compiles_to_its_exact_fact() {
    for kind in AttachmentKind::ALL {
        let predicate = compiled(Expr::val(EmailLiteral::Attachment(kind)));
        assert!(
            predicate.contains(mail::ATTACHMENT_ATTRIBUTE),
            "{predicate}"
        );
        assert!(
            predicate.contains(&format!("{:?}", mail::attachment_value(kind))),
            "{predicate}"
        );
    }
    // Negated and combined, as the Email view's facets send them.
    compiled(Expr::is_not(Expr::val(EmailLiteral::Attachment(
        AttachmentKind::Pdf,
    ))));
    compiled(Expr::or(
        Expr::val(EmailLiteral::Attachment(AttachmentKind::Pdf)),
        Expr::val(EmailLiteral::Attachment(AttachmentKind::Image)),
    ));
}

#[test]
fn each_kind_has_its_own_value() {
    let values = AttachmentKind::ALL.map(mail::attachment_value);
    for (index, value) in values.iter().enumerate() {
        assert!(!values[..index].contains(value));
    }
}

#[test]
fn kinds_come_from_the_server_flags_mime_prefixes() {
    assert_eq!(mail::attachment_kinds([]), vec![]);
    assert_eq!(
        mail::attachment_kinds(["application/zip", "", "APPLICATION/PDF"]),
        vec![],
        "an unknown type, an empty one, and case the server's LIKE would not match"
    );
    assert_eq!(
        mail::attachment_kinds([
            "image/png",
            "application/pdf; name=a.pdf",
            "image/jpeg",
            "text/csv"
        ]),
        vec![
            AttachmentKind::Pdf,
            AttachmentKind::Image,
            AttachmentKind::Document
        ],
        "each kind once, in declaration order, by prefix"
    );
    for kind in AttachmentKind::ALL {
        for prefix in kind.mime_prefixes() {
            assert_eq!(mail::attachment_kinds([*prefix]), vec![kind]);
        }
    }
}
