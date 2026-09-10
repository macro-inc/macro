/** Remove printer-added trailing spaces without reformatting generated code. */
const directory = process.argv[2];
if (!directory) throw new Error('Expected a generated output directory');

for await (const path of new Bun.Glob('**/*.ts').scan({
  cwd: directory,
  absolute: true,
})) {
  const source = await Bun.file(path).text();
  const formatted = source.replace(/[\t ]+$/gm, '');
  if (formatted !== source) await Bun.write(path, formatted);
}

export {};
