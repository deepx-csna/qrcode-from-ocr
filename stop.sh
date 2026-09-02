#!/usr/bin/env bash
# Stop a running qrcode-from-ocr server.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${ROOT}/.server.pid"

if [ -f "${PID_FILE}" ]; then
    kill -TERM "$(cat "${PID_FILE}")" 2>/dev/null || true
    rm -f "${PID_FILE}"
fi

# Catch anything left over when the PID file is absent or stale. Matched by
# full executable path: a looser pattern would also kill shells and editors
# whose command line happens to contain the string.
pkill -TERM -f "${ROOT}/cpp/build/serial_ocr_server" 2>/dev/null || true
exit 0
