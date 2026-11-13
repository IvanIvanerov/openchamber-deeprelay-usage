#!/usr/bin/env bash
#
# Registers this extension with OpenChamber.
#
# Copies the extension into OpenChamber's extensions directory (or updates the
# copy that is already there) and adds it to the extension store. The
# capability approval stays with the user: OpenChamber asks for it under
# Settings -> Extensions, and the card appears once it is granted.
set -euo pipefail

EXTENSION_ID="deeprelay"
EXTENSION_DIR_NAME="deeprelay-usage"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${OPENCHAMBER_CONFIG_DIR:-$HOME/.config/openchamber}"
EXTENSIONS_DIR="${OPENCHAMBER_EXTENSIONS_DIR:-$CONFIG_DIR/extensions}"
STORE="${OPENCHAMBER_EXTENSION_STORE:-$CONFIG_DIR/extensions.json}"
TARGET="$EXTENSIONS_DIR/$EXTENSION_DIR_NAME"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to update the extension store" >&2
  exit 1
fi

mkdir -p "$EXTENSIONS_DIR"

if [ "$SOURCE_DIR" != "$TARGET" ]; then
  if [ -d "$TARGET/.git" ]; then
    echo "Updating $TARGET"
    git -C "$TARGET" pull --ff-only
  else
    echo "Installing into $TARGET"
    rm -rf "$TARGET"
    mkdir -p "$TARGET"
    tar -C "$SOURCE_DIR" --exclude=node_modules --exclude=.git -cf - . | tar -C "$TARGET" -xf -
  fi
fi

python3 - "$STORE" "$TARGET" "$EXTENSION_ID" <<'PY'
import json
import sys
import uuid
from pathlib import Path

store_path, target, extension_id = Path(sys.argv[1]), sys.argv[2], sys.argv[3]

try:
    store = json.loads(store_path.read_text()) if store_path.exists() else {}
except json.JSONDecodeError as error:
    raise SystemExit(f"{store_path} is not valid JSON: {error}")

paths = store.setdefault("paths", [])
if target not in paths:
    paths.append(target)

storage_ids = store.setdefault("storageIds", {})
storage_ids.setdefault(extension_id, str(uuid.uuid4()))

store_path.write_text(json.dumps(store, indent=2, ensure_ascii=False) + "\n")
print(f"Registered {target} in {store_path}")
PY

cat <<EOF

Next steps:

  1. Restart OpenChamber.
  2. Open Settings -> Extensions, find DeepRelay and approve the "service" capability.
  3. Open Settings -> Usage and pick DeepRelay in the provider list.

The extension reads the "deeprelay" credential OpenCode already holds. If that
provider is not connected yet, connect it first with a key that has the
billing:read scope.
EOF
