//! `SELECT`: the select list, the tables and joins, `GROUP BY`, `ORDER BY`,
//! `LIMIT` and `OFFSET`.

use nom::Parser;
use nom::branch::alt;
use nom::combinator::{cut, opt, peek, success};
use nom::multi::{many0, separated_list1};
use nom::sequence::{preceded, terminated};

use super::super::ast::{
    Aggregate, AggregateFunction, ColumnRef, Direction, FromItem, Identifier, Item, Join, JoinKind,
    OrderBy, OrderKey, Select, SelectList,
};
use super::super::lexer::TokenKind;
use super::condition::condition;
use super::{
    ParseResult, Tokens, at, column_ref, comma, count, expecting, identifier, keyword, next_token,
    number, refusal, table, token, whole,
};

pub(super) fn select(input: Tokens<'_>) -> ParseResult<'_, Select> {
    let (input, _) = keyword(TokenKind::Select)(input)?;
    let (input, distinct) = opt(keyword(TokenKind::Distinct)).parse(input)?;
    let (input, (items, aliases)) = cut(items).parse(input)?;
    let (input, _) = cut(token(TokenKind::From, "FROM")).parse(input)?;
    let (input, from) =
        cut(table_item("a table name after FROM, like database.table")).parse(input)?;
    let (input, joins) = many0(join).parse(input)?;
    let (input, _) = opt(comma_between_tables).parse(input)?;
    let (input, where_) = opt(preceded(keyword(TokenKind::Where), cut(condition))).parse(input)?;
    let (input, group_by) = opt(preceded(
        keyword(TokenKind::Group),
        cut(preceded(
            token(TokenKind::By, "BY after GROUP"),
            column_ref("a column name after GROUP BY"),
        )),
    ))
    .parse(input)?;
    let (input, order_by) = opt(preceded(
        keyword(TokenKind::Order),
        cut(preceded(
            token(TokenKind::By, "BY after ORDER"),
            separated_list1(comma, order_by),
        )),
    ))
    .parse(input)?;
    let (input, limit) = opt(preceded(
        keyword(TokenKind::Limit),
        cut(count("a row count after LIMIT")),
    ))
    .parse(input)?;
    let (input, offset) = opt(preceded(
        keyword(TokenKind::Offset),
        cut(count("a row count after OFFSET")),
    ))
    .parse(input)?;
    Ok((
        input,
        Select {
            distinct: distinct.is_some(),
            items,
            aliases,
            from,
            joins,
            where_,
            group_by,
            order_by: order_by.unwrap_or_default(),
            limit,
            offset,
        },
    ))
}

/// `FROM a, b`, which SQL reads as a cross join.
fn comma_between_tables(input: Tokens<'_>) -> ParseResult<'_, ()> {
    let (_, ()) = peek(comma).parse(input)?;
    refusal(
        input,
        "tables are combined with JOIN … ON a.column = b.row_id, not a comma",
    )
}

/// `table [[AS] alias]`.
fn table_item<'a>(expected: &'static str) -> impl FnMut(Tokens<'a>) -> ParseResult<'a, FromItem> {
    let mut parser = (
        table(expected),
        alt((
            preceded(keyword(TokenKind::As), cut(identifier("an alias after AS"))).map(Some),
            identifier("an alias").map(Some),
            success(None),
        )),
    )
        .map(|(table, alias)| FromItem { table, alias });
    move |input| parser.parse(input)
}

/// `[INNER] JOIN table ON …` or `LEFT [OUTER] JOIN table ON …`.
fn join(input: Tokens<'_>) -> ParseResult<'_, Join> {
    let (input, kind) = alt((
        keyword(TokenKind::Join).map(|()| JoinKind::Inner),
        preceded(
            keyword(TokenKind::Inner),
            cut(token(TokenKind::Join, "JOIN after INNER")),
        )
        .map(|()| JoinKind::Inner),
        preceded(
            keyword(TokenKind::Left),
            cut(preceded(
                opt(keyword(TokenKind::Outer)),
                token(TokenKind::Join, "JOIN after LEFT"),
            )),
        )
        .map(|()| JoinKind::Left),
    ))
    .parse(input)?;
    let (input, table) =
        cut(table_item("a table name after JOIN, like database.table")).parse(input)?;
    let (input, _) = cut(token(TokenKind::On, "ON after the joined table")).parse(input)?;
    let (input, on) = cut(separated_list1(keyword(TokenKind::And), join_equality)).parse(input)?;
    Ok((input, Join { kind, table, on }))
}

/// `column = column`, the only condition a join accepts. `column HAS column`
/// says the same thing about a multi-valued column: a join already matches
/// any one of a cell's values.
fn join_equality(input: Tokens<'_>) -> ParseResult<'_, (ColumnRef, ColumnRef)> {
    let (input, left) = column_ref("a column to join on, like alias.column")(input)?;
    let (input, _) = cut(expecting(
        "= between the two join columns",
        alt((keyword(TokenKind::Equal), keyword(TokenKind::Has))),
    ))
    .parse(input)?;
    let (input, right) = cut(column_ref("a column of the other table after =")).parse(input)?;
    Ok((input, (left, right)))
}

/// The select list and the aliases some of its items were given.
type ListAndAliases = (SelectList, Vec<(usize, Identifier)>);

fn items(input: Tokens<'_>) -> ParseResult<'_, ListAndAliases> {
    alt((
        keyword(TokenKind::Star).map(|()| (SelectList::Star, Vec::new())),
        separated_list1(comma, aliased_item).map(|entries| {
            let mut items = Vec::with_capacity(entries.len());
            let mut aliases = Vec::new();
            for (index, (item, alias)) in entries.into_iter().enumerate() {
                items.push(item);
                if let Some(alias) = alias {
                    aliases.push((index, alias));
                }
            }
            (SelectList::Items(items), aliases)
        }),
    ))
    .parse(input)
}

/// The name after `AS`: an identifier, or a keyword such as `count` when the
/// select list goes on after it (`,` or `FROM` follows), so `AS FROM` still
/// reads as a missing name.
fn alias_name(input: Tokens<'_>) -> ParseResult<'_, Identifier> {
    alt((
        terminated(
            next_token("", |token| token.kind.keyword_name().map(Identifier)),
            peek(alt((comma, keyword(TokenKind::From)))),
        ),
        identifier("a name for the column after AS"),
    ))
    .parse(input)
}

/// `item [[AS] name]`.
fn aliased_item(input: Tokens<'_>) -> ParseResult<'_, (Item, Option<Identifier>)> {
    (
        item,
        alt((
            preceded(keyword(TokenKind::As), cut(alias_name)).map(Some),
            opt(identifier("an alias")),
        )),
    )
        .parse(input)
}

fn item(input: Tokens<'_>) -> ParseResult<'_, Item> {
    alt((
        aggregate.map(Item::Aggregate),
        column_ref("a column name, an aggregate like COUNT(*) or SUM(column), or *")
            .map(Item::Column),
    ))
    .parse(input)
}

/// `COUNT(*)` or `FUNCTION(column)`. Only a branch if the name is followed by
/// `(`: `count` alone is a column.
fn aggregate(input: Tokens<'_>) -> ParseResult<'_, Aggregate> {
    let (input, function) = terminated(
        next_token("an aggregate", |token| {
            <&'static str>::from(&token.kind)
                .parse::<AggregateFunction>()
                .ok()
        }),
        keyword(TokenKind::LeftParen),
    )
    .parse(input)?;
    let (input, argument) = if function == AggregateFunction::Count {
        alt((
            keyword(TokenKind::Star).map(|()| None),
            column_ref("* or a column name inside COUNT(…)").map(Some),
        ))
        .parse(input)?
    } else {
        column_ref("a column name inside the aggregate")
            .map(Some)
            .parse(input)?
    };
    let (input, _) = cut(token(TokenKind::RightParen, ") to close the aggregate")).parse(input)?;
    Ok((input, Aggregate { function, argument }))
}

fn order_by(input: Tokens<'_>) -> ParseResult<'_, OrderBy> {
    let (input, key) = alt((
        position_key,
        aggregate.map(OrderKey::Aggregate),
        column_ref("a column name, an aggregate, or a select-list position after ORDER BY")
            .map(OrderKey::Column),
    ))
    .parse(input)?;
    let (input, direction) = alt((
        keyword(TokenKind::Desc).map(|()| Direction::Descending),
        opt(keyword(TokenKind::Asc)).map(|_| Direction::Ascending),
    ))
    .parse(input)?;
    Ok((input, OrderBy { key, direction }))
}

/// `ORDER BY 2`: a 1-based select-list position. Any other number is no key
/// at all, so the failure is final and names the position rule.
fn position_key(input: Tokens<'_>) -> ParseResult<'_, OrderKey> {
    let (rest, written) = number("")(input)?;
    match whole(written).filter(|position| *position >= 1) {
        Some(position) => Ok((rest, OrderKey::Position(position))),
        None => Err(nom::Err::Failure(at(
            input,
            "a column name or a 1-based select-list position after ORDER BY",
        ))),
    }
}
