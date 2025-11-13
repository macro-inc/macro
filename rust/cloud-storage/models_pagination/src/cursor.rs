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
pub struct Cursor<Id, C> {
    /// the unique id (e.g. i64, uuid, stc) that identifies the last entity
    /// on the previous page
    pub id: Id,
    /// the size of the previous page
    pub limit: usize,
    /// the value of the cursor
    /// this is usually a [CursorVal]
    pub val: C,
}

/// Type alias for a [Cursor] with a [CursorVal] which is [Sortable]
pub type CursorWithVal<Id, V> = Cursor<Id, CursorVal<V, ()>>;

/// Type alias for a [Cursor] with a [CursorVal] which is [Sortable] and some filter value F
pub type CursorWithValAndFilter<Id, V, F> = Cursor<Id, CursorVal<V, F>>;

/// The value of the [Cursor]. That is, the type of sort we are performing
/// as well as the value of that sort on the last item of the page.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CursorVal<C: Sortable, F> {
    /// the type that we are sorting on, must implement [Sortable]
    pub sort_type: C,
    /// the last value of the [Sortable] from the previous page
    pub last_val: C::Value,
    /// the value that we are filtering on
    #[serde(default)]
    pub filter: F,
}

/// defines type to be sortable, sortable types must have an associated [Sortable::Value]
pub trait Sortable: std::fmt::Debug {
    /// the value which we sort on e.g. Utc timestamp, float, etc
    type Value: std::fmt::Debug;
}

/// Intermediary struct which holds information about the page we are going to create.
/// The only use for this struct is to call [Paginator::into_page]
pub struct Paginator<Iter, Cb, S, F> {
    iter: Iter,
    limit: usize,
    cb: Cb,
    sort_on: PhantomData<S>,
    filter_on: PhantomData<F>,
}

/// The base trait which extends [Iterator] to create a [Paginator] if the trait bounds are met
pub trait Paginate: Iterator + Sized {
    /// turn the iterator into a [Paginator]
    fn paginate<Cb, S, F>(self, limit: usize, cb: Cb) -> Paginator<Self, Cb, S, F>
    where
        Cb: FnOnce(&<Self as Iterator>::Item) -> CursorVal<S, F>,
        S: Sortable;
}

/// extension to [Paginate] with the further requirement that the iterator item implements [SortOn] for this sort value T
pub trait PaginateOn<T: Sortable>: Paginate {
    /// wrapper over [Paginate::paginate]
    fn paginate_filter_on<F>(
        self,
        limit: usize,
        sort: T,
        filter: F,
    ) -> Paginator<Self, impl FnOnce(&<Self as Iterator>::Item) -> CursorVal<T, F>, T, F>
    where
        <Self as Iterator>::Item: SortOn<T>;

    /// wrapper over [PaginateOn::paginate_filter_on] to create cursor without a filter
    fn paginate_on(
        self,
        limit: usize,
        sort: T,
    ) -> Paginator<Self, impl FnOnce(&<Self as Iterator>::Item) -> CursorVal<T, ()>, T, ()>
    where
        <Self as Iterator>::Item: SortOn<T>,
    {
        PaginateOn::paginate_filter_on(self, limit, sort, ())
    }
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
    fn sort_on<F>(sort: T, filter: F) -> impl FnOnce(&Self) -> CursorVal<T, F>;
}

impl<T> Paginate for T
where
    T: Iterator,
    T::Item: Identify,
{
    fn paginate<Cb, S, F>(self, limit: usize, cb: Cb) -> Paginator<Self, Cb, S, F>
    where
        Cb: FnOnce(&<Self as Iterator>::Item) -> CursorVal<S, F>,
        S: Sortable,
    {
        Paginator {
            iter: self,
            limit,
            cb,
            sort_on: PhantomData,
            filter_on: PhantomData,
        }
    }
}

impl<Iter, T: Sortable> PaginateOn<T> for Iter
where
    Iter: Paginate,
{
    fn paginate_filter_on<F>(
        self,
        limit: usize,
        sort: T,
        filter: F,
    ) -> Paginator<Self, impl FnOnce(&<Self as Iterator>::Item) -> CursorVal<T, F>, T, F>
    where
        <Self as Iterator>::Item: SortOn<T>,
    {
        let cb = <<Self as Iterator>::Item as SortOn<T>>::sort_on(sort, filter);
        self.paginate(limit, cb)
    }
}

/// Type alias for a [Paginated] where we still know the underlying type information of the encoded cursor
pub type PaginatedCursor<T, I, C, F> = Paginated<T, Base64Str<CursorWithValAndFilter<I, C, F>>>;

/// Type alias for a [Paginated] where the type information of the cursor has been erased. This is identical in memory layout and serialization shape as [PaginatedTypedCursor]
pub type PaginatedOpaqueCursor<T> = Paginated<T, String>;

impl<Iter, Cb, S, F> Paginator<Iter, Cb, S, F>
where
    Iter: Iterator,
    Iter::Item: Identify,
    Cb: FnOnce(&Iter::Item) -> CursorVal<S, F>,
    S: Sortable + Serialize,
    S::Value: Serialize,
    F: Serialize,
    <Iter::Item as Identify>::Id: Serialize,
{
    /// Turn self into a [PaginatedTypedCursor].
    /// This ensures that the page has the correct number of items and encodes the last element of the page into a base64 json encoded representation of the cursor.
    pub fn into_page(self) -> PaginatedCursor<Iter::Item, <Iter::Item as Identify>::Id, S, F> {
        let Paginator {
            iter, limit, cb, ..
        } = self;

        let res: Vec<_> = iter.take(limit).collect();

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
    Sort(T),
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
            Query::Sort(s) => Query::Sort(s.clone()),
            Query::Cursor(cursor) => Query::Cursor(cursor.clone()),
        }
    }
}

impl<I, T: Sortable, F> Query<I, T, F> {
    /// create an instance of [Query] from optionally a [CursorWithVal], fallling back to T if it does not exist
    pub fn new(maybe_cursor: Option<CursorWithValAndFilter<I, T, F>>, fallback: T) -> Self {
        match maybe_cursor {
            Some(c) => Self::Cursor(c),
            None => Self::Sort(fallback),
        }
    }

    /// returns the inner sort method [Sortable] for this query
    pub fn sort_method(&self) -> &T {
        match self {
            Query::Sort(s) => s,
            Query::Cursor(cursor) => &cursor.val.sort_type,
        }
    }

    /// returns the entity [Uuid] and [Sortable::Value] if they exist
    pub fn vals(&self) -> (Option<&I>, Option<&T::Value>) {
        match self {
            Query::Sort(_) => (None, None),
            Query::Cursor(cursor) => (Some(&cursor.id), Some(&cursor.val.last_val)),
        }
    }
}
