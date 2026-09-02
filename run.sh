#!/usr/bin/env bash
#
# qrcode-from-ocr launcher
#
#   ./run.sh                      auto-detect the camera and open a browser
#   ./run.sh --camera 2           select the camera by index
#   ./run.sh --device /dev/video2 select the camera by path
#   ./run.sh --list-cameras       show which cameras work, then exit
#   ./run.sh --port 8090          listen on a different port
#   ./run.sh --no-browser         do not open a browser
#
# Environment variables work too (command-line flags win):
#   DX_CAMERA_IDX=2 DX_PORT=8090 ./run.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${ROOT}/cpp/build/serial_ocr_server"

usage() {
    # Print the leading comment block, whatever its length.
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
    exit 0
}

PORT="${DX_PORT:-8090}"
CAMERA_IDX="${DX_CAMERA_IDX:-}"
CAMERA_DEV="${DX_CAMERA_DEV:-}"
OPEN_BROWSER=true
LIST_CAMERAS=false
EXTRA=()

while (( $# )); do
    case "$1" in
        --port)       PORT="$2"; shift 2;;
        --camera)     CAMERA_IDX="$2"; CAMERA_DEV=""; shift 2;;
        --device)     CAMERA_DEV="$2"; shift 2;;
        --no-browser)   OPEN_BROWSER=false; shift;;
        --list-cameras) LIST_CAMERAS=true; shift;;
        -h|--help)    usage;;
        *)            EXTRA+=("$1"); shift;;
    esac
done

# Camera diagnostics: hand straight to the server and exit. It skips the NPU
# model load, so this returns immediately.
if [ "${LIST_CAMERAS}" = true ]; then
    exec "${BIN}" --list-cameras
fi

if [ ! -x "${BIN}" ]; then
    echo "Server binary not found: ${BIN}" >&2
    echo "Run ./build.sh first." >&2
    exit 1
fi

if [ ! -f "${ROOT}/web/dist/index.html" ]; then
    echo "web/dist is missing. Run ./build.sh first." >&2
    exit 1
fi

"${ROOT}/stop.sh" >/dev/null 2>&1 || true

# Camera selection. Auto-detection lives in the server, which opens each
# /dev/video* candidate and keeps the first one that actually delivers a frame.
# Probing here with v4l2-ctl was unreliable: the tool is not always installed,
# and a node that lists formats does not necessarily produce frames.
CAM_ARGS=()
if [ -n "${CAMERA_DEV}" ]; then
    CAM_ARGS=(--device "${CAMERA_DEV}")
elif [ -n "${CAMERA_IDX}" ]; then
    CAM_ARGS=(--camera "${CAMERA_IDX}")
fi

echo "Starting the server on port ${PORT}..."
"${BIN}" "${CAM_ARGS[@]}" --port "${PORT}" \
    --width 1280 --height 720 --fps 15 --crop 960 "${EXTRA[@]}" &
SERVER_PID=$!
echo "${SERVER_PID}" > "${ROOT}/.server.pid"

cleanup() { kill "${SERVER_PID}" 2>/dev/null || true; rm -f "${ROOT}/.server.pid"; }
trap cleanup EXIT INT TERM

# Loading the NPU models takes a while.
printf "Waiting for the models to load"
for _ in $(seq 1 90); do
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
        echo; echo "The server exited unexpectedly." >&2; exit 1
    fi
    if curl -fsS --max-time 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
        echo " ready."
        break
    fi
    printf "."
    sleep 1
done

LAN_URL=$(curl -fsS --max-time 2 "http://localhost:${PORT}/api/config" 2>/dev/null \
          | sed -n 's/.*"lanBaseUrl":"\([^"]*\)".*/\1/p')

echo
echo "  Local   http://localhost:${PORT}"
[ -n "${LAN_URL}" ] && echo "  Phone   ${LAN_URL}   (same network)"
echo
echo "Press Ctrl+C or run ./stop.sh to stop."

if [ "${OPEN_BROWSER}" = true ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    (xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 &) || true
fi

wait "${SERVER_PID}"
