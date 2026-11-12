//! Traits and types for embedding content, storing it in a vector database, and
//! reranking search results.
#![deny(missing_docs)]

use std::borrow::Cow;

pub mod embedding_provider;
pub mod entity;
#[cfg(test)]
mod test;

/// Identifies a distinct embeddable field within a piece of content.
///
/// A single value can expose multiple searchable fields (e.g. `"title"` and
/// `"body"`); the key labels which field a given [`Content`] or [`Embedding`]
/// corresponds to.
pub type SearchKey = &'static str;

/// Text to be embedded or searched, borrowed or owned.
pub type Content<'a> = Cow<'a, str>;

/// A fixed-size embedding vector of `DIMS` dimensions.
pub type Embedding<const DIMS: usize> = [f32; DIMS];

/// An embedding paired with the [`SearchKey`] identifying which field it
/// represents.
///
/// Used as the query input to [`VectorDb::cosine_search`], where no source text
/// is available. See [`LabeledEmbedding`] when the originating [`Content`] is
/// also known.
pub struct KeyedEmbedding<const DIMS: usize> {
    /// Identifies which field this embedding represents.
    pub search_key: SearchKey,
    /// The embedding vector.
    pub embedding: Embedding<DIMS>,
}

/// A single embedded field: its embedding paired with the [`SearchKey`] and
/// [`Content`] it was produced from.
pub struct LabeledEmbedding<'a, const DIMS: usize> {
    /// Identifies which field of the source content this embedding represents.
    pub search_key: SearchKey,
    /// The text that was embedded.
    pub content: Content<'a>,
    /// The embedding vector for [`content`](Self::content).
    pub embedding: Embedding<DIMS>,
}

/// A stored embedding matched by a search, together with its similarity to the
/// query.
pub struct Match<const DIMS: usize> {
    /// similarity to the query
    pub score: f32,
    /// The matched embedding and the content it was produced from.
    pub embedding: LabeledEmbedding<'static, DIMS>,
}

/// The matches belonging to a single entity, grouped under its metadata.
pub struct SearchResults<T, const DIMS: usize> {
    /// Caller-supplied data identifying the matched entity (e.g. its document id).
    pub metadata: T,
    /// The entity's matching embeddings, ordered from most to least similar.
    pub matches: Vec<Match<DIMS>>,
}

/// A type whose content can be turned into embeddable fields.
pub trait Embeddable {
    /// Returns the embeddable fields of this value, each keyed by its
    /// [`SearchKey`].
    fn embedding_content<'a>(&'a self) -> Vec<(SearchKey, Content<'a>)>;
}

/// A model that turns [`Embeddable`] content into `DIMS`-dimensional embeddings.
pub trait EmbeddingModel<const DIMS: usize> {
    /// Embeds each field of `content`, returning one [`LabeledEmbedding`] per
    /// [`SearchKey`] the content exposes.
    fn embed(
        &self,
        content: &(dyn Embeddable + Sync),
    ) -> impl Future<Output = anyhow::Result<Vec<LabeledEmbedding<'static, DIMS>>>> + Send;
}

/// A candidate paired with the relevance score a [`RerankModel`] assigned it.
///
/// Higher scores indicate greater relevance to the query.
pub struct Reranked<T> {
    /// The payload carried through from the original candidate.
    pub item: T,
    /// Relevance score for this candidate; higher is more relevant.
    pub score: f32,
}

/// A model that reorders a set of candidates by their relevance to a query.
///
/// Unlike [`EmbeddingModel`], a reranker scores the query directly against each
/// candidate's content (e.g. a cross-encoder) rather than comparing
/// precomputed embeddings. It is typically used as a refinement step over the
/// coarse [`SearchResults`] returned by [`VectorStore::cosine_search`], which it
/// consumes directly.
pub trait RerankModel<const DIMS: usize> {
    /// Score each candidate against `query` using the [`Content`] of its matched
    /// fields, returning the candidates ordered from most to least relevant.
    ///
    /// Each candidate is supplied as the [`SearchResults`] produced by
    /// [`VectorStore::cosine_search`]; its `metadata` (e.g. the source entity's
    /// id) is carried through to the corresponding [`Reranked`] result
    /// untouched.
    fn rerank<'a, T: Send>(
        &self,
        query: Content<'a>,
        candidates: Vec<SearchResults<T, DIMS>>,
    ) -> impl Future<Output = anyhow::Result<Vec<Reranked<T>>>> + Send;
}

/// A store of `DIMS`-dimensional embeddings supporting upserts and similarity
/// search.
pub trait VectorStore<const DIMS: usize> {
    /// Error returned by the store's operations.
    type Error: Send;
    /// Caller-supplied data associated with a set of embeddings and returned by
    /// searches (e.g. the source document's identifier).
    type Metadata: Send;
    /// caller supplied search parameters
    /// eg: limit, user, team, etc
    type SearchParameters: Send;

    /// Inserts or updates the `embeddings`, associating them with `metadata`.
    fn upsert_embeddings<'a>(
        &self,
        metadata: Self::Metadata,
        embeddings: Vec<LabeledEmbedding<'a, DIMS>>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Returns up to `limit` entities whose stored embeddings are most similar
    /// to `query` by cosine similarity, each grouped into a [`SearchResults`]
    /// and ordered from most to least similar.
    fn cosine_search(
        &self,
        query: Vec<KeyedEmbedding<DIMS>>,
        params: Self::SearchParameters,
    ) -> impl Future<Output = Result<Vec<SearchResults<Self::Metadata, DIMS>>, Self::Error>> + Send;
}
