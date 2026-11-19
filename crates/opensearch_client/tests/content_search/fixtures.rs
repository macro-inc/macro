//! What the tests seed and search for, with the rule each case checks.

use models_opensearch::OpenSearchEntityType;
use opensearch_client::search::documents::DocumentTermMatching;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Kind {
    Document,
    Chat,
    Call,
}

pub(crate) const KINDS: [Kind; 3] = [Kind::Document, Kind::Chat, Kind::Call];

impl Kind {
    pub(crate) fn index(self) -> OpenSearchEntityType {
        match self {
            Kind::Document => OpenSearchEntityType::Documents,
            Kind::Chat => OpenSearchEntityType::Chats,
            Kind::Call => OpenSearchEntityType::CallRecords,
        }
    }

    /// The field a name search matches; chats have no name search.
    pub(crate) fn title_field(self) -> Option<&'static str> {
        match self {
            Kind::Document => Some("document_name"),
            Kind::Chat => None,
            Kind::Call => Some("name"),
        }
    }
}

/// Who may find an entity. A document or chat is the viewer's when they own
/// it, and shared when its id is among the ids the search is given; a call is
/// visible only when its id is given.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Access {
    Own,
    Shared,
    Other,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Deleted {
    Nothing,
    /// One part is removed through the crate's delete path after the merge,
    /// so its words stay in the shard's term dictionary. Call segments are
    /// only ever deleted with their call, so this applies to documents and
    /// chats.
    Part(usize),
    Whole,
}

/// One entity, seeded as a document, a chat and a call alike: its parts are
/// the document's chunks, the chat's messages and the call's segments.
pub(crate) struct Fixture {
    /// Also the entity's name (a document's or call's title).
    pub(crate) name: &'static str,
    pub(crate) access: Access,
    pub(crate) parts: &'static [&'static str],
    pub(crate) deleted: Deleted,
}

pub(crate) const FIXTURES: &[Fixture] = &[
    // The crowded prefix: `con` must find this past the crowd's words.
    Fixture {
        name: "conveyor",
        access: Access::Own,
        parts: &["The conveyor belt stopped at noon."],
        deleted: Deleted::Nothing,
    },
    // Access: another user's match is never returned, a shared one is.
    Fixture {
        name: "another user's conveyor",
        access: Access::Other,
        parts: &["Conveyor inventory for the plant"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "shared conveyor manual",
        access: Access::Shared,
        parts: &["Shared conveyor manual"],
        deleted: Deleted::Nothing,
    },
    // `con` only in the name, and only in the content: a name search finds
    // the first, a content search the second.
    Fixture {
        name: "contract draft",
        access: Access::Own,
        parts: &["Terms for the new lease"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "meeting notes",
        access: Access::Own,
        parts: &["The conference starts at nine"],
        deleted: Deleted::Nothing,
    },
    // Two words: `auto-con` keeps them adjacent and expands `con` capped.
    Fixture {
        name: "auto-conveyor",
        access: Access::Own,
        parts: &["The auto-conveyor line restarted"],
        deleted: Deleted::Nothing,
    },
    // Several terms: `All` needs each term somewhere in the entity, in any
    // part; `Dynamic` needs most of them in one part.
    Fixture {
        name: "quarterly and forecast apart",
        access: Access::Own,
        parts: &["Quarterly revenue grew again", "The forecast for next year"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "quarterly alone",
        access: Access::Own,
        parts: &["Quarterly numbers are in"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "one passage",
        access: Access::Own,
        parts: &["The quarterly revenue forecast dashboard is ready"],
        deleted: Deleted::Nothing,
    },
    // A phrase: its tokens in order at consecutive positions.
    Fixture {
        name: "deal review",
        access: Access::Own,
        parts: &["Notes from the deal review on Friday"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "review the deal",
        access: Access::Own,
        parts: &["We will review the deal later"],
        deleted: Deleted::Nothing,
    },
    // Punctuation: the analyzer splits `e-mail` into `e` and `mail`, keeps
    // `o'brien` and `node.js` whole, and reads `C++` as `c`.
    Fixture {
        name: "punctuation",
        access: Access::Own,
        parts: &["Send the e-mail to O'Brien about node.js and C++"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "email",
        access: Access::Own,
        parts: &["Check your email inbox"],
        deleted: Deleted::Nothing,
    },
    // Non-ASCII: `café` is not folded to `cafe`, and CJK text is one token
    // per ideograph.
    Fixture {
        name: "non-ascii",
        access: Access::Own,
        parts: &["Lunch at the café in Zürich", "東京タワーの近く"],
        deleted: Deleted::Nothing,
    },
    // `naïveté` sorts after every `naï` word of the crowd that
    // [`PUNCTUATED_OR_NON_ASCII_CASES`] seeds, in precomposed and in
    // decomposed form (`i` and a combining diaeresis).
    Fixture {
        name: "naïveté",
        access: Access::Own,
        parts: &["Its naïveté showed", "Its nai\u{0308}vete\u{0301} showed"],
        deleted: Deleted::Nothing,
    },
    // One- and two-character terms match as a phrase, never as a prefix.
    Fixture {
        name: "q3",
        access: Access::Own,
        parts: &["Q3 revenue and a plan"],
        deleted: Deleted::Nothing,
    },
    Fixture {
        name: "q34",
        access: Access::Own,
        parts: &["Q34 targets"],
        deleted: Deleted::Nothing,
    },
    // Stopwords: `the` is an ordinary prefix in `All`; `Dynamic` leaves a
    // stopword out of its count unless it is the last term.
    Fixture {
        name: "theme",
        access: Access::Own,
        parts: &["There is a theme to this"],
        deleted: Deleted::Nothing,
    },
    // Deleted: a removed part and a removed entity match nothing.
    Fixture {
        name: "airship with a deleted part",
        access: Access::Own,
        parts: &["Airship schedule for spring", "The zeppelin landed early"],
        deleted: Deleted::Part(1),
    },
    Fixture {
        name: "deleted zeppelin",
        access: Access::Own,
        parts: &["The zeppelin hangar"],
        deleted: Deleted::Whole,
    },
];

/// What a search matches.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// Documents', chats' and calls' parts.
    Content,
    /// Documents' and calls' names: every term matches the name, as a phrase
    /// prefix unless the search is exact, with no short-term rule.
    Name,
}

pub(crate) struct Case {
    pub(crate) terms: &'static [&'static str],
    pub(crate) match_type: &'static str,
    /// Content searches of documents only; chats and calls always need every
    /// term.
    pub(crate) matching: DocumentTermMatching,
    pub(crate) mode: Mode,
}

pub(crate) const CASES: &[Case] = &[
    // A crowded prefix, then the whole word.
    Case {
        terms: &["con"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["conveyor"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    // An exact search matches whole tokens only.
    Case {
        terms: &["conveyor"],
        match_type: "exact",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["conv"],
        match_type: "exact",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["quarterly", "forecast"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["quarterly", "revenue", "forecast"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["quarterly", "revenue", "forecast"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
        mode: Mode::Content,
    },
    // Three of four counted terms in one part, the last one a prefix.
    Case {
        terms: &["quarterly", "revenue", "forecast", "dash"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
        mode: Mode::Content,
    },
    // A stopword in the middle is not counted; one typed last is.
    Case {
        terms: &["deal", "the", "review", "notes"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
        mode: Mode::Content,
    },
    Case {
        terms: &["revenue", "q3", "the"],
        match_type: "partial",
        matching: DocumentTermMatching::Dynamic,
        mode: Mode::Content,
    },
    Case {
        terms: &["deal review"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["e-mail"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["e-ma"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["o'brien"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["node.js"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["café"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["cafe"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["zür"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["東京"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["q3"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    // Not one word to the builders (non-ASCII brackets around it), so the
    // short-term rule counts the term as typed: a prefix, which finds `Q34`.
    Case {
        terms: &["「q3」"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["a"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["the"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["zeppelin"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["airship"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    // Names: the crowd's names hold its `con` words too, so `con` must find
    // the viewer's names past them.
    Case {
        terms: &["con"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Name,
    },
    Case {
        terms: &["shared", "man"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Name,
    },
    Case {
        terms: &["conv"],
        match_type: "exact",
        matching: DocumentTermMatching::All,
        mode: Mode::Name,
    },
];

/// Crowded prefixes of one word with punctuation or a non-ASCII letter. The
/// short-term rule judges the one word: `c++` is the word `c`, so it is exact
/// and finds `C++`; `con.` is the prefix `con`.
///
/// A deleted document keeps its words in the shard's dictionary for a while
/// (soft deletes outlive a merge), so the `naï` crowd these cases seed would
/// still crowd a later [`CASES`] run: no case there searches a `naï` prefix.
pub(crate) const PUNCTUATED_OR_NON_ASCII_CASES: &[Case] = &[
    Case {
        terms: &["con."],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["c++"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["naï"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["nai\u{0308}"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
];

/// Crowded prefixes the search still expands to only the first 256 terms of a
/// shard: the last word of a term of several words, which keeps its words
/// adjacent, and a name prefix under three characters.
pub(crate) const STILL_CAPPED_CASES: &[Case] = &[
    Case {
        terms: &["auto-con"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Content,
    },
    Case {
        terms: &["co"],
        match_type: "partial",
        matching: DocumentTermMatching::All,
        mode: Mode::Name,
    },
];
