import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

export interface BoundaryViolation {
  file: string;
  line: number;
  reference: string;
  reason: string;
}

const CODE = /\.[cm]?[jt]sx?$/;
const ASSET =
  /\.(?:avif|bmp|css|gif|ico|jpe?g|js|mjs|mp4|ogg|otf|pdf|png|svg|ttf|wasm|webm|webp|woff2?)(?:[?#].*)?$/i;
const BUILTINS = new Set(
  builtinModules.map((name) => name.replace(/^node:/, ''))
);
const APP_ALIASES =
  /^@(?:core|queries|components|entity|companies|block-[^/]+|service-[^/]+|macro-inc)(?:\/|$)/;
const LEGACY_ASSET =
  /^\/(?:app(?:\/|$)|live-editor(?:\/|$)|src(?:\/|$)|@fs(?:\/|$)|packages(?:\/|$))/;

const inside = (file: string, directory: string) =>
  file === directory || file.startsWith(`${directory}${path.sep}`);
const clean = (value: string) => value.split(/[?#]/)[0];
const real = (file: string) => {
  // Resolve the nearest existing ancestor too, so a missing file cannot hide
  // an escaping symlink or an import through an external directory.
  let current = file;
  const missing: string[] = [];
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.join(fs.realpathSync(current), ...missing);
};
const staticString = (node: ts.Node | undefined): string | undefined =>
  node &&
  (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

/** Check every website source, including unreferenced code, without building the app. */
export function auditStandalone(websiteRoot: string) {
  const website = real(path.resolve(websiteRoot));
  const publicRoot = path.join(website, 'public');
  const violations: BoundaryViolation[] = [];
  const sourceFiles: string[] = [];
  let referencesChecked = 0;
  const add = (
    file: string,
    text: string,
    position: number,
    reference: string,
    reason: string
  ) => {
    const violation = {
      file: path.relative(website, file),
      line: text.slice(0, position).split('\n').length,
      reference,
      reason,
    };
    if (
      !violations.some(
        (item) => JSON.stringify(item) === JSON.stringify(violation)
      )
    )
      violations.push(violation);
  };
  const allowedModule = (file: string) => {
    const resolved = real(file);
    return (
      inside(resolved, website) ||
      resolved.includes(`${path.sep}node_modules${path.sep}`)
    );
  };
  const configFile = path.join(website, 'tsconfig.json');
  const configText = fs.existsSync(configFile)
    ? fs.readFileSync(configFile, 'utf8')
    : '{}';
  const parsedConfig = ts.parseConfigFileTextToJson(configFile, configText);
  const config = parsedConfig.config ?? {};
  if (parsedConfig.error)
    add(
      configFile,
      configText,
      0,
      'tsconfig.json',
      'Cannot parse website TypeScript configuration'
    );
  const manifestFile = path.join(website, 'package.json');
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    : {};
  const declaredDependencies: Record<string, string> = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const dependencies = new Set(Object.keys(declaredDependencies));
  for (const [name, version] of Object.entries(declaredDependencies)) {
    const localPath = version.match(/^(?:file:|link:)(.*)$/)?.[1];
    if (
      APP_ALIASES.test(name) ||
      version.startsWith('workspace:') ||
      version.startsWith('npm:@macro-inc/') ||
      (localPath && !inside(real(path.resolve(website, localPath)), website))
    )
      add(
        manifestFile,
        '',
        0,
        `${name}: ${version}`,
        'Website dependencies cannot include application or workspace packages'
      );
  }
  const baseUrl = path.resolve(website, config.compilerOptions?.baseUrl ?? '.');
  const aliases: Record<string, string[]> = config.compilerOptions?.paths ?? {};
  const extendsList = Array.isArray(config.extends)
    ? config.extends
    : config.extends
      ? [config.extends]
      : [];
  for (const extension of extendsList) {
    if (!inside(real(path.resolve(website, extension)), website))
      add(
        configFile,
        configText,
        0,
        extension,
        'TypeScript configuration must be website-owned'
      );
  }
  for (const [alias, targets] of Object.entries(aliases)) {
    for (const target of targets) {
      const prefix = target.split('*')[0];
      if (!allowedModule(path.resolve(baseUrl, prefix)))
        add(
          configFile,
          configText,
          0,
          `${alias} -> ${target}`,
          'Alias resolves outside the website or third-party node_modules'
        );
    }
  }
  const resolveLocal = (target: string) => {
    const candidates = [
      target,
      ...[
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.json',
        '.css',
        '/index.ts',
        '/index.tsx',
        '/index.js',
      ].map((suffix) => target + suffix),
    ];
    return candidates.find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
  };
  const resolveAlias = (specifier: string) => {
    for (const [alias, targets] of Object.entries(aliases)) {
      const [before, after = ''] = alias.split('*');
      if (
        alias.includes('*')
          ? specifier.startsWith(before) && specifier.endsWith(after)
          : specifier === alias
      ) {
        const wildcard = specifier.slice(
          before.length,
          after ? -after.length : undefined
        );
        return targets.map((target) =>
          path.resolve(baseUrl, target.replace('*', wildcard))
        );
      }
    }
    return undefined;
  };
  const moduleReference = (
    file: string,
    text: string,
    position: number,
    specifier: string,
    glob = false
  ) => {
    referencesChecked++;
    if (APP_ALIASES.test(specifier)) {
      add(
        file,
        text,
        position,
        specifier,
        'Application and workspace-package imports are forbidden'
      );
      return;
    }
    if (BUILTINS.has(specifier.replace(/^node:/, ''))) return;
    const value = clean(specifier.replace(/^!/, ''));
    const mapped = resolveAlias(value);
    const targets =
      mapped ??
      (value.startsWith('.')
        ? [path.resolve(path.dirname(file), value)]
        : value.startsWith('/')
          ? [path.join(website, value)]
          : undefined);
    if (targets) {
      for (const target of targets) {
        const prefix = glob ? target.split(/[\*{[]/)[0] : target;
        if (!allowedModule(prefix)) {
          add(
            file,
            text,
            position,
            specifier,
            'Import resolves outside the website or third-party node_modules'
          );
          return;
        }
      }
      if (!glob && !targets.some(resolveLocal))
        add(
          file,
          text,
          position,
          specifier,
          'Unresolved local import; app aliases are unavailable to the website'
        );
      return;
    }
    const packageName = value.startsWith('@')
      ? value.split('/').slice(0, 2).join('/')
      : value.split('/')[0];
    if (!dependencies.has(packageName)) {
      add(
        file,
        text,
        position,
        specifier,
        'Third-party imports must be declared in the website package.json'
      );
      return;
    }
    try {
      const resolved = createRequire(file).resolve(value);
      if (!allowedModule(resolved))
        add(
          file,
          text,
          position,
          specifier,
          'Package resolves to repository application or workspace source'
        );
    } catch {
      // TypeScript can resolve ESM packages exporting only declarations.
      const resolved = ts.resolveModuleName(
        value,
        file,
        {
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          module: ts.ModuleKind.ESNext,
          allowJs: true,
        },
        ts.sys
      ).resolvedModule?.resolvedFileName;
      if (!resolved || !allowedModule(resolved))
        add(
          file,
          text,
          position,
          specifier,
          'Unresolved or non-standalone package import'
        );
    }
  };
  const assetReference = (
    file: string,
    text: string,
    position: number,
    reference: string,
    relativeToFile = true
  ) => {
    referencesChecked++;
    if (/^(?:data:|blob:|#)/i.test(reference)) return;
    let value = reference;
    if (/^(?:https?:)?\/\//i.test(value)) {
      const url = new URL(value, 'https://macro.com');
      // Third-party media is intentional. App-hosted assets are not.
      if (!/(^|\.)macro\.com$/.test(url.hostname)) return;
      if (LEGACY_ASSET.test(url.pathname))
        add(
          file,
          text,
          position,
          reference,
          'Website assets cannot load from the authenticated app'
        );
      return;
    }
    try {
      value = decodeURIComponent(clean(value));
    } catch {
      add(file, text, position, reference, 'Malformed asset URL');
      return;
    }
    if (LEGACY_ASSET.test(value)) {
      add(
        file,
        text,
        position,
        reference,
        'Website assets cannot load app source or compiled app/editor bundles'
      );
      return;
    }
    const target = value.startsWith('/')
      ? path.join(publicRoot, value)
      : path.resolve(relativeToFile ? path.dirname(file) : publicRoot, value);
    if (!inside(real(target), website))
      add(file, text, position, reference, 'Asset escapes the website tree');
    else if (!fs.existsSync(target))
      add(
        file,
        text,
        position,
        reference,
        'Local asset is missing from the website'
      );
  };
  const cssReferences = (file: string, text: string, offset = 0) => {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, ' ')
    );
    const imports = [
      ...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["'][^;]*;?/g),
    ];
    for (const match of imports) {
      if (/^(?:https?:|\/\/)/.test(match[1]))
        assetReference(file, text, offset + match.index, match[1]);
      else moduleReference(file, text, offset + match.index, match[1]);
    }
    for (const match of css.matchAll(
      /(?:@source\s+(?:not\s+)?|\bsource\(\s*)["']([^"']+)["']/g
    )) {
      referencesChecked++;
      const prefix = match[1].replace(/^!/, '').split(/[\*{[]/)[0];
      if (!inside(real(path.resolve(path.dirname(file), prefix)), website))
        add(
          file,
          text,
          offset + match.index,
          match[1],
          'CSS source scanning must stay inside the website'
        );
    }
    for (const match of css.matchAll(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)/g
    )) {
      const value = match[1] ?? match[2] ?? match[3];
      if (
        !value.startsWith('var(') &&
        !imports.some(
          (item) =>
            match.index >= item.index &&
            match.index < item.index + item[0].length
        )
      )
        assetReference(file, text, offset + match.index, value);
    }
  };
  const codeReferences = (file: string, text: string) => {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    for (const reference of source.referencedFiles)
      moduleReference(
        file,
        text,
        reference.pos,
        reference.fileName.startsWith('.') || reference.fileName.startsWith('/')
          ? reference.fileName
          : `./${reference.fileName}`
      );
    for (const reference of source.typeReferenceDirectives)
      moduleReference(file, text, reference.pos, reference.fileName);
    const checkImport = (argument: ts.Node | undefined, glob = false) => {
      const argumentsList =
        argument && ts.isArrayLiteralExpression(argument)
          ? argument.elements
          : argument
            ? [argument]
            : [];
      for (const item of argumentsList) {
        const value = staticString(item);
        if (value !== undefined)
          moduleReference(file, text, item.getStart(source), value, glob);
        else
          add(
            file,
            text,
            item.getStart(source),
            item.getText(source),
            'Import paths must be static so the website boundary can be verified'
          );
      }
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) checkImport(node.moduleSpecifier);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument)
      )
        checkImport(node.argument.literal);
      else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      )
        checkImport(node.moduleReference.expression);
      else if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source);
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          ['require', 'require.resolve'].includes(callee)
        )
          checkImport(node.arguments[0]);
        else if (/^import\.meta\.glob(?:Eager)?$/.test(callee))
          checkImport(node.arguments[0], true);
      } else if (
        ts.isNewExpression(node) &&
        node.expression.getText(source) === 'URL' &&
        node.arguments?.[1]?.getText(source) === 'import.meta.url'
      ) {
        const value = staticString(node.arguments[0]);
        if (value !== undefined)
          moduleReference(file, text, node.getStart(source), value);
      }
      const value = staticString(node);
      if (
        value !== undefined &&
        /^(?:\/|\.\.?\/)/.test(value) &&
        ASSET.test(value)
      )
        assetReference(file, text, node.getStart(source), value);
      // URL references in inline style strings are assets too.
      if (value?.includes('url('))
        cssReferences(file, value, node.getStart(source));
      if (
        ts.isJsxAttribute(node) &&
        ['src', 'poster', 'srcset'].includes(node.name.getText(source))
      ) {
        const literal =
          node.initializer && ts.isJsxExpression(node.initializer)
            ? node.initializer.expression
            : node.initializer;
        const url = staticString(literal);
        if (url !== undefined) {
          if (node.name.getText(source) === 'srcset') {
            for (const candidate of url.split(','))
              assetReference(
                file,
                text,
                node.getStart(source),
                candidate.trim().split(/\s+/)[0]
              );
          } else if (!ASSET.test(url))
            assetReference(file, text, node.getStart(source), url);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };
  const htmlReferences = (file: string, text: string) => {
    for (const tag of text.matchAll(
      /<(script|img|source|video|audio|iframe|link|image)\b[^>]*>/gi
    )) {
      for (const attribute of tag[0].matchAll(
        /\b(src|href|xlink:href|poster|srcset)\s*=\s*["']([^"']+)["']/gi
      )) {
        const value = attribute[2];
        const position = tag.index + attribute.index;
        if (tag[1].toLowerCase() === 'script' && value.startsWith('/src/'))
          moduleReference(file, text, position, value);
        else if (attribute[1].toLowerCase() === 'srcset') {
          for (const candidate of value.split(','))
            assetReference(
              file,
              text,
              position,
              candidate.trim().split(/\s+/)[0]
            );
        } else assetReference(file, text, position, value);
      }
    }
    for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
      cssReferences(file, match[1], match.index);
    for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      codeReferences(file, match[1]);
  };
  const walk = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (file === path.join(publicRoot, 'live-editor')) {
        add(
          file,
          '',
          0,
          'public/live-editor',
          'Compiled application editor payloads are forbidden; use website-owned demos'
        );
        continue;
      }
      if (!inside(real(file), website)) {
        add(
          file,
          '',
          0,
          file,
          'Website source and assets cannot be symlinked to external code'
        );
        continue;
      }
      if (entry.isDirectory()) walk(file);
      else sourceFiles.push(file);
    }
  };
  walk(path.join(website, 'src'));
  walk(publicRoot);
  sourceFiles.push(
    ...fs
      .readdirSync(website)
      .filter((file) => file.endsWith('.html'))
      .map((file) => path.join(website, file))
  );
  for (const file of sourceFiles) {
    if (!(CODE.test(file) || /\.(css|html|svg)$/.test(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (CODE.test(file)) codeReferences(file, text);
    else if (file.endsWith('.css')) cssReferences(file, text);
    else htmlReferences(file, text);
  }
  return { filesChecked: sourceFiles.length, referencesChecked, violations };
}

if (import.meta.main) {
  const result = auditStandalone(path.resolve(import.meta.dirname, '..'));
  for (const violation of result.violations)
    console.error(
      `${violation.file}:${violation.line} ${violation.reason}: ${violation.reference}`
    );
  if (result.violations.length) process.exitCode = 1;
  else
    console.log(
      `Standalone boundary passed: ${result.filesChecked} website files, ${result.referencesChecked} references; no app or workspace dependencies.`
    );
}
