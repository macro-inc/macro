//! Fresh restricted Deno processes supervised by the application host, the
//! OCaml compile step in front of them, and the analyses of which SDK
//! operations a program may call.

mod analysis;
pub mod deno;
pub mod ocaml;
