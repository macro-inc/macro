//! `webhook` rows: the cases a provider webhook handler tells apart, read
//! from the handler's own `match`.

use rootcause::prelude::*;
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{ExprLit, ExprMatch, Item, Lit, Member, Pat};

use super::Entry;
use crate::repo::{Loc, Repo};
use crate::sources::WebhookSource;

/// Lists `<prefix>:validation`, `<prefix>:change` and one
/// `<prefix>:lifecycle:<event>` per lifecycle event the handler matches.
pub(crate) fn list(repo: &Repo, source: &WebhookSource) -> Result<Vec<Entry>, Report> {
    let file_name = &source.handler.file;
    let file = repo.parse(file_name)?;
    let handler = file
        .items
        .iter()
        .find_map(|item| match item {
            Item::Fn(function) if function.sig.ident == source.handler.ident => Some(function),
            _ => None,
        })
        .ok_or_else(|| report!("{file_name}:1: no function `{}`", source.handler.ident))?;
    let handler_loc = Loc::new(file_name, handler.sig.ident.span());

    let mut uses = FieldUses {
        validation_field: &source.validation_field,
        lifecycle_field: &source.lifecycle_field,
        validation: None,
        lifecycle_matches: Vec::new(),
    };
    uses.visit_item_fn(handler);

    let Some(validation) = uses.validation else {
        bail!(
            "{handler_loc}: `{}` never reads `{}`",
            source.handler.ident,
            source.validation_field
        );
    };
    let [lifecycle] = uses.lifecycle_matches[..] else {
        bail!(
            "{handler_loc}: `{}` does not match on `{}` exactly once",
            source.handler.ident,
            source.lifecycle_field
        );
    };

    let entry = |case: String, span: proc_macro2::Span| Entry {
        key: format!("{}:{case}", source.prefix),
        matcher: String::new(),
        loc: Loc::new(file_name, span),
    };
    let mut entries = vec![entry("validation".to_owned(), validation)];
    let mut has_change = false;

    // `None` is an ordinary change notification, `Some("x")` the lifecycle
    // event `x`, and `_` the events the handler drops.
    for arm in &lifecycle.arms {
        let loc = Loc::new(file_name, arm.pat.span());
        match &arm.pat {
            Pat::Wild(_) => {}
            Pat::Ident(pattern) if pattern.ident == "None" => {
                has_change = true;
                entries.push(entry("change".to_owned(), arm.pat.span()));
            }
            Pat::TupleStruct(pattern) if pattern.path.is_ident("Some") => {
                let mut inner = pattern.elems.iter();
                let (
                    Some(Pat::Lit(ExprLit {
                        lit: Lit::Str(event),
                        ..
                    })),
                    None,
                ) = (inner.next(), inner.next())
                else {
                    bail!("{loc}: this lifecycle arm is not `Some(\"<event>\")`");
                };
                entries.push(entry(
                    format!("lifecycle:{}", event.value()),
                    arm.pat.span(),
                ));
            }
            _ => bail!("{loc}: cannot tell which webhook case this arm handles"),
        }
    }
    if !has_change {
        bail!(
            "{}: the match has no `None` arm for ordinary change notifications",
            Loc::new(file_name, lifecycle.span())
        );
    }

    Ok(entries)
}

struct FieldUses<'a, 'ast> {
    validation_field: &'a str,
    lifecycle_field: &'a str,
    /// Where the validation field is first read.
    validation: Option<proc_macro2::Span>,
    /// Every `match` whose scrutinee reads the lifecycle field.
    lifecycle_matches: Vec<&'ast ExprMatch>,
}

impl<'ast> Visit<'ast> for FieldUses<'_, 'ast> {
    fn visit_expr_field(&mut self, field: &'ast syn::ExprField) {
        if let Member::Named(name) = &field.member
            && name == self.validation_field
            && self.validation.is_none()
        {
            self.validation = Some(name.span());
        }
        syn::visit::visit_expr_field(self, field);
    }

    fn visit_expr_match(&mut self, matched: &'ast ExprMatch) {
        let mut scrutinee = ReadsField {
            field: self.lifecycle_field,
            found: false,
        };
        scrutinee.visit_expr(&matched.expr);
        if scrutinee.found {
            self.lifecycle_matches.push(matched);
        }
        syn::visit::visit_expr_match(self, matched);
    }
}

struct ReadsField<'a> {
    field: &'a str,
    found: bool,
}

impl<'ast> Visit<'ast> for ReadsField<'_> {
    fn visit_expr_field(&mut self, field: &'ast syn::ExprField) {
        if matches!(&field.member, Member::Named(name) if name == self.field) {
            self.found = true;
        }
        syn::visit::visit_expr_field(self, field);
    }
}
