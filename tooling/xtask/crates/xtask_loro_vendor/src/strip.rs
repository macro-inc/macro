//! Removes the source a disabled Cargo feature compiles out.
//!
//! Each `#[cfg(..)]` is evaluated with the feature off and every other
//! predicate unknown. A node whose cfg is false is dropped; a cfg that is true
//! is dropped from its node; an unknown cfg stays, as upstream also has those.
//! Only nodes that carry attributes in statement or item position are handled.
//! The caller rejects any reference to the feature that survives, so an
//! unsupported placement fails instead of passing unseen.

use syn::punctuated::Punctuated;
use syn::visit_mut::{self, VisitMut};
use syn::{Attribute, Expr, ImplItem, Item, Meta, Stmt, Token, TraitItem};

#[cfg(test)]
mod test;

/// A cfg predicate's value with the feature off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Truth {
    True,
    False,
    Unknown,
}

impl Truth {
    fn not(self) -> Self {
        match self {
            Truth::True => Truth::False,
            Truth::False => Truth::True,
            Truth::Unknown => Truth::Unknown,
        }
    }
}

/// Strips `file` as it compiles with `feature` disabled.
pub fn strip_disabled(file: &mut syn::File, feature: &str) -> syn::Result<()> {
    let mut stripper = Stripper {
        feature,
        error: None,
    };
    stripper.visit_file_mut(file);
    stripper.error.map_or(Ok(()), Err)
}

struct Stripper<'feature> {
    feature: &'feature str,
    error: Option<syn::Error>,
}

impl Stripper<'_> {
    fn eval(&self, meta: &Meta) -> syn::Result<Truth> {
        match meta {
            Meta::NameValue(pair) if pair.path.is_ident("feature") => Ok(match &pair.value {
                Expr::Lit(syn::ExprLit {
                    lit: syn::Lit::Str(name),
                    ..
                }) if name.value() == self.feature => Truth::False,
                _ => Truth::Unknown,
            }),
            Meta::List(list) => {
                let nested =
                    || list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated);
                if list.path.is_ident("not") {
                    Ok(self.eval(&list.parse_args::<Meta>()?)?.not())
                } else if list.path.is_ident("all") {
                    let mut all = Truth::True;
                    for meta in nested()? {
                        match self.eval(&meta)? {
                            Truth::False => return Ok(Truth::False),
                            Truth::Unknown => all = Truth::Unknown,
                            Truth::True => {}
                        }
                    }
                    Ok(all)
                } else if list.path.is_ident("any") {
                    let mut any = Truth::False;
                    for meta in nested()? {
                        match self.eval(&meta)? {
                            Truth::True => return Ok(Truth::True),
                            Truth::Unknown => any = Truth::Unknown,
                            Truth::False => {}
                        }
                    }
                    Ok(any)
                } else {
                    Ok(Truth::Unknown)
                }
            }
            _ => Ok(Truth::Unknown),
        }
    }

    /// Whether a node with `attrs` survives; removes its always-true cfgs.
    fn keep(&mut self, attrs: &mut Vec<Attribute>) -> bool {
        let mut keep = true;
        let mut retained = Vec::with_capacity(attrs.len());
        for attr in attrs.drain(..) {
            if !attr.path().is_ident("cfg") {
                retained.push(attr);
                continue;
            }
            match attr.parse_args::<Meta>().and_then(|meta| self.eval(&meta)) {
                Ok(Truth::False) => keep = false,
                Ok(Truth::True) => {}
                Ok(Truth::Unknown) => retained.push(attr),
                Err(error) => {
                    self.error.get_or_insert(error);
                    retained.push(attr);
                }
            }
        }
        *attrs = retained;
        keep
    }

    fn retain<T>(&mut self, nodes: &mut Vec<T>, attrs: fn(&mut T) -> Option<&mut Vec<Attribute>>) {
        nodes.retain_mut(|node| attrs(node).is_none_or(|attrs| self.keep(attrs)));
    }

    fn retain_punctuated<T, P>(
        &mut self,
        nodes: &mut Punctuated<T, P>,
        attrs: fn(&mut T) -> &mut Vec<Attribute>,
    ) {
        let pairs = std::mem::take(nodes).into_pairs();
        *nodes = pairs
            .filter_map(|mut pair| self.keep(attrs(pair.value_mut())).then_some(pair))
            .collect();
    }
}

impl VisitMut for Stripper<'_> {
    fn visit_file_mut(&mut self, file: &mut syn::File) {
        self.retain(&mut file.items, item_attrs);
        visit_mut::visit_file_mut(self, file);
    }
    fn visit_item_mod_mut(&mut self, module: &mut syn::ItemMod) {
        if let Some((_, items)) = &mut module.content {
            self.retain(items, item_attrs);
        }
        visit_mut::visit_item_mod_mut(self, module);
    }
    fn visit_item_impl_mut(&mut self, block: &mut syn::ItemImpl) {
        self.retain(&mut block.items, impl_item_attrs);
        visit_mut::visit_item_impl_mut(self, block);
    }
    fn visit_item_trait_mut(&mut self, block: &mut syn::ItemTrait) {
        self.retain(&mut block.items, trait_item_attrs);
        visit_mut::visit_item_trait_mut(self, block);
    }
    fn visit_block_mut(&mut self, block: &mut syn::Block) {
        self.retain(&mut block.stmts, stmt_attrs);
        visit_mut::visit_block_mut(self, block);
    }
    fn visit_fields_named_mut(&mut self, fields: &mut syn::FieldsNamed) {
        self.retain_punctuated(&mut fields.named, |field| &mut field.attrs);
        visit_mut::visit_fields_named_mut(self, fields);
    }
    fn visit_fields_unnamed_mut(&mut self, fields: &mut syn::FieldsUnnamed) {
        self.retain_punctuated(&mut fields.unnamed, |field| &mut field.attrs);
        visit_mut::visit_fields_unnamed_mut(self, fields);
    }
    fn visit_item_enum_mut(&mut self, item: &mut syn::ItemEnum) {
        self.retain_punctuated(&mut item.variants, |variant| &mut variant.attrs);
        visit_mut::visit_item_enum_mut(self, item);
    }
    fn visit_expr_struct_mut(&mut self, expr: &mut syn::ExprStruct) {
        self.retain_punctuated(&mut expr.fields, |field| &mut field.attrs);
        visit_mut::visit_expr_struct_mut(self, expr);
    }
    fn visit_expr_match_mut(&mut self, expr: &mut syn::ExprMatch) {
        self.retain(&mut expr.arms, |arm| Some(&mut arm.attrs));
        visit_mut::visit_expr_match_mut(self, expr);
    }
}

fn item_attrs(item: &mut Item) -> Option<&mut Vec<Attribute>> {
    Some(match item {
        Item::Const(item) => &mut item.attrs,
        Item::Enum(item) => &mut item.attrs,
        Item::ExternCrate(item) => &mut item.attrs,
        Item::Fn(item) => &mut item.attrs,
        Item::ForeignMod(item) => &mut item.attrs,
        Item::Impl(item) => &mut item.attrs,
        Item::Macro(item) => &mut item.attrs,
        Item::Mod(item) => &mut item.attrs,
        Item::Static(item) => &mut item.attrs,
        Item::Struct(item) => &mut item.attrs,
        Item::Trait(item) => &mut item.attrs,
        Item::TraitAlias(item) => &mut item.attrs,
        Item::Type(item) => &mut item.attrs,
        Item::Union(item) => &mut item.attrs,
        Item::Use(item) => &mut item.attrs,
        _ => return None,
    })
}

fn impl_item_attrs(item: &mut ImplItem) -> Option<&mut Vec<Attribute>> {
    Some(match item {
        ImplItem::Const(item) => &mut item.attrs,
        ImplItem::Fn(item) => &mut item.attrs,
        ImplItem::Type(item) => &mut item.attrs,
        ImplItem::Macro(item) => &mut item.attrs,
        _ => return None,
    })
}

fn trait_item_attrs(item: &mut TraitItem) -> Option<&mut Vec<Attribute>> {
    Some(match item {
        TraitItem::Const(item) => &mut item.attrs,
        TraitItem::Fn(item) => &mut item.attrs,
        TraitItem::Type(item) => &mut item.attrs,
        TraitItem::Macro(item) => &mut item.attrs,
        _ => return None,
    })
}

fn stmt_attrs(stmt: &mut Stmt) -> Option<&mut Vec<Attribute>> {
    match stmt {
        Stmt::Local(local) => Some(&mut local.attrs),
        Stmt::Item(item) => item_attrs(item),
        Stmt::Macro(stmt) => Some(&mut stmt.attrs),
        Stmt::Expr(expr, _) => expr_attrs(expr),
    }
}

/// The outer attributes of an expression statement.
fn expr_attrs(expr: &mut Expr) -> Option<&mut Vec<Attribute>> {
    Some(match expr {
        Expr::Array(expr) => &mut expr.attrs,
        Expr::Assign(expr) => &mut expr.attrs,
        Expr::Async(expr) => &mut expr.attrs,
        Expr::Await(expr) => &mut expr.attrs,
        Expr::Binary(expr) => &mut expr.attrs,
        Expr::Block(expr) => &mut expr.attrs,
        Expr::Break(expr) => &mut expr.attrs,
        Expr::Call(expr) => &mut expr.attrs,
        Expr::Cast(expr) => &mut expr.attrs,
        Expr::Closure(expr) => &mut expr.attrs,
        Expr::Const(expr) => &mut expr.attrs,
        Expr::Continue(expr) => &mut expr.attrs,
        Expr::Field(expr) => &mut expr.attrs,
        Expr::ForLoop(expr) => &mut expr.attrs,
        Expr::Group(expr) => &mut expr.attrs,
        Expr::If(expr) => &mut expr.attrs,
        Expr::Index(expr) => &mut expr.attrs,
        Expr::Infer(expr) => &mut expr.attrs,
        Expr::Let(expr) => &mut expr.attrs,
        Expr::Lit(expr) => &mut expr.attrs,
        Expr::Loop(expr) => &mut expr.attrs,
        Expr::Macro(expr) => &mut expr.attrs,
        Expr::Match(expr) => &mut expr.attrs,
        Expr::MethodCall(expr) => &mut expr.attrs,
        Expr::Paren(expr) => &mut expr.attrs,
        Expr::Path(expr) => &mut expr.attrs,
        Expr::Range(expr) => &mut expr.attrs,
        Expr::RawAddr(expr) => &mut expr.attrs,
        Expr::Reference(expr) => &mut expr.attrs,
        Expr::Repeat(expr) => &mut expr.attrs,
        Expr::Return(expr) => &mut expr.attrs,
        Expr::Struct(expr) => &mut expr.attrs,
        Expr::Try(expr) => &mut expr.attrs,
        Expr::TryBlock(expr) => &mut expr.attrs,
        Expr::Tuple(expr) => &mut expr.attrs,
        Expr::Unary(expr) => &mut expr.attrs,
        Expr::Unsafe(expr) => &mut expr.attrs,
        Expr::While(expr) => &mut expr.attrs,
        Expr::Yield(expr) => &mut expr.attrs,
        _ => return None,
    })
}
