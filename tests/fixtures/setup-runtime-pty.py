import errno, fcntl, json, os, pathlib, pty, select, signal, struct, subprocess, sys, tempfile, termios, time

root = pathlib.Path(__file__).resolve().parents[2]
mode = sys.argv[1]
def stage(name):
    print('runtime PTY: ' + name, file=sys.stderr, flush=True)

with tempfile.TemporaryDirectory(prefix='sass-runtime-pty-') as work:
    app = pathlib.Path(work)
    (app / 'dist').mkdir()
    (app / 'package.json').write_text('{"type":"module"}')
    (app / 'bundle-manifest.json').write_text('{}')
    (app / 'dist/index.js').write_text('''
let stopping = false;
const stop = signal => {
  console.log('CHILD_STOP_BEGIN:' + signal);
  if (stopping) return;
  stopping = true;
  setTimeout(() => { console.log('CHILD_STOP_DONE'); process.exit(0); }, 250);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGHUP', () => stop('SIGHUP'));
setInterval(() => {}, 1000);
console.log('CHILD_READY');
if (process.env.SASS_TEST_RUNTIME_NORMAL === '1') setTimeout(() => { console.log('CHILD_NORMAL_DONE'); process.exit(7); }, 100);
''')
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
    env = {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': work, 'TERM': 'xterm-256color',
        'PS1': 'SHELL_READY> ', 'SASS_TEST_SKIP_EMBEDDED': '1',
        'SASS_TEST_RUNTIME_NORMAL': '1' if mode == 'normal' else '0',
        'SASS_TEST_RUNTIME_CANCEL': '1' if mode == 'setup-cancel' else '0',
    }
    def terminal():
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        os.tcsetpgrp(0, os.getpgrp())
    stage('starting shell')
    shell = subprocess.Popen(['/bin/bash', '--noprofile', '--norc', '-i'], cwd=work, env=env,
                             stdin=slave, stdout=slave, stderr=slave, preexec_fn=terminal)
    os.close(slave)
    stage('shell started')
    node = os.environ['SASS_TEST_NODE']
    import shlex
    command = ' '.join(shlex.quote(str(part)) for part in [node, '--import', root / 'tests/fixtures/setup-runtime-input.mjs', root / 'dist/setup.js'])
    command += '; printf "PARENT_EXIT:%s\\n" "$?"\n'
    output = b''
    sent = set()
    runtime_state = None
    shell_state = None
    returned_state = None
    repeated_at = None
    child_pid = None
    # Read the synthetic child's PID from its own marker only; never inspect other processes.
    source = (app / 'dist/index.js').read_text().replace("console.log('CHILD_READY');", "console.log('CHILD_READY:' + process.pid);")
    (app / 'dist/index.js').write_text(source)
    try:
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if select.select([master], [], [], .02)[0]:
                try: data = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if not data: break
                output += data
            if 'launch' not in sent and b'SHELL_READY>' in output:
                stage('launching setup')
                shell_state = termios.tcgetattr(master)
                sent.add('launch'); os.write(master, command.encode())
            for label, prompt, answer in [
                ('token', b'Discord bot token', b'\x03'),
                ('start', b'Setup is ready. Enter to start Sass.', b'\r'),
            ]:
                if (prompt in output and label not in sent
                    and (label != 'token' or mode == 'setup-cancel')
                    and (label != 'start' or b'SASS_TEST_ACTION_READY' in output)):
                    sent.add(label)
                    stage('answering ' + label)
                    os.write(master, answer)
            if b'CHILD_READY:' in output and 'running' not in sent:
                import re
                match = re.search(rb'CHILD_READY:(\d+)', output)
                if match:
                    child_pid = int(match.group(1))
                    sent.add('running')
                    stage('runtime ready')
                    runtime_state = termios.tcgetattr(master)
                    if mode != 'normal':
                        if mode == 'hangup': os.killpg(os.tcgetpgrp(master), signal.SIGHUP)
                        elif mode == 'terminate': os.killpg(os.tcgetpgrp(master), signal.SIGTERM)
                        else: os.write(master, b'\x03')
                        repeated_at = time.monotonic() + .04
            if repeated_at is not None and time.monotonic() >= repeated_at and 'repeat' not in sent:
                sent.add('repeat')
                # The shell owns this test session; find only its current foreground child group.
                foreground = os.tcgetpgrp(master)
                if foreground != shell.pid: os.killpg(foreground, signal.SIGTERM)
            if b'PARENT_EXIT:' in output and output.count(b'SHELL_READY>') >= 2:
                if mode == 'setup-cancel' or mode == 'normal' or b'CHILD_STOP_DONE' in output:
                    returned_state = termios.tcgetattr(master)
                    stage('shell returned')
                    break
        os.write(master, b'exit\n')
        stage('closing shell')
        # On macOS, the session leader can wait for terminal output to drain
        # during exit. Keep reading instead of waiting with the PTY unread.
        drain_until = time.monotonic() + 2
        while shell.poll() is None and time.monotonic() < drain_until:
            if select.select([master], [], [], .02)[0]:
                try: data = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if not data: break
                output += data
        shell.wait(timeout=2)
    finally:
        stage('cleaning up synthetic processes')
        foreground = os.tcgetpgrp(master)
        stage('foreground group ' + str(foreground))
        if foreground > 0 and foreground != shell.pid:
            try: os.killpg(foreground, signal.SIGKILL)
            except ProcessLookupError: pass
        if child_pid is not None and b'CHILD_STOP_DONE' not in output and b'CHILD_NORMAL_DONE' not in output:
            try: os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError: pass
        stage('closing PTY')
        os.close(master)
        if shell.poll() is None:
            stage('stopping shell ' + str(shell.pid))
            shell.kill(); shell.wait(timeout=2)
        stage('PTY closed')
    text = output.decode(errors='replace')
    markers = ['CHILD_STOP_BEGIN:SIGHUP', 'CHILD_STOP_BEGIN:SIGINT', 'CHILD_STOP_BEGIN:SIGTERM', 'CHILD_STOP_DONE', 'CHILD_NORMAL_DONE', 'PARENT_EXIT:0', 'PARENT_EXIT:7', 'PARENT_EXIT:130', 'Setup cancelled.', 'ollama rm']
    print(json.dumps({
        'markers': {marker: text.count(marker) for marker in markers},
        'shutdownBeforeParentExit': text.find('CHILD_STOP_DONE') >= 0 and text.find('CHILD_STOP_DONE') < text.rfind('PARENT_EXIT:'),
        'runtimeTerminalRestored': runtime_state is not None and bool(runtime_state[3] & termios.ICANON) and bool(runtime_state[3] & termios.ECHO),
        'terminalRestored': returned_state is not None and returned_state == shell_state,
        'started': 'running' in sent,
    }))
