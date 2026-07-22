import { spawn } from 'node:child_process';

const python = process.platform === 'win32' ? 'python' : 'python3';
const child = spawn(python, ['-m', 'unittest', 'discover', '-s', 'runtime/agent-bridge/python', '-p', 'test_*.py'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
child.once('error', (error) => {
  console.error(`Unable to start ${python}: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
