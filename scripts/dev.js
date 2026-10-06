// Runs the API server (restarting on change) and the Vite dev server together.
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--watch-path=server', 'server/index.js'], { stdio: 'inherit', env: { ...process.env, MILO_DEV: '1' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' }),
];

function stop() {
  for (const child of children) child.kill('SIGTERM');
}

for (const child of children) {
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
