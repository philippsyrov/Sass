"""Destructive terminal lifecycle probe: disposable GitHub-hosted Macs only."""
import json
import os
import pathlib
import pty
import signal
import sys
import tempfile
import time

if not (sys.platform == 'darwin'
        and os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
        and os.environ.get('SASS_DISPOSABLE_MAC_RUNNER') == '1'):
    raise SystemExit('This probe requires a disposable GitHub-hosted Mac runner.')

with tempfile.TemporaryDirectory(prefix='sass-terminal-close-') as work:
    audit = pathlib.Path(work) / 'audit'
    pid, master = pty.fork()
    if pid == 0:
        os.execv(sys.argv[1], [sys.argv[1], 'tests/fixtures/shutdown-runtime.mjs', 'child', str(audit)])
    finished = False
    try:
        deadline = time.monotonic() + 10
        while not audit.exists() or 'ready\n' not in audit.read_text():
            if time.monotonic() >= deadline:
                raise RuntimeError('Synthetic runtime did not become ready.')
            time.sleep(.02)
        # Closing the master makes macOS deliver hangup to the slave's session.
        os.close(master)
        master = None
        deadline = time.monotonic() + 10
        while True:
            exited, status = os.waitpid(pid, os.WNOHANG)
            if exited:
                finished = True
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Runtime did not exit after terminal closure.')
            time.sleep(.02)
        lines = audit.read_text().splitlines()
        expected = ['ready', 'SIGHUP received — shutting down gracefully...',
                    'maintenance', 'memory', 'discord', 'embedder', 'database', 'exit:0']
        code = os.waitstatus_to_exitcode(status)
        if code != 0 or lines != expected:
            raise RuntimeError('Terminal closure did not complete ordered shutdown.')
        print(json.dumps({'exit': code, 'orderedShutdown': True}))
    finally:
        if master is not None:
            os.close(master)
        if not finished:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            # Never wait synchronously for a process stuck inside the kernel.
