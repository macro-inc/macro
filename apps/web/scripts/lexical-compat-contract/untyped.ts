import ts from 'typescript';

function referenceType(type: ts.Type): type is ts.TypeReference {
  return (
    'objectFlags' in type &&
    typeof type.objectFlags === 'number' &&
    !!(type.objectFlags & ts.ObjectFlags.Reference)
  );
}
function namedParameters(node: ts.Node) {
  return ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node)
    ? (node.typeParameters ?? [])
    : [];
}

/** Reject actual weakening to resolved any; canonical upstream any stays unchanged. */
export function rejectUntypedExports(
  checker: ts.TypeChecker,
  module: ts.Symbol,
  owned: (path: string) => boolean,
  expectedModule: ts.Symbol
) {
  const states = new Map<
    ts.Type,
    Map<ts.Type | undefined, { epoch: number; unsafe: boolean }>
  >();
  let epoch = 0,
    changed = false;
  const symbolType = (symbol: ts.Symbol, location: ts.Node) =>
    checker.getTypeOfSymbolAtLocation(
      symbol,
      symbol.valueDeclaration ?? symbol.declarations?.[0] ?? location
    );
  const inspect = (
    type: ts.Type,
    expected: ts.Type | undefined,
    location: ts.Node
  ): boolean => {
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const fallback = checker.getDefaultFromTypeParameter(type),
        constraint = checker.getBaseConstraintOfType(type);
      if (
        (fallback &&
          visit(
            fallback,
            expected && checker.getDefaultFromTypeParameter(expected),
            location
          )) ||
        (constraint &&
          visit(
            constraint,
            expected && checker.getBaseConstraintOfType(expected),
            location
          ))
      )
        return true;
    }
    if (type.isUnion())
      return type.types.some((part) => visit(part, expected, location));
    if (expected?.isUnion()) {
      const compatible = expected.types.filter((branch) =>
        checker.isTypeAssignableTo(type, branch)
      );
      return compatible.length
        ? compatible.every((branch) => visit(type, branch, location))
        : visit(type, undefined, location);
    }
    if (
      type.isIntersection() &&
      type.types.some((part) => visit(part, expected, location))
    )
      return true;
    if (!(type.flags & ts.TypeFlags.Object)) return false;
    const expectedArguments =
      expected && referenceType(expected)
        ? checker.getTypeArguments(expected)
        : [];
    if (
      referenceType(type) &&
      (!expected ||
        (referenceType(expected) &&
          type.getSymbol() !== undefined &&
          type.getSymbol() === expected.getSymbol())) &&
      checker
        .getTypeArguments(type)
        .some((argument, index) =>
          visit(argument, expectedArguments[index], location)
        )
    )
      return true;
    for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct]) {
      const expectedSignatures = expected
        ? checker.getSignaturesOfType(expected, kind)
        : [];
      for (const [index, signature] of checker
        .getSignaturesOfType(type, kind)
        .entries()) {
        const original = expectedSignatures[index];
        if (
          signature.typeParameters?.some((parameter, index) =>
            visit(parameter, original?.typeParameters?.[index], location)
          )
        )
          return true;
        if (
          visit(
            checker.getReturnTypeOfSignature(signature),
            original && checker.getReturnTypeOfSignature(original),
            signature.declaration ?? location
          )
        )
          return true;
        for (const [index, parameter] of signature.parameters.entries()) {
          const originalParameter = original?.parameters[index];
          if (
            visit(
              symbolType(parameter, location),
              originalParameter && symbolType(originalParameter, location),
              location
            )
          )
            return true;
        }
      }
    }
    const object = type.getSymbol();
    if (
      !expected &&
      object?.declarations?.length &&
      object.declarations.every(
        (declaration) => !owned(declaration.getSourceFile().fileName)
      )
    )
      return false;
    for (const name of (expected ?? type).getProperties()) {
      const property = type.getProperty(name.name);
      if (!property) continue;
      const original = expected?.getProperty(name.name);
      if (
        visit(
          symbolType(property, location),
          original && symbolType(original, location),
          location
        )
      )
        return true;
    }
    return checker
      .getIndexInfosOfType(expected ?? type)
      .some((index) =>
        visit(
          checker.getIndexTypeOfType(
            type,
            index.keyType.flags & ts.TypeFlags.Number
              ? ts.IndexKind.Number
              : ts.IndexKind.String
          ) ?? index.type,
          expected &&
            checker.getIndexTypeOfType(
              expected,
              index.keyType.flags & ts.TypeFlags.Number
                ? ts.IndexKind.Number
                : ts.IndexKind.String
            ),
          location
        )
      );
  };
  function visit(
    type: ts.Type,
    expected: ts.Type | undefined,
    location: ts.Node
  ): boolean {
    if (type === expected || (expected && expected.flags & ts.TypeFlags.Any))
      return false;
    if (type.flags & ts.TypeFlags.Any) return true;
    const entries =
      states.get(type) ??
      new Map<ts.Type | undefined, { epoch: number; unsafe: boolean }>();
    states.set(type, entries);
    const state = entries.get(expected) ?? { epoch: -1, unsafe: false };
    entries.set(expected, state);
    if (state.epoch === epoch) return state.unsafe;
    state.epoch = epoch;
    const unsafe = inspect(type, expected, location);
    if (unsafe !== state.unsafe) {
      changed = true;
      state.unsafe = unsafe;
    }
    return unsafe;
  }
  const checks: {
    type: ts.Type;
    expected: ts.Type | undefined;
    location: ts.Node;
    message: string;
  }[] = [];
  const resolved = (symbol: ts.Symbol) =>
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const expectedExports = new Map(
    checker
      .getExportsOfModule(expectedModule)
      .map((symbol) => [symbol.name, resolved(symbol)])
  );
  for (const exported of checker.getExportsOfModule(module)) {
    if (exported.name.startsWith('__observable_type_contract_')) continue;
    const symbol = resolved(exported),
      original = expectedExports.get(exported.name);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) continue;
    for (const source of symbol.declarations ?? []) {
      if (!owned(source.getSourceFile().fileName)) continue;
      const parameters = namedParameters(source),
        originalParameters =
          original?.declarations?.flatMap(namedParameters) ?? [];
      for (const [index, parameter] of parameters.entries())
        for (const key of ['default', 'constraint'] as const) {
          const node = parameter[key],
            expectedNode = originalParameters[index]?.[key];
          if (node)
            checks.push({
              type: checker.getTypeFromTypeNode(node),
              expected:
                expectedNode && checker.getTypeFromTypeNode(expectedNode),
              location: node,
              message:
                'Resolved untyped public generic parameter: ' +
                exported.name +
                '.' +
                parameter.name.text,
            });
        }
    }
    const type =
      symbol.flags & ts.SymbolFlags.Value
        ? symbolType(symbol, declaration)
        : checker.getDeclaredTypeOfSymbol(symbol);
    const expected =
      original &&
      (original.flags & ts.SymbolFlags.Value
        ? symbolType(original, declaration)
        : checker.getDeclaredTypeOfSymbol(original));
    checks.push({
      type,
      expected,
      location: declaration,
      message: 'Resolved untyped public export: ' + exported.name,
    });
  }
  // Reach a fixed point over recursive type pairs. An active cycle uses its prior
  // state; another pass propagates newly discovered unsafe positions through it.
  do {
    changed = false;
    epoch++;
    for (const check of checks)
      visit(check.type, check.expected, check.location);
  } while (changed);
  return checks
    .filter((check) => visit(check.type, check.expected, check.location))
    .map((check) => check.message);
}
