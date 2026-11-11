import ts from 'typescript';

const PREFIX = '__observable_type_contract_';
function parameterSyntax(
  parameter: ts.TypeParameterDeclaration,
  source: ts.SourceFile
) {
  const legal = ts.factory.updateTypeParameterDeclaration(
    parameter,
    parameter.modifiers?.filter(
      (modifier) =>
        modifier.kind !== ts.SyntaxKind.InKeyword &&
        modifier.kind !== ts.SyntaxKind.OutKeyword
    ),
    parameter.name,
    parameter.constraint,
    parameter.default
  );
  return ts.createPrinter().printNode(ts.EmitHint.Unspecified, legal, source);
}
function variance(parameter: ts.TypeParameterDeclaration) {
  return parameter.modifiers?.map((modifier) => modifier.kind).join(',') ?? '';
}
function typeDeclaration(
  node: ts.Node
): node is
  | ts.TypeAliasDeclaration
  | ts.InterfaceDeclaration
  | (ts.ClassDeclaration & { name: ts.Identifier }) {
  return (
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    (ts.isClassDeclaration(node) && !!node.name)
  );
}

/** Additional test declarations retain the original parameter syntax and scope. */
export function typeWitnesses(source: ts.SourceFile) {
  const declarations: string[] = [];
  for (const node of source.statements) {
    if (!typeDeclaration(node)) continue;
    const parameters = [...(node.typeParameters ?? [])];
    const required = parameters.filter(
      (parameter) => !parameter.default
    ).length;
    for (let count = required; count <= parameters.length; count++) {
      const selected = parameters.slice(0, count);
      const generic = selected.length
        ? '<' +
          selected
            .map((parameter) => parameterSyntax(parameter, source))
            .join(',') +
          '>'
        : '';
      const argumentsText = selected.length
        ? '<' + selected.map((parameter) => parameter.name.text).join(',') + '>'
        : '';
      declarations.push(
        `export declare function ${PREFIX}${node.name.text}_${count}${generic}():${node.name.text}${argumentsText};`
      );
    }
  }
  return declarations.join('\n');
}

export function compareExports(
  checker: ts.TypeChecker,
  expected: ts.Symbol,
  actual: ts.Symbol
) {
  const failures: string[] = [];
  const resolved = (symbol: ts.Symbol) =>
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const actualExports = new Map(
    checker.getExportsOfModule(actual).map((symbol) => [symbol.name, symbol])
  );
  const witness = (symbol: ts.Symbol, count: number) => {
    const declaration = symbol.declarations?.find(typeDeclaration);
    if (
      !declaration ||
      !('name' in declaration) ||
      !ts.isIdentifier(declaration.name)
    )
      return;
    const module = checker.getSymbolAtLocation(declaration.getSourceFile());
    return (
      module &&
      checker
        .getExportsOfModule(module)
        .find(
          (value) => value.name === PREFIX + declaration.name.text + '_' + count
        )
    );
  };
  for (const exported of checker.getExportsOfModule(expected)) {
    if (exported.name.startsWith(PREFIX)) continue;
    const upstream = resolved(exported);
    const found = actualExports.get(exported.name);
    if (!found) {
      failures.push('Missing export (including type space): ' + exported.name);
      continue;
    }
    const compat = resolved(found);
    if (!(upstream.flags & ts.SymbolFlags.Type)) continue;
    if (!(compat.flags & ts.SymbolFlags.Type)) {
      failures.push('Missing type export: ' + exported.name);
      continue;
    }
    const declaration = upstream.declarations?.find(typeDeclaration);
    if (declaration && typeDeclaration(declaration)) {
      const parameters = [...(declaration.typeParameters ?? [])];
      const actualDeclaration = compat.declarations?.find(typeDeclaration);
      if (
        !actualDeclaration ||
        !typeDeclaration(actualDeclaration) ||
        (actualDeclaration.typeParameters?.length ?? 0) !== parameters.length
      ) {
        failures.push(
          'Type export generic parameter count mismatch: ' + exported.name
        );
        continue;
      }
      const required = parameters.filter(
        (parameter) => !parameter.default
      ).length;
      if (
        parameters.some(
          (parameter, index) =>
            variance(parameter) !==
            variance(actualDeclaration.typeParameters?.[index] ?? parameter)
        )
      )
        failures.push('Type export variance mismatch: ' + exported.name);
      for (let count = required; count <= parameters.length; count++) {
        const expectedWitness = witness(upstream, count),
          actualWitness = witness(compat, count);
        if (
          !expectedWitness ||
          !actualWitness ||
          !checker.isTypeAssignableTo(
            checker.getTypeOfSymbolAtLocation(
              actualWitness,
              actualWitness.valueDeclaration ?? declaration
            ),
            checker.getTypeOfSymbolAtLocation(
              expectedWitness,
              expectedWitness.valueDeclaration ?? declaration
            )
          )
        )
          failures.push(
            'Type export signature/default mismatch: ' +
              exported.name +
              ' at arity ' +
              count
          );
      }
    }
    if (upstream.flags & ts.SymbolFlags.Class) {
      const upstreamDeclaration = upstream.declarations?.find(
          ts.isClassDeclaration
        ),
        compatDeclaration = compat.declarations?.find(ts.isClassDeclaration);
      if (
        !upstreamDeclaration ||
        !compatDeclaration ||
        !checker.isTypeAssignableTo(
          checker.getTypeOfSymbolAtLocation(compat, compatDeclaration),
          checker.getTypeOfSymbolAtLocation(upstream, upstreamDeclaration)
        )
      )
        failures.push(
          'Class export constructor/statics/prototype mismatch: ' +
            exported.name
        );
    } else if (
      !declaration &&
      !checker.isTypeAssignableTo(
        checker.getDeclaredTypeOfSymbol(compat),
        checker.getDeclaredTypeOfSymbol(upstream)
      )
    )
      failures.push('Type export mismatch: ' + exported.name);
  }
  return failures;
}
