#!/bin/sh
# Run by the operator after securely transferring the new service key from the website VPS.
set -eu
root=${ROCO_INSTALL_DIR:-/opt/roco-seo}
python3 - "$root/secrets/staff_auth_service_secret" "$root/secrets/staff-proxy-header.conf" <<'PYTHON'
from pathlib import Path
import os, re, sys
key_path, output_path = map(Path, sys.argv[1:])
if key_path.stat().st_size > 256:
    raise RuntimeError("Invalid service-key file")
key = key_path.read_text().strip()
if not re.fullmatch(r"[a-f0-9]{64}", key):
    raise RuntimeError("Expected the 64-character hex service key generated on the website VPS")
with output_path.open("x") as output:
    os.chmod(output_path, 0o600)
    output.write(f'proxy_set_header X-Roco-Proxy-Key "{key}";\n')
# The host secrets directory stays root-owned mode 0700. The app UID reads only the individual container-mounted key.
os.chown(key_path, 1000, 1000)
os.chmod(key_path, 0o400)
print("Proxy credential include prepared. No credential was printed.")
PYTHON
