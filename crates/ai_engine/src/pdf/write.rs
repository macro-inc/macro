//! Writing PDF: objects as syntax, and whole files with a cross-reference
//! table (rewritten, or appended to the original as an incremental
//! update).

use super::{Dict, ObjRef, Object};

/// Writes an object's syntax (streams with their dictionary, `Length`
/// set from their data).
pub fn object(o: &Object, out: &mut Vec<u8>) {
    let _ = (o, out);
    todo!("write::object")
}

/// A complete file: header for `version`, every object, a cross-reference
/// table, and `trailer` (its `Size` set).
pub fn file(version: &str, objects: &[(ObjRef, Object)], trailer: &Dict) -> Vec<u8> {
    let _ = (version, objects, trailer);
    todo!("write::file")
}

/// The original file with an incremental update appended: the changed and
/// new `objects`, a cross-reference section for them, and a trailer
/// pointing back to the original's (`Prev`).
pub fn incremental(original: &[u8], objects: &[(ObjRef, Object)], trailer: &Dict) -> Vec<u8> {
    let _ = (original, objects, trailer);
    todo!("write::incremental")
}
