import errno, fcntl, json, os, pathlib, pty, select, signal, struct, subprocess, sys, tempfile, termios, time
root = pathlib.Path(__file__).resolve().parents[2]
mode = sys.argv[1]
with tempfile.TemporaryDirectory(prefix='sass-frame-') as work:
    script = (root / 'install.sh').read_text().rsplit('main "$@"', 1)[0]
    script += '''
ensure_git() { echo RAW_GIT_OUTPUT; }
ensure_node() { echo RAW_NODE_OUTPUT >&2; }
write_env_file() { :; }
ensure_repo() { echo RAW_CLONE_OUTPUT; }
install_launcher() { echo RAW_LAUNCHER_OUTPUT; }
run_npm_install() { if [[ "$SASS_TEST_WAIT" = 1 ]]; then installer_out SIMULATED_PACKAGE_WAIT; sleep 30; fi; echo RAW_NPM_OUTPUT; if [[ "$SASS_TEST_FAIL" = 1 ]]; then return 7; fi; }
run_setup_wizard() {
  if [[ "$SASS_TEST_HANDOFF" = 1 ]]; then
    export SASS_INSTALL_FRAME=1
    "$SASS_TEST_NODE" "$SASS_TEST_SETUP" </dev/tty
  fi
}
if [[ "$SASS_TEST_BUNDLE" = 1 ]]; then
  load_bundle_installer() { :; }
  sass_bundle_prepare() { if [[ "$SASS_TEST_METADATA_WAIT" = 1 ]]; then installer_out SIMULATED_METADATA_WAIT; sleep 30; fi; SASS_BUNDLE_BYTES=123456; SASS_BUNDLE_UNPACKED_BYTES=654321; }
fi
main
'''
    script_path = pathlib.Path(work) / 'run.sh'
    if mode == 'piped':
        script = 'curl() { cp "$SASS_TEST_UI" "$4"; }\n' + script
    script_path.write_text(script)
    (pathlib.Path(work) / 'scripts').mkdir()
    (pathlib.Path(work) / 'scripts/install-ui.sh').write_text((root / 'scripts/install-ui.sh').read_text())
    master, slave = pty.openpty()
    original_state = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    env = dict(os.environ, SASS_TEST_METADATA_WAIT='1' if mode == 'bundle-metadata-cancel' else '0', SASS_TEST_BUNDLE='1' if mode.startswith('bundle-') else '0', SASS_SOURCE_INSTALL='0' if mode.startswith('bundle-') else '1', SASS_SETUP_INK='1', SASS_SETUP_ADVANCED='1', TERM='xterm-256color', SASS_DIR=work+'/absent', SASS_HOME=work+'/state', SASS_BIN_DIR=work+'/bin', SASS_TEST_FAIL='1' if mode == 'fail' else '0', SASS_TEST_WAIT='1' if mode == 'cancel-work' else '0', SASS_TEST_HANDOFF='1' if mode == 'handoff' else '0', SASS_TEST_NODE=os.environ.get('SASS_TEST_NODE', 'node'), SASS_TEST_SETUP=str(root/'tests/fixtures/install-ink.mjs'), SASS_TEST_UI=str(pathlib.Path(work)/'scripts/install-ui.sh'))
    for key in ['CI', 'NO_COLOR', 'SASS_SETUP_NO_MASCOT', 'SASS_INSTALL_ASSUME_YES']:
        env.pop(key, None)
    def terminal():
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        os.tcsetpgrp(0, os.getpgrp())
    command = ['/bin/bash', '-c', 'cat "$1" | /bin/bash', 'fixture', str(script_path)] if mode == 'piped' else ['/bin/bash', str(script_path)]
    child = subprocess.Popen(command, cwd=root, env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=terminal)
    os.close(slave)
    output = b''
    answered = closed = False
    setup_answered = set()
    canceled_work = False
    resized = False
    small_start = small_end = 0
    premature_close = False
    end = time.monotonic() + 7
    while time.monotonic() < end:
        if select.select([master], [], [], .05)[0]:
            try: data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
            if not data: break
            output += data
        if mode == 'bundle-metadata-cancel' and not canceled_work and b'SIMULATED_METADATA_WAIT' in output:
            canceled_work = True
            os.write(master, b'\x03')
        if not answered and b'Continue?' in output:
            answered = True
            if mode in ('delayed', 'piped'):
                time.sleep(2)
                while select.select([master], [], [], 0)[0]:
                    output += os.read(master, 65536)
                premature_close = b'Press Enter to close' in output
                os.write(master, b'n')
            elif mode == 'cancel': os.write(master, b'\x03')
            elif mode == 'resize':
                small_start = len(output)
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 60, 0, 0))
                child.send_signal(signal.SIGWINCH)
            else: os.write(master, b'n' if mode in ('decline', 'bundle-decline') else b'\n' if mode == 'enter' else b'y')
        if mode == 'resize' and answered and not resized and b'Resize to 80 columns' in output and b'Continue? Enter/y=yes, n=quit' in output[small_start:]:
            time.sleep(.05)
            os.write(master, b'y')
            time.sleep(.05)
            # The first y must not accept a plan which the small window cannot show.
            resized = True
        if mode == 'resize' and resized and b'Resize the window to read the plan' in output:
            small_end = len(output)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
            child.send_signal(signal.SIGWINCH)
            mode = 'resize-restoring'
        if mode == 'resize-restoring' and b'Continue? Enter/y=yes, n=quit' in output[small_end:] and b'Source: github.com/' in output[small_end:]:
            time.sleep(.05)
            os.write(master, b'n')
            mode = 'resize-complete'
        if mode == 'cancel-work'  and not canceled_work and b'SIMULATED_PACKAGE_WAIT' in output:
            canceled_work = True
            time.sleep(.05)
            os.write(master, b'\x03')
        for prompt in [b'HANDOFF_PROMPT', b'HANDOFF_FINISH']:
            if prompt in output and prompt not in setup_answered:
                setup_answered.add(prompt)
                os.write(master, b'\r')
        if answered and not closed and b'Press Enter to close' in output:
            closed = True
            os.write(master, b'\n')
        if child.poll() is not None: break
    if child.poll() is None:
        child.kill()
    code = child.wait()
    restored = termios.tcgetattr(master) == original_state
    os.close(master)
    print(json.dumps({'output': output.decode(errors='replace'), 'code': code, 'prematureClose': premature_close, 'restored': restored, 'smallOutput': output[small_start:small_end].decode(errors='replace'), 'stateExists': pathlib.Path(work+'/state').exists()}))
