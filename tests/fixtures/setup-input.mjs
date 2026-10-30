// Drive real readline terminal handling over a controlled stream, without a PTY dependency.
if (process.env.SASS_TEST_TERMINAL === '1') {
  Object.defineProperty(process.stdin, 'isTTY', { value: true });
}
// These tests never need network access, even if a prompt accidentally changes.
globalThis.fetch = async () => { throw new Error('Network is disabled in setup tests'); };
const { default: pg } = await import('pg');
pg.Pool.prototype.query = async () => ({ rows: [], rowCount: 0 });
pg.Pool.prototype.end = async () => {};
// Model suspension without stopping the test process or its process group (pid 0,
// which also contains the test runner); the test delivers a real SIGCONT.
const kill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (signal === 'SIGTSTP' && (pid === 0 || pid === process.pid)) {
    process.stdout.write(pid === 0 ? 'SUSPEND_GROUP' : 'SUSPEND_SELF');
    return true;
  }
  return kill(pid, signal);
};
if (process.platform !== 'win32') {
  process.on('SIGCONT', () => setImmediate(() => process.stdout.write('SIGNAL_HANDLED')));
}
