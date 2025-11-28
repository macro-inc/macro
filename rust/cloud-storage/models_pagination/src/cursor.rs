use base64::{DecodeError, Engine, engine::general_purpose};
use either::Either;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{cmp::Ordering, marker::PhantomData};
use thiserror::Error;

/// struct which encapsulates a single page of cursor based pagination result
#[derive(Debug, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Paginated<T, U> {
    /// the list of items on this page
    pub items: Vec<T>,
    /// the id of the cursor where the next page of items begins
    /// this doesn't exist if we are at the end of results
    pub next_cursor: Option<U>,
}

impl<T, U> Paginated<T, U> {
    /// maps the inner type of the items to a new value using a callback function
    pub fn map<F, V>(self, f: F) -> Paginated<V, U>
    where
        F: FnMut(T) -> V,
    {
        let Paginated { items, next_cursor } = self;

        Paginated {
            items: items.into_iter().map(f).collect(),
            next_cursor,
        }
    }
}

/// Top level cursor information encodes all the required information for paginating by [Cursor]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cursor<Id, C, F> {
    /// the unique id (e.g. i64, uuid, stc) that identifies the last entity
    /// on the previous page
    pub id: Id,
    /// the size of the previous page
    pub limit: usize,
    /// the value of the cursor
    /// this is usually a [CursorVal]
    pub val: C,

    /// the value we are filtering on
    pub filter: F,
}

/// Type alias for a [Cursor] with a [CursorVal] which is [Sortable]
pub type CursorWithVal<Id, V> = Cursor<Id, CursorVal<V>, ()>;

/// Type alias for a [Cursor] with a [CursorVal] which is [Sortable] and some filter value F
pub type CursorWithValAndFilter<Id, V, F> = Cursor<Id, CursorVal<V>, F>;

/// The value of the [Cursor]. That is, the type of sort we are performing
/// as well as the value of that sort on the last item of the page.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CursorVal<C: Sortable> {
    /// the type that we are sorting on, must implement [Sortable]
    pub sort_type: C,
    /// the last value of the [Sortable] from the previous page
    pub last_val: C::Value,
}

/// defines type to be sortable, sortable types must have an associated [Sortable::Value]
pub trait Sortable: std::fmt::Debug {
    /// the value which we sort on e.g. Utc timestamp, float, etc
    type Value: std::fmt::Debug + std::cmp::Ord;
}

enum Direction {
    Asc,
    Desc,
}

/// Intermediary struct which holds information about the page we are going to create.
/// The only use for this struct is to call [Paginator::into_page]
pub struct Paginator<Iter, Cb, S, F> {
    iter: Iter,
    limit: usize,
    cb: Cb,
    sort_on: PhantomData<S>,
    filter_on: F,
    ensure_sort: Option<Direction>,
}

impl<Iter, Cb, S> Paginator<Iter, Cb, S, ()> {
    /// define the filter that the cursor is using
    pub fn filter_on<F>(self, filter: F) -> Paginator<Iter, Cb, S, F> {
        let Paginator {
            iter,
            limit,
            cb,
            sort_on,
            filter_on: (),
            ensure_sort,
        } = self;
        Paginator {
            iter,
            limit,
            cb,
            sort_on,
            filter_on: filter,
            ensure_sort,
        }
    }
}

/// The base trait which extends [Iterator] to create a [Paginator] if the trait bounds are met
pub trait Paginate: Iterator + Sized {
    /// turn the iterator into a [Paginator]
    fn paginate<Cb, S>(self, limit: usize, cb: Cb) -> Paginator<Self, Cb, S, ()>
    where
        Cb: FnMut(&<Self as Iterator>::Item) -> CursorVal<S>,
        S: Sortable;
}

/// extension to [Paginate] with the further requirement that the iterator item implements [SortOn] for this sort value T
pub trait PaginateOn<T: Sortable>: Paginate {
    /// wrapper over [Paginate::paginate]
    fn paginate_on(
        self,
        limit: usize,
        sort: T,
    ) -> Paginator<Self, impl FnMut(&<Self as Iterator>::Item) -> CursorVal<T>, T, ()>
    where
        <Self as Iterator>::Item: SortOn<T>;
}

/// the trait used to uniquely identify a record
pub trait Identify {
    /// the type of the records PK
    type Id;

    /// get the records PK
    fn id(&self) -> Self::Id;
}

/// trait which is required to call [PaginateOn]
/// This should be implemented on the item that we iterate over, for the sortable method T that we are trying to paginate on
pub trait SortOn<T: Sortable> {
    /// Given the input sort method T, return a function which produces the [CursorVal] for that T, from an input Self
    fn sort_on(sort: T) -> impl FnMut(&Self) -> CursorVal<T>;
}

impl<T> Paginate for T
where
    T: Iterator,
    T::Item: Identify,
{
    fn paginate<Cb, S>(self, limit: usize, cb: Cb) -> Paginator<Self, Cb, S, ()>
    where
        Cb: FnOnce(&<Self as Iterator>::Item) -> CursorVal<S>,
        S: Sortable,
    {
        Paginator {
            iter: self,
            limit,
            cb,
            sort_on: PhantomData,
            filter_on: (),
            ensure_sort: None,
        }
    }
}

impl<Iter, T: Sortable> PaginateOn<T> for Iter
where
    Iter: Paginate,
{
    fn paginate_on(
        self,
        limit: usize,
        sort: T,
    ) -> Paginator<Self, impl FnMut(&<Self as Iterator>::Item) -> CursorVal<T>, T, ()>
    where
        <Self as Iterator>::Item: SortOn<T>,
    {
        let cb = <<Self as Iterator>::Item as SortOn<T>>::sort_on(sort);
        self.paginate(limit, cb)
    }
}

/// Type alias for a [Paginated] where we still know the underlying type information of the encoded cursor
/// T: The item type that is listed in each page
/// I: The identity type that is associated with this T. e.g. Uuid
/// C: The sort type of this cursor
/// F: The filter type of this cursor
pub type PaginatedCursor<T, I, C, F> = Paginated<T, Base64Str<CursorWithValAndFilter<I, C, F>>>;

/// Type alias for a [Paginated] where the type information of the cursor has been erased. This is identical in memory layout and serialization shape as [PaginatedTypedCursor]
pub type PaginatedOpaqueCursor<T> = Paginated<T, String>;

impl<Iter, Cb, S, F> Paginator<Iter, Cb, S, F>
where
    Iter: Iterator,
    Iter::Item: Identify,
    Cb: FnMut(&Iter::Item) -> CursorVal<S>,
    S: Sortable + Serialize,
    S::Value: Serialize,
    F: Serialize,
    <Iter::Item as Identify>::Id: Serialize,
{
    /// ensures that the output will be sorted.
    /// You should not use this in most cases as the ideal scenario is that the database should
    /// return an already sorted list.
    /// This is an escape hatch for use when stitching multiple database queries together.
    ///
    /// This will sort the entries in ascending order
    pub fn sort_asc(mut self) -> Self {
        self.ensure_sort = Some(Direction::Asc);
        self
    }
    /// ensures that the output will be sorted.
    /// You should not use this in most cases as the ideal scenario is that the database should
    /// return an already sorted list.
    /// This is an escape hatch for use when stitching multiple database queries together.
    ///
    /// This will sort the entries in descending order
    pub fn sort_desc(mut self) -> Self {
        self.ensure_sort = Some(Direction::Desc);
        self
    }
    /// Turn self into a [PaginatedTypedCursor].
    /// This ensures that the page has the correct number of items and encodes the last element of the page into a base64 json encoded representation of the cursor.
    pub fn into_page(self) -> PaginatedCursor<Iter::Item, <Iter::Item as Identify>::Id, S, F> {
        let Paginator {
            iter,
            limit,
            mut cb,
            filter_on,
            ensure_sort,
            ..
        } = self;

        let mut res: Vec<_> = iter.take(limit).collect();

        if let Some(sort) = ensure_sort {
            res.sort_by_key(|r| {
                let cursor = cb(r);
                match sort {
                    Direction::Asc => Either::Left(cursor.last_val),
                    Direction::Desc => Either::Right(std::cmp::Reverse(cursor.last_val)),
                }
            });
        }

        match res.len().cmp(&limit) {
            Ordering::Less => Paginated {
                items: res,
                next_cursor: None,
            },
            Ordering::Equal | Ordering::Greater => Paginated {
                next_cursor: res
                    .last()
                    .map(|last| Cursor {
                        id: last.id(),
                        limit,
                        val: cb(last),
                        filter: filter_on,
                    })
                    .map(Base64Str::encode_json),
                items: res,
            },
        }
    }
}

/// trait for erasing the strong typing of a Cursor
/// This makes the type less specific but maintains the same inner data
pub trait TypeEraseCursor<T> {
    /// Erase the type of self.
    /// This doesn't actually change any data it just makes the type less sepcific
    fn type_erase(self) -> PaginatedOpaqueCursor<T>;
}

impl<T, I, C: Sortable, F> TypeEraseCursor<T> for PaginatedCursor<T, I, C, F> {
    fn type_erase(self) -> PaginatedOpaqueCursor<T> {
        let Self { items, next_cursor } = self;
        PaginatedOpaqueCursor {
            items,
            next_cursor: next_cursor.map(|c| c.type_erase()),
        }
    }
}

impl<T, I, I2, C: Sortable, C2: Sortable, F, F2> TypeEraseCursor<T>
    for Either<PaginatedCursor<T, I, C, F>, PaginatedCursor<T, I2, C2, F2>>
{
    fn type_erase(self) -> PaginatedOpaqueCursor<T> {
        match self {
            Either::Left(l) => l.type_erase(),
            Either::Right(r) => r.type_erase(),
        }
    }
}

fn serialize_json_string<T: Serialize>(val: &T) -> String {
    serde_json::to_string(val).expect("This is infallible")
}

/// Struct which encapsulated some base64 encoded value which is expected to deserialize to some type T
#[derive(Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Base64Str<T> {
    data: String,
    #[serde(skip)]
    target: PhantomData<T>,
}

/// Errors that can occur while working with a [Base64Str]
#[derive(Debug, Error)]
pub enum Base64SerdeErr<E> {
    /// There was an error decoding data from the base64 string
    #[error(transparent)]
    DecodeErr(#[from] DecodeError),
    /// there was an error with serde
    #[error(transparent)]
    SerdeErr(E),
}

impl<T> Base64Str<T>
where
    T: DeserializeOwned,
{
    /// attempt to decode the base64 and then deserialize the raw bytes.
    /// Pass a callback fn that deserializes the data
    pub fn decode<F, E>(self, f: F) -> Result<T, Base64SerdeErr<E>>
    where
        F: FnOnce(Vec<u8>) -> Result<T, E>,
    {
        let bytes = general_purpose::STANDARD.decode(self.data.as_str())?;
        f(bytes).map_err(Base64SerdeErr::SerdeErr)
    }

    /// decode the base64 bytes then deserialize type T from the decoded bytes
    pub fn decode_json(self) -> Result<T, Base64SerdeErr<serde_json::Error>> {
        self.decode(|bytes| serde_json::from_slice(&bytes))
    }
}

impl<T> Base64Str<T> {
    /// Create a new version of self from a string
    pub fn new_from_string(data: String) -> Self {
        Base64Str {
            data,
            target: PhantomData,
        }
    }

    /// Just return the inner string
    pub fn type_erase(self) -> String {
        self.data
    }
}

impl<T> Base64Str<T>
where
    T: Serialize,
{
    /// Serialize the input value to a string using the input callback function.
    /// Then base64 encode that string, creating an instance of Self
    pub fn encode<F>(val: T, s: F) -> Self
    where
        F: FnOnce(&T) -> String,
    {
        let serialized = s(&val);
        let str = general_purpose::STANDARD.encode(serialized);
        Base64Str::new_from_string(str)
    }

    /// Serialize the input value as a json string and then base64 encode, creating an instance of self
    pub fn encode_json(val: T) -> Self {
        Self::encode(val, serialize_json_string)
    }
}

/// A [Query] is either a sort method T
/// Or a [CursorWithVal]
#[derive(Debug)]
pub enum Query<I, T: Sortable, F> {
    /// a Sort method T
    Sort(T, F),
    /// a [CursorWithVal]
    Cursor(CursorWithValAndFilter<I, T, F>),
}

impl<I, T, F> Clone for Query<I, T, F>
where
    T: Sortable + Clone,
    T::Value: Clone,
    I: Clone,
    F: Clone,
{
    fn clone(&self) -> Self {
        match self {
            Query::Sort(s, f) => Query::Sort(s.clone(), f.clone()),
            Query::Cursor(cursor) => Query::Cursor(cursor.clone()),
        }
    }
}

impl<I, T: Sortable, F> Query<I, T, F> {
    /// create an instance of [Query] from optionally a [CursorWithVal], fallling back to T if it does not exist
    pub fn new(maybe_cursor: Option<CursorWithValAndFilter<I, T, F>>, sort: T, filter: F) -> Self {
        match maybe_cursor {
            Some(c) => Self::Cursor(c),
            None => Self::Sort(sort, filter),
        }
    }

    /// returns the inner sort method [Sortable] for this query
    pub fn sort_method(&self) -> &T {
        match self {
            Query::Sort(s, _) => s,
            Query::Cursor(cursor) => &cursor.val.sort_type,
        }
    }

    /// returns a reference to the inner filter type
    pub fn filter(&self) -> &F {
        match self {
            Query::Sort(_, f) => f,
            Query::Cursor(cursor) => &cursor.filter,
        }
    }

    /// maps this filter type into another one via a callback fn.
    /// This is analagous to [Option::map] over just the filter generic type
    pub fn map_filter<Cb, F2>(self, cb: Cb) -> Query<I, T, F2>
    where
        Cb: FnOnce(F) -> F2,
    {
        match self {
            Query::Sort(a, b) => Query::Sort(a, cb(b)),
            Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter,
            }) => Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: cb(filter),
            }),
        }
    }

    /// returns the entity [Uuid] and [Sortable::Value] if they exist
    pub fn vals(&self) -> (Option<&I>, Option<&T::Value>) {
        match self {
            Query::Sort(_, _) => (None, None),
            Query::Cursor(cursor) => (Some(&cursor.id), Some(&cursor.val.last_val)),
        }
    }
}

impl<I, T, F> Query<I, T, Option<F>>
where
    T: Sortable,
{
    /// Factors out an [Option] from the filter, splitting the type into an [Either]
    pub fn split_option(self) -> Either<Query<I, T, ()>, Query<I, T, F>> {
        match self {
            Query::Sort(t, None) => Either::Left(Query::Sort(t, ())),
            Query::Sort(t, Some(f)) => Either::Right(Query::Sort(t, f)),
            Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: None,
            }) => Either::Left(Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: (),
            })),
            Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: Some(f),
            }) => Either::Right(Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: f,
            })),
        }
    }
}
