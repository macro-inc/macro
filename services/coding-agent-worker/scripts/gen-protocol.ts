import { jsonSchemaToZod } from 'json-schema-to-zod'

const REPO_ROOT = new URL('../../..', import.meta.url).pathname
const OUT = new URL('../src/protocol/generated.ts', import.meta.url).pathname

const dump = Bun.spawnSync(['cargo', 'run', '-p', 'agent_runtime_protocol', '--example', 'dump_schema'], {
  cwd: REPO_ROOT,
  stderr: 'inherit',
})
if (!dump.success) {
  console.error('dump_schema failed')
  process.exit(1)
}
const schemas = JSON.parse(dump.stdout.toString()) as Record<string, object>

const header = `// GENERATED FILE — do not edit.
// Source of truth: crates/agent_runtime_protocol/src/schema/v0/mod.rs
// Regenerate with: just gen-protocol

import { z } from 'zod'
`

const blocks = Object.entries(schemas).map(([name, schema]) => {
  const expr = jsonSchemaToZod(schema)
  return `export const ${name} = ${expr}\nexport type ${name} = z.infer<typeof ${name}>\n`
})

await Bun.write(OUT, `${header}\n${blocks.join('\n')}`)
console.error(`wrote ${OUT} (${Object.keys(schemas).join(', ')})`)
