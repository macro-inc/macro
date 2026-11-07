//! Signed wall-clock units, distinct from monotonic `std::time::Duration`.

/// Wall-clock milliseconds since the Unix epoch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct UnixMillis(pub i64);

/// A signed duration in wall-clock milliseconds, used for presence expiry.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct WallDuration(pub i64);
