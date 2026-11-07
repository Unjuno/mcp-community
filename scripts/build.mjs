import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const extensions = readdirSync('extensions', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join('extensions', entry.name, 'tsconfig.json'))
  .filter((path) => existsSync(path))
  .sort();
const result = spawnSync(
  process.execPath,
  [resolve('node_modules/typescript/bin/tsc'), '-b', 'tsconfig.json', ...extensions],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
