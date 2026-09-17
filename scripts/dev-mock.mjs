// Local preview with no Supabase project: runs `next dev` on :3100 with the
// simulated Auth/PostgREST from tests/mock-backend.mjs preloaded into every
// Node process. Sign in as manager@example.test / staff@example.test with
// password local-test-password. Nothing here is imported by the app.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const preload = `--import=${pathToFileURL(resolve('tests/mock-backend.mjs')).href}`;
const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '-p', '3100'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ') },
});
child.on('exit', (code) => process.exit(code ?? 0));
