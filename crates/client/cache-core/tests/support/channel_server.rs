//! A server's channel as its change log says it is, the reference device
//! timelines are checked against.

use std::collections::BTreeMap;

/// How many changes back the server replays.
pub const REPLAY: u64 = 1_000;

/// One message over its whole life.
#[derive(Clone, Debug)]
pub struct Message {
    pub id: String,
    pub channel: String,
    pub thread: Option<String>,
    pub sort_key: String,
    pub created: u64,
    /// Each edit's sequence; the text names the sequence it was written at.
    pub edits: Vec<u64>,
    pub deleted: Option<u64>,
}

impl Message {
    /// The text as of the last edit at or before `seq`.
    pub fn version(&self, seq: u64) -> u64 {
        self.edits
            .iter()
            .rev()
            .find(|edit| **edit <= seq)
            .copied()
            .unwrap_or(self.created)
    }

    pub fn gone_by(&self, seq: u64) -> bool {
        self.deleted.is_some_and(|deleted| deleted <= seq)
    }

    fn changed_after(&self, seq: u64) -> bool {
        self.created.max(self.edits.last().copied().unwrap_or(0)) > seq
    }
}

/// One entry as an answer carries it.
#[derive(Clone, Debug)]
pub struct Entry {
    pub message: Message,
    pub version: u64,
    /// The newest replies of a root.
    pub preview: Vec<Entry>,
}

/// One list of a channel: its roots, or the replies of a thread.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct List {
    pub channel: String,
    pub thread: Option<String>,
}

/// Where a page is anchored in its list.
#[derive(Clone, Debug)]
pub enum Anchor {
    Latest,
    Before(String),
    After(String),
}

/// What the client asks.
#[derive(Clone, Debug)]
pub enum Request {
    Page {
        list: List,
        anchor: Anchor,
        limit: usize,
        reset: bool,
    },
    Changes {
        channel: String,
        from: u64,
    },
    /// One message with the sequence it was read at.
    Stamped(String),
    /// One message without one.
    Undated(String),
}

/// What the server answers.
#[derive(Clone, Debug)]
pub enum Answer {
    Page {
        list: List,
        seq: u64,
        entries: Vec<Entry>,
        /// The stretch listed in full.
        span: Option<(String, String)>,
        reset: bool,
    },
    Changes {
        channel: String,
        from: u64,
        seq: u64,
        entries: Vec<Entry>,
        removed: Vec<String>,
    },
    Stamped {
        channel: String,
        seq: u64,
        entry: Entry,
    },
    Undated(Entry),
}

#[derive(Clone, Debug)]
pub struct Server {
    seqs: BTreeMap<String, u64>,
    pub messages: BTreeMap<String, Message>,
}

impl Server {
    pub fn new(channels: &[&str]) -> Self {
        Self {
            seqs: channels.iter().map(|c| ((*c).to_owned(), 1)).collect(),
            messages: BTreeMap::new(),
        }
    }

    pub fn head(&self, channel: &str) -> u64 {
        self.seqs[channel]
    }

    pub fn advance(&mut self, channel: &str, by: u64) -> u64 {
        let seq = self.seqs.get_mut(channel).unwrap();
        *seq += by;
        *seq
    }

    /// Posts a message, `skew` places before where its turn would put it.
    pub fn post(&mut self, list: &List, skew: usize) -> String {
        let created = self.advance(&list.channel, 1);
        let turn = self.messages.len();
        let id = format!("{}-m{turn}", list.channel);
        let place = (turn * 2 + 1).saturating_sub(skew * 2);
        self.messages.insert(
            id.clone(),
            Message {
                id: id.clone(),
                channel: list.channel.clone(),
                thread: list.thread.clone(),
                sort_key: format!("{place:05}.{turn:05}"),
                created,
                edits: Vec::new(),
                deleted: None,
            },
        );
        id
    }

    pub fn edit(&mut self, id: &str) {
        let channel = self.messages[id].channel.clone();
        let seq = self.advance(&channel, 1);
        self.messages.get_mut(id).unwrap().edits.push(seq);
    }

    /// Deletes a message and, with a root, its replies.
    pub fn delete(&mut self, id: &str) {
        let channel = self.messages[id].channel.clone();
        let seq = self.advance(&channel, 1);
        for message in self.messages.values_mut() {
            if (message.id == id || message.thread.as_deref() == Some(id))
                && message.deleted.is_none()
            {
                message.deleted = Some(seq);
            }
        }
    }

    pub fn live(&self) -> impl Iterator<Item = &Message> {
        self.messages.values().filter(|m| m.deleted.is_none())
    }

    /// A list's live messages, newest first.
    pub fn listed(&self, list: &List) -> Vec<&Message> {
        let mut listed: Vec<_> = self
            .live()
            .filter(|m| m.channel == list.channel && m.thread == list.thread)
            .collect();
        listed.sort_by(|a, b| b.sort_key.cmp(&a.sort_key));
        listed
    }

    fn entry(&self, message: &Message) -> Entry {
        let replies = List {
            channel: message.channel.clone(),
            thread: Some(message.id.clone()),
        };
        Entry {
            version: message.version(u64::MAX),
            preview: match message.thread {
                Some(_) => Vec::new(),
                None => self
                    .listed(&replies)
                    .into_iter()
                    .take(2)
                    .map(|reply| self.entry(reply))
                    .collect(),
            },
            message: message.clone(),
        }
    }

    /// The channel's changes after `from`, as a push or a catch-up has them.
    pub fn changes(&self, channel: &str, from: u64, seq: u64) -> Answer {
        let of_channel = || self.messages.values().filter(|m| m.channel == channel);
        Answer::Changes {
            channel: channel.to_owned(),
            from,
            seq,
            entries: of_channel()
                .filter(|m| m.deleted.is_none() && m.changed_after(from))
                .map(|m| self.entry(m))
                .collect(),
            removed: of_channel()
                .filter(|m| m.deleted.is_some_and(|deleted| deleted > from))
                .map(|m| m.id.clone())
                .collect(),
        }
    }

    /// Answers with what is so now, read no earlier than `seq`. `None` when a
    /// message asked for is gone.
    pub fn answer(&self, request: &Request, seq: u64) -> Option<Answer> {
        let single = |id: &String| {
            self.messages
                .get(id)
                .filter(|m| m.deleted.is_none())
                .map(|m| self.entry(m))
        };
        Some(match request {
            Request::Undated(id) => Answer::Undated(single(id)?),
            Request::Stamped(id) => {
                let entry = single(id)?;
                Answer::Stamped {
                    channel: entry.message.channel.clone(),
                    seq,
                    entry,
                }
            }
            Request::Changes { channel, from } => {
                if seq > from + REPLAY {
                    return self.answer(
                        &Request::Page {
                            list: List {
                                channel: channel.clone(),
                                thread: None,
                            },
                            anchor: Anchor::Latest,
                            limit: 3,
                            reset: true,
                        },
                        seq,
                    );
                }
                self.changes(channel, *from, seq)
            }
            Request::Page {
                list,
                anchor,
                limit,
                reset,
            } => {
                let (entries, span) = self.page(list, anchor, *limit);
                Answer::Page {
                    list: list.clone(),
                    seq,
                    entries: entries.into_iter().map(|m| self.entry(m)).collect(),
                    span,
                    reset: *reset,
                }
            }
        })
    }

    fn page(
        &self,
        list: &List,
        anchor: &Anchor,
        limit: usize,
    ) -> (Vec<&Message>, Option<(String, String)>) {
        const START: &str = "";
        const HEAD: &str = "\u{10FFFF}";
        let mut listed = self.listed(list);
        let (more_older, more_newer) = match anchor {
            Anchor::Latest | Anchor::Before(_) => {
                if let Anchor::Before(before) = anchor {
                    listed.retain(|m| m.sort_key < *before);
                }
                let more = listed.len() > limit;
                listed.truncate(limit);
                (more, false)
            }
            Anchor::After(after) => {
                listed.retain(|m| m.sort_key > *after);
                let more = listed.len() > limit;
                listed.drain(..listed.len().saturating_sub(limit));
                (false, more)
            }
        };
        let key = |message: Option<&&Message>| message.map(|m| m.sort_key.clone());
        let start = match anchor {
            Anchor::After(after) => Some(after.clone()),
            _ if more_older => key(listed.last()),
            _ => Some(START.to_owned()),
        };
        let end = match anchor {
            Anchor::Before(before) => Some(before.clone()),
            Anchor::Latest => Some(HEAD.to_owned()),
            Anchor::After(_) if more_newer => key(listed.first()),
            Anchor::After(_) => Some(HEAD.to_owned()),
        };
        (listed, start.zip(end))
    }
}
