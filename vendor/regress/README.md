# regress - REGex in Rust with EcmaScript Syntax

oh no why

## Introduction

regress is a backtracking regular expression engine implemented in Rust, which targets JavaScript regular expression syntax. See [the crate documentation](https://docs.rs/regress) for more.

It's fast, Unicode-aware, has few dependencies, and has a big test suite. It makes fewer guarantees than the `regex` crate but it enables more syntactic features, such as backreferences and lookaround assertions.

## Syntax

regress targets the EcmaScript 2018 standard regexp syntax, including support for gnarly cases such as variable-width lookbehind assertions containing capture groups. Note that subsequent standard have mostly left regexp syntax untouched, with a few exceptions such as the 'v' flag, which is supported.

### That darn 'u' flag

You will be sad to learn that JavaScript does not use UTF-8.

Originally JavaScript was designed for UCS-2, with 16-bit characters. Later UCS-2 was supplanted with UTF-16; however this was not automatic for regexps, but instead required opt-in for each regexp, with the 'u' flag. For example, the grinning face emoji U+1F600 is represented in a JavaScript string as a surrogate pair U+D83D and U+DE00. In a regexp without the 'u' flag, these surrogate pairs are matched as distinct characters:

    const s = "😀";
    const re = /./;
    const m = s.match(re);
    console.log(m); // returns \uD83D, high surrogate

This behavior is almost never desired but is required by the ES spec. It's also super-awkward to express in Rust, which uses UTF-8 extensively. See below for how regress handles this.

The 'u' flag doesn't just modify character sets; it _also_ affects other behaviors such as how case-insensitive matching works, and (most bizarrely) the behavior of backreferences like \2. For example, in non-Unicode mode, \2 is a backreference if there are at least two capture groups; otherwise it is an octal escape (!).

regress mostly ignores the 'u' flag for character decoding - that's instead given by the call site (see below). regress attempts to implement the other behaviors faithfully.

### Character sets

tl;dr use UTF-8 (or ASCII) input and the 'u' flag, unless you are implementing a JavaScript engine and care about strict conformance.

To support JavaScript pre-Unicode semantics, regress supports multiple input forms on the `Regex` object. These are:

- **UTF-8**. The default (unsuffixed) form. Input is `&str`. This always decodes whole characters from the input string.
- **ASCII**. Use the `*_ascii` family of functions on `Regex` if you know your input is ASCII. Input is still `&str`.
- **UTF-16**. Use the `*_utf16` family of functions. Input is `&[u16]`. Characters are always decoded as UTF-16.
- **UCS-2**. OG JavaScript. Use `*_ucs2` functions. Input is `&[u16]`. Surrogate pairs are split freely. Only use if you want to implement strict JS semantics.

Both the UTF-16 and UCS-2 forms require the Rust feature 'utf16' to be enabled. It is off by default.

### Fun Tools

The `regress-tool` binary can be used for some fun.

You can see how things get compiled with the `dump-phases` cli flag:

    > cargo run 'x{3,4}' 'i' --dump-phases

You can run a little benchmark too, for example:

    > cargo run --release -- 'abcd' --flags 'i' --bench ~/3200.txt


## No AI slop

As written.
