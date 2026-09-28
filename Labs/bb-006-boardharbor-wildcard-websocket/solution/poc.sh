#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

python_command=""
install_command="python3"
for candidate in python3 python; do
  if ! command -v "$candidate" >/dev/null 2>&1; then
    continue
  fi
  install_command="$candidate"
  if "$candidate" -c 'import websocket' >/dev/null 2>&1; then
    python_command="$candidate"
    break
  fi
done

if [[ -z "$python_command" ]]; then
  printf '%s\n' \
    "Python 3 with websocket-client is required." \
    "Install it with: $install_command -m pip install websocket-client" >&2
  exit 1
fi

exec "$python_command" "$script_dir/poc.py" "$@"
