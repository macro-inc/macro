//! This module provides the abstractions for common collection operations by leveraging the [Identify] trait

use std::collections::HashMap;
use std::hash::Hash;

use crate::Identify;

/// trait which lets us collect to a HashMap keyed on the Identity value
pub trait CollectByIds<A>: Iterator<Item = A>
where
    A: Identify,
    <A as Identify>::Id: Hash + Eq,
{
    /// collect the iterator by ids for O1 lookup
    fn collect_by_ids(self) -> HashMap<<A as Identify>::Id, A>;
}

impl<I, A> CollectByIds<A> for I
where
    I: Iterator<Item = A>,
    A: Identify,
    <A as Identify>::Id: Hash + Eq,
{
    fn collect_by_ids(self) -> HashMap<<A as Identify>::Id, A> {
        self.map(|item| (item.id(), item)).collect()
    }
}

/// iterator extension trait which allows grouping iterator entries in bins via a callback fn
pub trait CollectBy: Iterator {
    /// group the items via the output of a callback fn
    fn group_by<F, Id>(self, cb: F) -> HashMap<Id, Vec<<Self as Iterator>::Item>>
    where
        F: FnMut(&<Self as Iterator>::Item) -> Id,
        Id: Hash + Eq;
}

impl<I> CollectBy for I
where
    I: Iterator,
{
    fn group_by<F, Id>(self, mut cb: F) -> HashMap<Id, Vec<<Self as Iterator>::Item>>
    where
        F: FnMut(&<Self as Iterator>::Item) -> Id,
        Id: Hash + Eq,
    {
        let mut output = HashMap::new();
        for item in self {
            let id = cb(&item);
            output.entry(id).or_insert_with(Vec::new).push(item);
        }
        output
    }
}
