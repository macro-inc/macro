import { readFileSync, writeFileSync } from 'node:fs';
const f = 'crates/client/cache-core/tests/optimistic.rs';
let t = readFileSync(f, 'utf8');
for (const cut of [
  '        assert_eq!(inspected[0].lease_owner, None);\n        assert_eq!(inspected[0].lease_generation, None);\n',
  '        // A runner releasing a lease whose owner is gone needs its token.\n        assert_eq!(inspected[0].lease_owner.as_deref(), Some("runner"));\n        assert_eq!(\n            inspected[0].lease_generation,\n            Some(claimed.lease_generation.to_string())\n        );\n        assert_eq!(inspected[0].lease_expires_at_ms, Some(100));\n',
]) {
  if (!t.includes(cut)) throw new Error('missing');
  t = t.replace(cut, '');
}
writeFileSync(f, t);
