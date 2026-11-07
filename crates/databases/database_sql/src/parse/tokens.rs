//! A token slice as nom input, for the SQL statement parser and the formula
//! parser alike.

use nom::Input;

use super::lexer::Token;

/// The input: the tokens left and where the source ends, so an error at the
/// end has a position. A newtype because nom implements [`Input`] only for
/// bytes and `&str`.
#[derive(Debug)]
pub(crate) struct Tokens<'a, Item = Token> {
    pub(crate) tokens: &'a [Item],
    pub(crate) end: usize,
}

// By hand: a derive would ask `Item: Copy`, though only a reference is held.
impl<Item> Clone for Tokens<'_, Item> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<Item> Copy for Tokens<'_, Item> {}

impl<Item> std::ops::Deref for Tokens<'_, Item> {
    type Target = [Item];
    fn deref(&self) -> &Self::Target {
        self.tokens
    }
}

impl<'a, Item> Input for Tokens<'a, Item> {
    type Item = &'a Item;
    type Iter = std::slice::Iter<'a, Item>;
    type IterIndices = std::iter::Enumerate<std::slice::Iter<'a, Item>>;

    fn input_len(&self) -> usize {
        self.tokens.len()
    }
    fn take(&self, index: usize) -> Self {
        Tokens {
            tokens: &self.tokens[..index],
            end: self.end,
        }
    }
    fn take_from(&self, index: usize) -> Self {
        Tokens {
            tokens: &self.tokens[index..],
            end: self.end,
        }
    }
    fn take_split(&self, index: usize) -> (Self, Self) {
        let (head, tail) = self.tokens.split_at(index);
        (
            Tokens {
                tokens: tail,
                end: self.end,
            },
            Tokens {
                tokens: head,
                end: self.end,
            },
        )
    }
    fn position<Predicate: Fn(Self::Item) -> bool>(&self, predicate: Predicate) -> Option<usize> {
        self.tokens.iter().position(predicate)
    }
    fn iter_elements(&self) -> Self::Iter {
        self.tokens.iter()
    }
    fn iter_indices(&self) -> Self::IterIndices {
        self.tokens.iter().enumerate()
    }
    fn slice_index(&self, count: usize) -> Result<usize, nom::Needed> {
        if count <= self.tokens.len() {
            Ok(count)
        } else {
            Err(nom::Needed::new(count - self.tokens.len()))
        }
    }
}
