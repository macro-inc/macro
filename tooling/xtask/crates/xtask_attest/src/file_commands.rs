//! The files a step writes to hand values to later steps: `GITHUB_OUTPUT`
//! and `GITHUB_ENV` hold `name=value` lines and `name<<DELIMITER` blocks.

use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_till1},
    character::complete::char,
    combinator::rest,
    sequence::separated_pair,
};
use rootcause::prelude::*;

#[cfg(test)]
mod test;

fn key(input: &str) -> IResult<&str, &str> {
    take_till1(|c: char| c == '=' || c == '<').parse(input)
}

/// `name<<DELIMITER`, opening a block that ends at a line holding the delimiter.
fn block_start(input: &str) -> IResult<&str, (&str, &str)> {
    separated_pair(key, tag("<<"), rest).parse(input)
}

fn assignment(input: &str) -> IResult<&str, (&str, &str)> {
    separated_pair(key, char('='), rest).parse(input)
}

/// The values a step wrote, in order.
pub fn parse(text: &str) -> Result<Vec<(String, String)>, Report> {
    let mut lines = text.lines();

    let mut values = Vec::new();
    while let Some(line) = lines.next() {
        if line.is_empty() {
            continue;
        }

        if let Ok(("", (name, delimiter))) = block_start(line) {
            let body: Vec<&str> = lines
                .by_ref()
                .take_while(|line| *line != delimiter)
                .collect();
            values.push((name.to_owned(), body.join("\n")));
        } else if let Ok(("", (name, value))) = assignment(line) {
            values.push((name.to_owned(), value.to_owned()));
        } else {
            bail!("`{line}` is neither `name=value` nor `name<<DELIMITER`");
        }
    }
    Ok(values)
}
