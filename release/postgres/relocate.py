#!/usr/bin/env python3
"""Relocate an isolated PostgreSQL install: python3 relocate.py /path/to/pgsql."""
import os
from pathlib import Path
import subprocess
import sys
root = Path(sys.argv[1]).resolve()
for path in root.rglob('*'):
    if path.is_symlink() or not path.is_file():
        continue
    if 'Mach-O' not in subprocess.run(['file', '-b', str(path)], capture_output=True, text=True, check=True).stdout:
        continue
    lines = subprocess.run(['otool', '-L', str(path)], capture_output=True, text=True, check=True).stdout.splitlines()[1:]
    args = []
    for line in lines:
        old = line.strip().split(' (', 1)[0]
        prefix = '/opt/sass/postgresql/lib/'
        if not old.startswith(prefix):
            continue
        target = root / 'lib' / old.removeprefix(prefix)
        if path == target:
            args += ['-id', '@loader_path/' + path.name]
        else:
            args += ['-change', old, '@loader_path/' + os.path.relpath(target, path.parent)]
    if args:
        subprocess.run(['install_name_tool', *args, str(path)], check=True)
        subprocess.run(['codesign', '--force', '--sign', '-', str(path)], check=True)
