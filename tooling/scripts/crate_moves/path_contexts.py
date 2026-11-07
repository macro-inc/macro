"""Identify resource paths without interpreting validation strings as paths.

This is a lexical whitelist, not a Rust parser. Comments and string contents
cannot introduce calls. Only known compile-time resource consumers and paths
rooted in Cargo's manifest directory authorize a literal rewrite.
"""
import re
from dataclasses import dataclass


@dataclass
class Token:
    text: str
    start: int
    end: int
    payload: tuple | None = None


def rust_tokens(source):
    tokens = []
    i = 0
    while i < len(source):
        if source[i].isspace():
            i += 1
            continue
        if source.startswith('//', i):
            end = source.find('\n', i)
            i = len(source) if end < 0 else end
            continue
        if source.startswith('/*', i):
            depth = 1
            i += 2
            while i < len(source) and depth:
                if source.startswith('/*', i):
                    depth += 1
                    i += 2
                elif source.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            continue
        raw = re.match(r'(?:br|cr|r)(#*)"', source[i:])
        ordinary = re.match(r'(?:b|c)?"', source[i:])
        if raw or ordinary:
            match = raw or ordinary
            start = i + match.end()
            if raw:
                closing = '"' + raw.group(1)
                end = source.find(closing, start)
                end = len(source) if end < 0 else end
                stop = min(len(source), end + len(closing))
            else:
                end = start
                while end < len(source):
                    if source[end] == '\\':
                        end += 2
                    elif source[end] == '"':
                        break
                    else:
                        end += 1
                stop = min(len(source), end + 1)
            tokens.append(Token(source[i:stop], i, stop, (start, end)))
            i = stop
            continue
        # A character is a token too; a lifetime's apostrophe is punctuation.
        char = re.match(r"(?:b)?'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'", source[i:])
        word = re.match(r'[A-Za-z_][A-Za-z_0-9]*|::', source[i:])
        match = char or word
        end = i + match.end() if match else i + 1
        tokens.append(Token(source[i:end], i, end))
        i = end
    return tokens


def rust_resources(source):
    """Yield (payload start, end, file/manifest) for authorized literals."""
    tokens = rust_tokens(source)
    words = [token.text for token in tokens]
    pairs, parents, stack = {}, {}, []
    scopes = []
    scope_at = []
    for i, word in enumerate(words):
        scope_at.append(tuple(scopes))
        parents[i] = tuple(stack)
        if word in ('(', '[', '{'):
            stack.append(i)
            if word == '{':
                scopes.append(i)
        elif word in (')', ']', '}') and stack:
            opener = stack.pop()
            pairs[opener] = i
            pairs[i] = opener
            if word == '}' and scopes:
                scopes.pop()

    def name_before(index):
        end = index
        if end and words[end - 1] == '!':
            end -= 1
        start = end - 1
        while start >= 2 and words[start - 1] == '::':
            start -= 2
        return ''.join(words[max(0, start):end])

    def literal(index):
        token = tokens[index]
        return source[slice(*token.payload)] if token.payload else None

    def manifest_expression(start, end, at, seen=()):
        while end > start and words[end - 1] == '?':
            end -= 1
        if end == start + 1:
            name = words[start]
            if name in seen:
                return False
            statement = at - 1
            while statement >= 0 and words[statement] not in (';', '{', '}'):
                statement -= 1
            if '|' in words[statement + 1:at] and name in words[statement + 1:at]:
                return False
            # Restrict variable provenance to the same lexical block. This
            # deliberately does not infer through function/closure/loop scopes.
            for pos in range(at - 1, -1, -1):
                if words[pos] != 'let' or scope_at[pos] != scope_at[at]:
                    continue
                eq = pos + 1
                while eq < at and words[eq] not in ('=', ';'):
                    eq += 1
                if eq >= at or words[eq] != '=' or name not in words[pos + 1:eq]:
                    continue
                if words[pos + 1:eq] != [name] and not (
                    words[pos + 1:pos + 3] == [name, ':']
                ):
                    return False
                stop = eq + 1
                while stop < at and words[stop] != ';':
                    if words[stop] in ('(', '[', '{') and stop in pairs:
                        stop = pairs[stop]
                    stop += 1
                # Any subsequent reassignment invalidates the original base.
                if any(words[j:j + 2] == [name, '='] for j in range(stop + 1, at)):
                    return False
                return manifest_expression(eq + 1, stop, pos, seen + (name,))
            return False
        if end <= start or words[end - 1] != ')':
            return False
        opener = pairs.get(end - 1, -1)
        if opener < start:
            return False
        name = name_before(opener)
        if name in ('env', 'std::env') and (opener == 0 or words[opener - 1] != '!'):
            return False
        if name in ('env', 'std::env', 'env::var', 'env::var_os', 'std::env::var', 'std::env::var_os'):
            return opener + 2 == end - 1 and literal(opener + 1) == 'CARGO_MANIFEST_DIR'
        if name in ('Path::new', 'PathBuf::from', 'std::path::Path::new', 'std::path::PathBuf::from'):
            inner_end = end - 2 if words[end - 2] == ',' else end - 1
            return manifest_expression(opener + 1, inner_end, at, seen)
        if opener >= 2 and words[opener - 2] == '.' and words[opener - 1] in ('unwrap', 'expect', 'ok_or_else'):
            return manifest_expression(start, opener - 2, at, seen)
        return False

    for i, token in enumerate(tokens):
        if token.payload is None:
            continue
        containers = parents[i]
        call = containers[-1] if containers else None
        base = None
        if call is None:
            continue
        name = name_before(call)
        prefix = words[call + 1:i]
        first = not prefix
        macro = call > 0 and words[call - 1] == '!'
        if first and macro and name in (
            'include', 'include_str', 'include_bytes',
            'std::include', 'std::include_str', 'std::include_bytes', 'insta::glob',
        ):
            base = 'file'
        if words[call] == '[' and prefix == ['path', '='] and call > 0 and words[call - 1] == '#':
            base = 'file'
        sqlx_test = any(name_before(p) == 'sqlx::test' for p in containers if words[p] == '(') and any(
            words[p] == '[' and p > 0 and words[p - 1] == '#' for p in containers
        )
        if sqlx_test and name == 'fixtures' and (first or prefix[-1:] == [','] or prefix[-2:] == ['path', '=']):
            base = 'file'
        if sqlx_test and prefix[-2:] == ['migrations', '=']:
            base = 'manifest'
        if first and macro and name == 'sqlx::migrate':
            base = 'manifest'
        if macro and name == 'concat' and any(literal(j) == 'CARGO_MANIFEST_DIR' for j in range(call + 1, i) if tokens[j].payload):
            # Require the preceding expression to actually be the manifest env
            # call, not a string that merely mentions that variable's name.
            comma = next((j for j in range(call + 1, i) if words[j] == ',' and parents[j] == parents[i]), None)
            if comma is not None and i == comma + 1 and manifest_expression(call + 1, comma, i):
                base = 'manifest'
        if first and call >= 2 and words[call - 2:call] == ['.', 'join']:
            start = call - 2
            while start > 0 and words[start - 1] not in ('=', ';', '{', '}', ','):
                if words[start - 1] == ')' and start - 1 in pairs:
                    start = pairs[start - 1]
                start -= 1
            if manifest_expression(start, call - 2, i):
                base = 'manifest'
        if base:
            yield (*token.payload, base)


def markdown_resources(source):
    """Only Markdown link destinations are document-relative resources.

    Inline/fenced code can describe commands with another cwd, validators,
    captured output or Rust rest syntax. Backticks do not authorize a path.
    """
    masked = list(source)

    def hide(start, end):
        for i in range(start, end):
            if masked[i] not in ('\n', '\r'):
                masked[i] = ' '

    offset = 0
    fence = None
    for line in source.splitlines(keepends=True):
        marker = re.match(r' {0,3}(`{3,}|~{3,})(.*)', line)
        if marker:
            delimiter, rest = marker.groups()
            if fence is None:
                fence = delimiter
            elif delimiter[0] == fence[0] and len(delimiter) >= len(fence) and not rest.strip():
                fence = None
            hide(offset, offset + len(line))
        elif fence is not None or line.startswith(('    ', '\t')):
            hide(offset, offset + len(line))
        offset += len(line)
    # Code spans can cross newlines. Equal-length runs close them; their
    # contents cannot introduce a Markdown resource destination.
    for code in re.finditer(r'(?<!`)(`+)(?!`)(.*?)\1(?!`)', ''.join(masked), re.S):
        hide(code.start(), code.end())
    for match in re.finditer(r'\]\(([^\s)]+)\)|^ {0,3}\[[^\]]+\]:[ \t]*(\S+)', ''.join(masked), re.M):
        group = 1 if match.group(1) is not None else 2
        yield match.start(group), match.end(group), 'file'


def recorded_data(path):
    """Captured inputs and applied migrations retain their exact bytes."""
    return any(part in '/' + path for part in (
        '/fixtures/', '/snapshots/', '/testdata/', '/golden/', '/migrations/',
    )) or path.endswith(('.snap', '.sse', '.jsonl', '.har'))


def shell_heredocs(source):
    """Lex shell words/commands; protect heredoc bodies after logical newline.

    Delimiters undergo quote removal, not expansion. Words may contain hashes
    and quoted fragments. Quoted newlines and escaped command continuations
    do not start a body. The bytes in each body are never lexed as shell.
    """
    def word(start):
        value = []
        i = start
        quote = None
        while i < len(source):
            char = source[i]
            if quote:
                if char == quote:
                    quote = None
                    i += 1
                elif char == '\\' and quote == '"' and i + 1 < len(source) and source[i + 1] in '$`"\\\n':
                    if source[i + 1] != '\n':
                        value.append(source[i + 1])
                    i += 2
                else:
                    value.append(char)
                    i += 1
            elif char in ("'", '"'):
                quote = char
                i += 1
            elif char == '\\' and i + 1 < len(source):
                if source[i + 1] != '\n':
                    value.append(source[i + 1])
                i += 2
            elif char.isspace() or char in ';&|()<>' :
                break
            else:
                value.append(char)
                i += 1
        raw = source[start:i]
        if ('$(' in raw or '`' in raw) and re.search(r'(?<!<)<<(?!<)', raw):
            raise ValueError('heredoc inside a quoted command substitution requires explicit inspection before moving')
        return ''.join(value), i

    pending = []
    i = 0
    arithmetic = 0
    while i < len(source):
        char = source[i]
        if source.startswith('\\\n', i):
            i += 2
        elif char == '\n':
            i += 1
            for delimiter, strip_tabs in pending:
                start = i
                while i < len(source):
                    end = source.find('\n', i)
                    end = len(source) if end < 0 else end + 1
                    line = source[i:end].rstrip('\r\n')
                    if strip_tabs:
                        line = line.lstrip('\t')
                    i = end
                    if line == delimiter:
                        break
                yield start, i
            pending = []
        elif char.isspace():
            i += 1
        elif char == '#':
            end = source.find('\n', i)
            i = len(source) if end < 0 else end
        elif source.startswith('((', i):
            arithmetic += 1
            i += 2
        elif arithmetic:
            if source.startswith('))', i):
                arithmetic -= 1
                i += 2
            else:
                i += 1
        elif source.startswith('<<<', i):
            i += 3
        elif source.startswith('<<', i):
            i += 2
            strip_tabs = source[i:i + 1] == '-'
            if strip_tabs:
                i += 1
            while i < len(source) and (source[i] in ' \t' or source.startswith('\\\n', i)):
                i += 2 if source.startswith('\\\n', i) else 1
            start = i
            delimiter, i = word(i)
            if i == start:
                raise ValueError('unsupported shell heredoc delimiter; inspect before moving')
            pending.append((delimiter, strip_tabs))
        elif char in ';&|()<>':
            i += 1
        else:
            _, end = word(i)
            i = max(i + 1, end)
