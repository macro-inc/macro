import { parseColumnName } from './spreadsheet-document';

/** A lexical piece of an Excel A1 formula, enough to find references safely. */
type Piece =
  | { kind: 'string' | 'quoted' | 'bracket' | 'other'; text: string }
  | { kind: 'word'; text: string };

const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;

/** Split formula text without ever looking inside string literals, quoted
 * sheet names or bracketed structured/external references. */
function scan(formula: string): Piece[] {
  const pieces: Piece[] = [];
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < formula.length) {
        if (formula[end] === character) {
          if (formula[end + 1] === character) {
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      pieces.push({
        kind: character === '"' ? 'string' : 'quoted',
        text: formula.slice(index, end + 1),
      });
      index = end + 1;
    } else if (character === '[') {
      let depth = 0;
      let end = index;
      for (; end < formula.length; end++) {
        // An apostrophe escapes the next special character in a column name.
        if (formula[end] === "'" && depth > 0) {
          end++;
          continue;
        }
        if (formula[end] === '[') depth++;
        else if (formula[end] === ']' && --depth === 0) break;
      }
      pieces.push({ kind: 'bracket', text: formula.slice(index, end + 1) });
      index = end + 1;
    } else if (/[\p{L}\p{N}_$\\.]/u.test(character)) {
      let end = index + 1;
      while (end < formula.length && /[\p{L}\p{N}_$\\.?]/u.test(formula[end]))
        end++;
      // Keep a numeric literal's exponent (1.5E+10) in one piece.
      if (
        /^\d+(?:\.\d*)?E$/i.test(formula.slice(index, end)) &&
        /[+-]/.test(formula[end] ?? '') &&
        /\d/.test(formula[end + 1] ?? '')
      ) {
        end += 2;
        while (end < formula.length && /\d/.test(formula[end])) end++;
      }
      pieces.push({ kind: 'word', text: formula.slice(index, end) });
      index = end;
    } else {
      pieces.push({ kind: 'other', text: character });
      index++;
    }
  }
  return pieces;
}

const cellReference = /^(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})$/i;
const columnReference = /^(\$?)([A-Z]{1,3})$/i;
const rowReference = /^(\$?)([1-9]\d{0,6})$/;

/** False for function calls, sheet names and structured-reference table names. */
function referenceContext(pieces: Piece[], index: number) {
  const next = pieces[index + 1];
  return !(
    next?.text === '(' ||
    next?.text === '!' ||
    next?.kind === 'bracket'
  );
}

function columnLetters(column: number) {
  let name = '';
  for (let index = column; index > 0; index = Math.floor((index - 1) / 26))
    name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
  return name;
}

/** Shift relative references, as Excel does for shared formulas and copies.
 * References moved outside the sheet become #REF!. */
export function translateFormula(
  formula: string,
  rows: number,
  columns: number
): string {
  if (!rows && !columns) return formula;
  const pieces = scan(formula);
  const output = pieces.map((piece) => piece.text);
  const shiftColumn = (absolute: string, letters: string) => {
    const column = (parseColumnName(letters.toUpperCase()) ?? -1) + 1;
    const next = absolute ? column : column + columns;
    return next < 1 || next > MAX_COLUMN
      ? undefined
      : `${absolute}${columnLetters(next)}`;
  };
  const shiftRow = (absolute: string, digits: string) => {
    const next = absolute ? Number(digits) : Number(digits) + rows;
    return next < 1 || next > MAX_ROW ? undefined : `${absolute}${next}`;
  };
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    if (piece.kind !== 'word' || !referenceContext(pieces, index)) continue;
    const cell = cellReference.exec(piece.text);
    if (cell && parseColumnName(cell[2].toUpperCase()) !== undefined) {
      const column = shiftColumn(cell[1], cell[2]);
      const row = shiftRow(cell[3], cell[4]);
      output[index] = column && row ? `${column}${row}` : '#REF!';
      continue;
    }
    // Whole-column (A:C) and whole-row (1:3) ranges need both endpoints.
    const colon =
      pieces[index + 1]?.text === ':' ? pieces[index + 2] : undefined;
    if (colon?.kind !== 'word') continue;
    const leftColumn = columnReference.exec(piece.text);
    const rightColumn = columnReference.exec(colon.text);
    if (
      leftColumn &&
      rightColumn &&
      parseColumnName(leftColumn[2].toUpperCase()) !== undefined &&
      parseColumnName(rightColumn[2].toUpperCase()) !== undefined
    ) {
      const left = shiftColumn(leftColumn[1], leftColumn[2]);
      const right = shiftColumn(rightColumn[1], rightColumn[2]);
      output[index] = left && right ? left : '#REF!';
      output[index + 2] = left && right ? right : '';
      if (!left || !right) output[index + 1] = '';
      index += 2;
      continue;
    }
    const leftRow = rowReference.exec(piece.text);
    const rightRow = rowReference.exec(colon.text);
    if (leftRow && rightRow) {
      const top = shiftRow(leftRow[1], leftRow[2]);
      const bottom = shiftRow(rightRow[1], rightRow[2]);
      output[index] = top && bottom ? top : '#REF!';
      output[index + 2] = top && bottom ? bottom : '';
      if (!top || !bottom) output[index + 1] = '';
      index += 2;
    }
  }
  return output.join('');
}

/** Excel stores post-2007 functions with `_xlfn.` (and `_xlws.`) prefixes. */
export function stripFunctionPrefixes(formula: string): string {
  if (!/_xl(?:fn|ws)\./i.test(formula)) return formula;
  return scan(formula)
    .map((piece) =>
      piece.kind === 'word'
        ? piece.text.replace(/^_xlfn\.(?:_xlws\.)?/i, '')
        : piece.text
    )
    .join('');
}

/** Functions Excel writes with a compatibility prefix; without it, Excel
 * shows #NAME? until the formula is re-entered. */
const FUTURE_FUNCTIONS = new Set(
  `ACOT ACOTH AGGREGATE ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV BINOM.DIST
  BINOM.DIST.RANGE BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW
  CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT
  CHISQ.TEST CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT
  COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE
  ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FIELDVALUE
  FILTERXML FLOOR.MATH FLOOR.PRECISE FORECAST.ETS FORECAST.ETS.CONFINT
  FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FORECAST.LINEAR FORMULATEXT GAMMA
  GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS HSTACK HYPGEOM.DIST IFNA IFS IMAGE
  IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOMITTED
  ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS
  MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST NORM.DIST NORM.INV NORM.S.DIST
  NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC
  PERCENTRANK.INC PERMUTATIONA PHI POISSON.DIST QUARTILE.EXC QUARTILE.INC
  RANDARRAY RANK.AVG RANK.EQ REDUCE RRI SCAN SEC SECH SEQUENCE SHEET SHEETS SKEW.P
  SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST
  TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE UNIQUE
  VALUETOTEXT VAR.P VAR.S VSTACK WEBSERVICE WEIBULL.DIST WRAPCOLS WRAPROWS XLOOKUP
  XMATCH XOR Z.TEST`.split(/\s+/)
);
const WORKSHEET_FUNCTIONS = new Set(['FILTER', 'SORT']);

/** Restore the prefixes Excel requires for newer functions. */
export function addFunctionPrefixes(formula: string): string {
  const pieces = scan(formula);
  let changed = false;
  const output = pieces.map((piece, index) => {
    if (piece.kind !== 'word' || pieces[index + 1]?.text !== '(')
      return piece.text;
    const name = piece.text.toUpperCase();
    if (WORKSHEET_FUNCTIONS.has(name)) {
      changed = true;
      return `_xlfn._xlws.${piece.text}`;
    }
    if (!FUTURE_FUNCTIONS.has(name)) return piece.text;
    changed = true;
    return `_xlfn.${piece.text}`;
  });
  return changed ? output.join('') : formula;
}

/** The reference that follows a sheet prefix: `A1`, `$A$1:$B$2`, `A:C` or `1:3`. */
function referenceEnd(pieces: Piece[], index: number): number | undefined {
  const reference = /^\$?[A-Z]{1,3}\$?\d+$|^\$?[A-Z]{1,3}$|^\$?\d+$/i;
  if (pieces[index]?.kind !== 'word' || !reference.test(pieces[index].text))
    return;
  return pieces[index + 1]?.text === ':' &&
    pieces[index + 2]?.kind === 'word' &&
    reference.test(pieces[index + 2].text)
    ? index + 2
    : index;
}

/**
 * Expand 3-D references such as `SUM('Jan:Dec'!B2)` into one reference per
 * sheet in tab order, which aggregate functions accept as separate arguments.
 * References that are not a whole function argument stay unchanged.
 */
export function expandSheetRanges(
  formula: string,
  sheetNames: string[]
): string {
  if (!formula.includes(':') || !formula.includes('!')) return formula;
  const pieces = scan(formula);
  const output = pieces.map((piece) => piece.text);
  const indexOf = (name: string) =>
    sheetNames.findIndex((sheet) => sheet.toLowerCase() === name.toLowerCase());
  const previous = (index: number) => {
    for (let at = index - 1; at >= 0; at--)
      if (pieces[at].text.trim()) return pieces[at].text;
  };
  const next = (index: number) => {
    for (let at = index + 1; at < pieces.length; at++)
      if (pieces[at].text.trim()) return pieces[at].text;
  };
  for (let index = 0; index < pieces.length; index++) {
    let first: string | undefined;
    let last: string | undefined;
    let bang: number;
    const piece = pieces[index];
    if (piece.kind === 'quoted' && pieces[index + 1]?.text === '!') {
      const names = piece.text.slice(1, -1).replaceAll("''", "'").split(':');
      if (names.length !== 2) continue;
      [first, last] = names;
      bang = index + 1;
    } else if (
      piece.kind === 'word' &&
      pieces[index + 1]?.text === ':' &&
      pieces[index + 2]?.kind === 'word' &&
      pieces[index + 3]?.text === '!'
    ) {
      [first, last] = [piece.text, pieces[index + 2].text];
      bang = index + 3;
    } else continue;
    const end = referenceEnd(pieces, bang + 1);
    const from = indexOf(first);
    const to = indexOf(last);
    if (
      end === undefined ||
      from < 0 ||
      to < 0 ||
      !['(', ','].includes(previous(index) ?? '') ||
      ![')', ','].includes(next(end) ?? '')
    )
      continue;
    const reference = pieces
      .slice(bang + 1, end + 1)
      .map((item) => item.text)
      .join('');
    output[index] = sheetNames
      .slice(Math.min(from, to), Math.max(from, to) + 1)
      .map((sheet) => `${quotedSheet(sheet)}!${reference}`)
      .join(',');
    for (let at = index + 1; at <= end; at++) output[at] = '';
    index = end;
  }
  return output.join('');
}

/*
 * Before dynamic arrays, Excel evaluated a range in a single-value position by
 * intersecting it with the formula's own row or column (`=B2:B9` in row 4
 * reads B4). Dynamic-array engines spill instead and mark the old behavior
 * with `@`. Excel's argument classes decide which positions intersect: V
 * arguments take one value, R arguments pass references through and A
 * arguments evaluate arrays. Functions missing here count as A, which keeps
 * their arguments unchanged.
 */
const VALUE_FUNCTIONS = new Set(
  `ABS ACOS ACOSH ACOT ACOTH ASIN ASINH ATAN ATAN2 ATANH BIN2DEC BIN2HEX CEILING
  CEILING.MATH CHAR CLEAN CODE COMBIN CONCATENATE COS COSH COT DATE DATEDIF
  DATEVALUE DAY DAYS DAYS360 DB DDB DEC2BIN DEC2HEX DEGREES DOLLAR EDATE EFFECT
  EOMONTH EVEN EXACT EXP FACT FIND FIXED FLOOR FLOOR.MATH FV HEX2DEC HOUR IFERROR
  IFNA INT IPMT ISBLANK ISERR ISERROR ISEVEN ISLOGICAL ISNA ISNONTEXT ISNUMBER
  ISODD ISTEXT LEFT LEN LN LOG LOG10 LOWER MID MINUTE MOD MONTH MROUND NOMINAL NOT
  NPER ODD PMT POWER PPMT PROPER PV QUOTIENT RADIANS RATE REPLACE REPT RIGHT ROMAN
  ROUND ROUNDDOWN ROUNDUP SEARCH SECOND SIGN SIN SINH SLN SQRT SUBSTITUTE SYD TAN
  TANH TEXT TIME TIMEVALUE TRIM TRUNC UPPER VALUE WEEKDAY WEEKNUM YEAR YEARFRAC`.split(
    /\s+/
  )
);
const REFERENCE_FUNCTIONS = new Set(
  `AND AREAS AVEDEV AVERAGE AVERAGEA COLUMN COLUMNS CONCAT COUNT COUNTA
  COUNTBLANK DEVSQ GEOMEAN HARMEAN ISREF KURT MAX MAXA MEDIAN MIN MINA MODE
  MODE.SNGL OR PRODUCT ROW ROWS SKEW STDEV STDEV.P STDEV.S STDEVA STDEVP STDEVPA
  SUM SUMSQ VAR VAR.P VAR.S VARA VARP VARPA XOR`.split(/\s+/)
);
/** Classes by argument position; the last one repeats. */
const ARGUMENT_CLASSES: Record<string, string> = {
  CELL: 'VR',
  CHOOSE: 'VR',
  COUNTIF: 'RV',
  FORECAST: 'VA',
  'FORECAST.LINEAR': 'VA',
  HLOOKUP: 'VRV',
  IF: 'VRR',
  INDEX: 'AV',
  IRR: 'RV',
  LARGE: 'RV',
  LOOKUP: 'VA',
  MATCH: 'VRV',
  MIRR: 'RV',
  NETWORKDAYS: 'VVR',
  NPV: 'VR',
  OFFSET: 'RV',
  PERCENTILE: 'RV',
  'PERCENTILE.EXC': 'RV',
  'PERCENTILE.INC': 'RV',
  PERCENTRANK: 'RV',
  QUARTILE: 'RV',
  'QUARTILE.EXC': 'RV',
  'QUARTILE.INC': 'RV',
  RANK: 'VRV',
  'RANK.AVG': 'VRV',
  'RANK.EQ': 'VRV',
  SMALL: 'RV',
  SUBTOTAL: 'VR',
  SUMIF: 'RVR',
  AVERAGEIF: 'RVR',
  TEXTJOIN: 'VVR',
  VLOOKUP: 'VRV',
  WORKDAY: 'VVR',
  XIRR: 'RRV',
  XNPV: 'VR',
};

function argumentClass(name: string, index: number): 'V' | 'R' | 'A' {
  if (VALUE_FUNCTIONS.has(name)) return 'V';
  if (REFERENCE_FUNCTIONS.has(name)) return 'R';
  // Range and criteria pairs.
  if (name === 'COUNTIFS') return index % 2 ? 'V' : 'R';
  if (['SUMIFS', 'AVERAGEIFS', 'MAXIFS', 'MINIFS'].includes(name))
    return index && index % 2 === 0 ? 'V' : 'R';
  const classes = ARGUMENT_CLASSES[name];
  if (!classes) return 'A';
  return classes[Math.min(index, classes.length - 1)] as 'V' | 'R' | 'A';
}

type Operand = {
  /** First and last piece of a multi-cell range or range name. */
  start: number;
  end: number;
  /** An explicit `@` precedes the operand. */
  marked: boolean;
  /** Excel's pre-dynamic-array evaluation intersects it here. */
  intersects: boolean;
};

function rangeOperands(pieces: Piece[], rangeNames: ReadonlySet<string>) {
  const operands: Operand[] = [];
  const frames: { name?: string; argument: number; brace?: boolean }[] = [];
  const nonBlank = (index: number, step: 1 | -1) => {
    let at = index + step;
    while (at >= 0 && at < pieces.length && !pieces[at].text.trim()) at += step;
    return {
      piece: pieces[at] as Piece | undefined,
      spaced: at !== index + step,
    };
  };
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    if (piece.kind === 'other') {
      const top = frames.at(-1);
      if (piece.text === '(') {
        const previous = pieces[index - 1];
        frames.push({
          argument: 0,
          ...(previous?.kind === 'word' && {
            name: previous.text.toUpperCase(),
          }),
        });
      } else if (piece.text === '{') frames.push({ argument: 0, brace: true });
      else if (piece.text === ')' || piece.text === '}') frames.pop();
      else if (piece.text === ',' && top) top.argument++;
      continue;
    }
    if (frames.at(-1)?.brace) continue;
    // A sheet-qualified reference starts at its sheet name.
    let start = index;
    let referenceIndex = index;
    if (
      (piece.kind === 'quoted' || piece.kind === 'word') &&
      pieces[index + 1]?.text === '!'
    )
      referenceIndex = index + 2;
    let end: number | undefined;
    let range = false;
    const name =
      referenceIndex === index &&
      piece.kind === 'word' &&
      rangeNames.has(piece.text.toLowerCase()) &&
      pieces[index + 1]?.text !== '(' &&
      pieces[index + 1]?.kind !== 'bracket' &&
      pieces[index - 1]?.text !== '!';
    if (name) {
      end = index;
      range = true;
    } else {
      end = referenceEnd(pieces, referenceIndex);
      if (end === undefined) {
        if (referenceIndex !== index) index++;
        continue;
      }
      const first = pieces[referenceIndex].text
        .replaceAll('$', '')
        .toUpperCase();
      const last = pieces[end].text.replaceAll('$', '').toUpperCase();
      // A1:A1 is one cell; A:A and 1:1 are whole columns and rows. A function
      // named like a cell (LOG10) is not a reference.
      range =
        end !== referenceIndex &&
        (first !== last || !/^[A-Z]+\d+$/.test(first)) &&
        pieces[end + 1]?.text !== '(' &&
        pieces[referenceIndex + 1]?.text !== '(';
      if (!referenceContext(pieces, end)) range = false;
    }
    if (!range) {
      index = end;
      continue;
    }
    const marked = pieces[start - 1]?.text === '@';
    const before = nonBlank(marked ? start - 1 : start, -1);
    const after = nonBlank(end, 1);
    const top = frames.at(-1);
    const arrayContext = frames.some(
      (frame) => frame.name && argumentClass(frame.name, frame.argument) === 'A'
    );
    const combines = (side: typeof before, toward: 'left' | 'right') =>
      side.piece?.text === ':' ||
      (side.spaced &&
        (side.piece?.kind === 'word' ||
          side.piece?.kind === 'quoted' ||
          side.piece?.text === (toward === 'left' ? ')' : '(')));
    const named = frames.findLast((frame) => frame.name);
    let intersects: boolean;
    if (arrayContext || combines(before, 'left') || combines(after, 'right'))
      intersects = false;
    else if (
      (before.piece?.text === '(' || before.piece?.text === ',') &&
      (after.piece?.text === ')' || after.piece?.text === ',')
    ) {
      if (top?.name) intersects = argumentClass(top.name, top.argument) === 'V';
      // A comma inside plain parentheses is a union of references, and a
      // parenthesized reference stays a reference.
      else
        intersects =
          before.piece?.text === '(' &&
          after.piece?.text === ')' &&
          (!named?.name || argumentClass(named.name, named.argument) === 'V');
    } else intersects = true;
    operands.push({ start, end, marked, intersects });
    index = end;
  }
  return operands;
}

/** Add Excel's `@` where a formula saved without dynamic-array evaluation
 * intersects a range, so Macro calculates the value Excel showed. */
export function markImplicitIntersections(
  formula: string,
  rangeNames: ReadonlySet<string>
): string {
  if (!formula.includes(':') && !rangeNames.size) return formula;
  const pieces = scan(formula);
  const output = pieces.map((piece) => piece.text);
  let changed = false;
  for (const operand of rangeOperands(pieces, rangeNames)) {
    if (operand.marked || !operand.intersects) continue;
    output[operand.start] = `@${output[operand.start]}`;
    changed = true;
  }
  return changed ? output.join('') : formula;
}

/** The end of the primary expression starting at `index`: a parenthesized
 * group, a function call, or a single piece. */
function primaryEnd(pieces: Piece[], index: number) {
  let at = index;
  if (pieces[at]?.kind === 'word' && pieces[at + 1]?.text === '(') at++;
  if (pieces[at]?.text !== '(') return index;
  for (let depth = 0; at < pieces.length; at++) {
    if (pieces[at].text === '(') depth++;
    else if (pieces[at].text === ')' && --depth === 0) return at;
  }
  return pieces.length - 1;
}

/**
 * Excel stores `@` implicitly in legacy formulas, those saved without array
 * or dynamic-array evaluation. Drop it where Excel intersects anyway and
 * write the rest as `SINGLE`, which is how Excel stores an explicit `@`.
 */
export function exportImplicitIntersections(
  formula: string,
  rangeNames: ReadonlySet<string>,
  legacy: boolean
): string {
  if (!formula.includes('@')) return formula;
  const pieces = scan(formula);
  const output = pieces.map((piece) => piece.text);
  const implicit = new Set(
    legacy
      ? rangeOperands(pieces, rangeNames)
          .filter((operand) => operand.marked && operand.intersects)
          .map((operand) => operand.start - 1)
      : []
  );
  for (let index = 0; index < pieces.length; index++) {
    if (pieces[index].text !== '@') continue;
    output[index] = '';
    if (implicit.has(index)) continue;
    let end = primaryEnd(pieces, index + 1);
    if (end === index + 1 && pieces[index + 2]?.text === '!') {
      const reference = referenceEnd(pieces, index + 3);
      end = reference ?? end;
    } else if (end === index + 1) end = referenceEnd(pieces, index + 1) ?? end;
    output[index + 1] = `_xlfn.SINGLE(${output[index + 1]}`;
    output[end] = `${output[end]})`;
  }
  return output.join('');
}

/** Read Excel's `_xlfn.SINGLE(range)` back as `@range`. */
export function importSingleFunction(formula: string): string {
  if (!/_xlfn\.single\(/i.test(formula)) return formula;
  const pieces = scan(formula);
  const output = pieces.map((piece) => piece.text);
  for (let index = 0; index < pieces.length; index++) {
    if (
      pieces[index].kind !== 'word' ||
      pieces[index].text.toUpperCase() !== '_XLFN.SINGLE' ||
      pieces[index + 1]?.text !== '('
    )
      continue;
    const close = primaryEnd(pieces, index);
    // A plain reference or name needs no parentheses after `@`.
    const inner = index + 2;
    const qualified =
      (pieces[inner]?.kind === 'word' || pieces[inner]?.kind === 'quoted') &&
      pieces[inner + 1]?.text === '!';
    const reference = referenceEnd(pieces, qualified ? inner + 2 : inner);
    const bare =
      close === inner + 1 ||
      (reference !== undefined && reference === close - 1);
    output[index] = '@';
    if (bare) {
      output[index + 1] = '';
      output[close] = '';
    }
  }
  return output.join('');
}

/** A sheet prefix's name: `'My sheet'` or `Data`. */
function prefixName(piece: Piece) {
  return (
    piece.kind === 'quoted'
      ? piece.text.slice(1, -1).replaceAll("''", "'")
      : piece.text
  ).toLowerCase();
}

/**
 * Rewrite reference spellings that Excel accepts but IronCalc cannot parse:
 * a range naming its sheet on both ends (`Data!A1:Data!B2`, written when a
 * range is picked across sheets) and a deleted reference (`Data!#REF!`).
 */
export function normalizeReferences(formula: string): string {
  if (!formula.includes('!')) return formula;
  const pieces = scan(formula);
  const output = pieces.map((piece) => piece.text);
  const prefix = (index: number) =>
    (pieces[index]?.kind === 'quoted' || pieces[index]?.kind === 'word') &&
    pieces[index + 1]?.text === '!';
  let changed = false;
  for (let index = 0; index < pieces.length; index++) {
    if (!prefix(index)) continue;
    if (
      pieces[index + 2]?.text === '#' &&
      pieces[index + 3]?.text.toUpperCase() === 'REF' &&
      pieces[index + 4]?.text === '!'
    ) {
      output[index] = output[index + 1] = '';
      changed = true;
      continue;
    }
    const end = referenceEnd(pieces, index + 2);
    if (
      end !== index + 2 ||
      pieces[end + 1]?.text !== ':' ||
      !prefix(end + 2) ||
      prefixName(pieces[end + 2]) !== prefixName(pieces[index])
    )
      continue;
    output[end + 2] = output[end + 3] = '';
    changed = true;
    index = end + 3;
  }
  return changed ? output.join('') : formula;
}

/** Function names used by a formula, uppercase and without Excel prefixes. */
export function formulaFunctionNames(formula: string): string[] {
  const pieces = scan(formula);
  const names = new Set<string>();
  pieces.forEach((piece, index) => {
    if (piece.kind === 'word' && pieces[index + 1]?.text === '(')
      names.add(piece.text.toUpperCase().replace(/^_XLFN\.(?:_XLWS\.)?/, ''));
  });
  return [...names];
}

/** References into another workbook, such as `[1]Sheet1!A1` or `'[2]Q1'!B2`. */
export function hasExternalReference(formula: string): boolean {
  return scan(formula).some(
    (piece, index, pieces) =>
      (piece.kind === 'bracket' &&
        /^\[\d+\]$/.test(piece.text) &&
        (pieces[index + 1]?.kind === 'word' ||
          pieces[index + 1]?.text === '!')) ||
      (piece.kind === 'quoted' && /^'\[\d+\]/.test(piece.text))
  );
}

export type WorkbookTable = {
  name: string;
  sheet: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  headerRows: number;
  totalsRows: number;
  columns: string[];
};

function quotedSheet(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) &&
    !cellReference.test(name) &&
    !/^R\d*C\d*$/i.test(name)
    ? name
    : `'${name.replaceAll("'", "''")}'`;
}

/** Column names inside a structured reference unescape `'`-prefixed characters. */
function columnSpecifier(text: string) {
  return text.replace(/'(.)/g, '$1').trim().toLowerCase();
}

/** Convert one structured reference (`Table1[Amount]`, `[@Qty]`,
 * `Table1[[#This Row],[Price]:[Tax]]`) to an A1 range. */
function structuredRange(
  table: WorkbookTable,
  specifier: string,
  sheet: string,
  row: number
): string | undefined {
  // `Table1[...]` brackets wrap either one item or a list of bracketed items.
  const inner = specifier.slice(1, -1).trim();
  const items: string[] = [];
  if (inner.startsWith('[')) {
    for (const match of inner.matchAll(/\[((?:'.|[^\]])*)\]|(:)|,/g))
      items.push(match[2] ?? match[1] ?? ',');
  } else if (inner.startsWith('@')) {
    items.push('#This Row');
    const rest = inner.slice(1).trim();
    if (rest) items.push(rest.replace(/^\[(.*)\]$/, '$1'));
  } else if (inner) items.push(inner);
  let rows:
    | 'data'
    | 'all'
    | 'headers'
    | 'totals'
    | 'this'
    | 'data-totals'
    | 'headers-data' = 'data';
  const area = new Set<string>();
  const columnNames: string[] = [];
  let span = false;
  for (const item of items) {
    if (item === ',') continue;
    if (item === ':') {
      span = true;
      continue;
    }
    const lower = item.trim().toLowerCase();
    if (lower.startsWith('#')) area.add(lower);
    else if (lower === '@') area.add('#this row');
    else columnNames.push(columnSpecifier(item));
  }
  if (area.has('#all')) rows = 'all';
  else if (area.has('#this row')) rows = 'this';
  else if (area.has('#headers') && area.has('#data')) rows = 'headers-data';
  else if (area.has('#data') && area.has('#totals')) rows = 'data-totals';
  else if (area.has('#headers')) rows = 'headers';
  else if (area.has('#totals')) rows = 'totals';
  const firstData = table.top + table.headerRows;
  const lastData = table.bottom - table.totalsRows;
  const [top, bottom] = {
    all: [table.top, table.bottom],
    data: [firstData, lastData],
    headers: [table.top, table.top],
    totals: [table.bottom, table.bottom],
    'headers-data': [table.top, lastData],
    'data-totals': [firstData, table.bottom],
    this: [row, row],
  }[rows];
  if (
    (rows === 'headers' && !table.headerRows) ||
    (rows === 'totals' && !table.totalsRows) ||
    (rows === 'this' && (row < firstData || row > lastData)) ||
    top > bottom
  )
    return;
  const index = (name: string) =>
    table.columns.findIndex((column) => column.toLowerCase() === name);
  let left = table.left;
  let right = table.right;
  if (columnNames.length) {
    const first = index(columnNames[0]);
    const last = index(columnNames[span ? columnNames.length - 1 : 0]);
    if (first < 0 || last < 0 || (!span && columnNames.length > 1)) return;
    left = table.left + Math.min(first, last);
    right = table.left + Math.max(first, last);
  }
  const prefix = table.sheet === sheet ? '' : `${quotedSheet(table.sheet)}!`;
  const rowText = (value: number) =>
    rows === 'this' ? `${value + 1}` : `$${value + 1}`;
  const start = `$${columnLetters(left + 1)}${rowText(top)}`;
  const end = `$${columnLetters(right + 1)}${rowText(bottom)}`;
  return `${prefix}${start === end ? start : `${start}:${end}`}`;
}

/** Replace structured table references with equivalent A1 references.
 * Returns undefined if a reference cannot be resolved. */
export function resolveStructuredReferences(
  formula: string,
  tables: WorkbookTable[],
  sheet: string,
  row: number,
  column: number
): string | undefined {
  if (!formula.includes('[') || !tables.length) return formula;
  const pieces = scan(formula);
  const output: string[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    const next = pieces[index + 1];
    if (
      piece.kind === 'word' &&
      next?.kind === 'bracket' &&
      pieces[index - 1]?.text !== '!'
    ) {
      const table = tables.find(
        (item) => item.name.toLowerCase() === piece.text.toLowerCase()
      );
      if (table) {
        const range = structuredRange(table, next.text, sheet, row);
        if (!range) return;
        output.push(range);
        index++;
        continue;
      }
    }
    if (
      piece.kind === 'bracket' &&
      !/^\[\d+\]$/.test(piece.text) &&
      pieces[index - 1]?.kind !== 'word'
    ) {
      // `[@Qty]` inside a table refers to the table containing the formula.
      const table = tables.find(
        (item) =>
          item.sheet === sheet &&
          row >= item.top &&
          row <= item.bottom &&
          column >= item.left &&
          column <= item.right
      );
      if (!table) return;
      const range = structuredRange(table, piece.text, sheet, row);
      if (!range) return;
      output.push(range);
      continue;
    }
    output.push(piece.text);
  }
  return output.join('');
}
