// Dev-only entry point. These commands emit counts and opaque ids, never content.
import { pull } from './dev/pull';
import { scans } from './dev/run';

try {
  switch (process.argv[2]) {
    case 'pull':
      process.stdout.write(JSON.stringify(await pull()) + '\n');
      break;
    case 'scan':
      process.stdout.write(JSON.stringify(scans()) + '\n');
      break;
    case 'replay':
      await import('./dev/replay');
      break;
    case 'diagnose':
      await import('./dev/diagnose');
      break;
    default:
      throw new Error('Expected pull, scan, replay or diagnose');
  }
} catch {
  process.stderr.write(
    'Corpus command failed; details suppressed to protect dev data.\n'
  );
  process.exitCode = 2;
}
