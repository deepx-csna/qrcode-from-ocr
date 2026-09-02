#!/usr/bin/env bash
#
# qrcode-from-ocr build
#
#   ./build.sh            build the C++ server and the web frontend
#   ./build.sh --clean    rebuild everything from scratch
#   ./build.sh --no-web   build the C++ server only
#   ./build.sh --yes      no prompts; install Node automatically if needed
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${ROOT}/cpp/build"

NODE_MAJOR=20
NVM_VERSION="v0.40.1"

usage() {
    # Print the leading comment block, whatever its length.
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
    exit 0
}

clean_build=false
skip_web=false
assume_yes=false

while (( $# )); do
    case "$1" in
        --clean)  clean_build=true; shift;;
        --no-web) skip_web=true;    shift;;
        --yes|-y) assume_yes=true;  shift;;
        -h|--help) usage;;
        *) echo "Unknown argument: $1" >&2; exit 1;;
    esac
done

# --- output helpers ----------------------------------------------------------
if [ -t 1 ]; then
    C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
    C_OK=''; C_ERR=''; C_WARN=''; C_DIM=''; C_OFF=''
fi
ok()   { echo "  ${C_OK}OK${C_OFF}   $*"; }
bad()  { echo "  ${C_ERR}FAIL${C_OFF} $*"; }
warn() { echo "  ${C_WARN}WARN${C_OFF} $*"; }
step() { echo; echo "${C_DIM}--${C_OFF} $* ${C_DIM}$(printf -- '-%.0s' $(seq 1 $((60 - ${#1}))))${C_OFF}"; }

# --- prerequisites -----------------------------------------------------------
step "Checking prerequisites"

missing=0

# Both x86_64 and aarch64 are supported. The .dxnn models target the DX-M1 NPU,
# not the host CPU, so they are architecture-independent. Reported here to make
# bug reports easier to diagnose.
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64|aarch64|arm64) ok "Architecture ${ARCH}";;
    *) warn "Architecture ${ARCH} is untested (x86_64 / aarch64 recommended)";;
esac

if command -v cmake >/dev/null 2>&1; then
    ok "cmake $(cmake --version | head -1 | awk '{print $3}')"
else
    bad "cmake not found     -> sudo apt install -y cmake build-essential"
    missing=1
fi

if command -v make >/dev/null 2>&1 && command -v c++ >/dev/null 2>&1; then
    ok "C++ toolchain $(c++ --version | head -1 | awk '{print $NF}')"
else
    bad "make/g++ not found  -> sudo apt install -y build-essential"
    missing=1
fi

if pkg-config --exists opencv4 2>/dev/null; then
    ok "OpenCV $(pkg-config --modversion opencv4)"
elif ls /usr/include/opencv4 >/dev/null 2>&1 || ls /usr/local/include/opencv4 >/dev/null 2>&1; then
    ok "OpenCV (headers found)"
else
    bad "OpenCV 4 not found  -> sudo apt install -y libopencv-dev"
    missing=1
fi

# DX-RT is the core dependency of this demo; building without it is pointless.
if ls /usr/local/lib/cmake/dxrt/dxrtConfig.cmake >/dev/null 2>&1 \
   || ls /usr/lib/cmake/dxrt/dxrtConfig.cmake >/dev/null 2>&1 \
   || [ -n "${DXRT_INSTALLED_DIR:-}" ]; then
    ok "DX-RT runtime"
else
    bad "DX-RT not found"
    echo "       This demo requires a DEEPX DX-M1 NPU and the DX-RT runtime."
    echo "       Install DX-RT and try again, or point the build at it:"
    echo "         DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh"
    missing=1
fi

# The models ship with the repository. Missing files mean an incomplete clone.
model_count=$(ls "${ROOT}/models"/*.dxnn 2>/dev/null | wc -l)
if [ "${model_count}" -ge 8 ]; then
    ok "Models: ${model_count} files ($(du -sh "${ROOT}/models" | cut -f1))"
else
    bad "Only ${model_count} .dxnn file(s) in models/ (8 expected)"
    echo "       Re-clone the repository; the models are committed to it."
    missing=1
fi

if ls /dev/video* >/dev/null 2>&1; then
    ok "Camera $(ls -d /dev/video* | tr '\n' ' ')"
else
    warn "No camera device found (fine for building, required to run)"
fi

if [ "${missing}" -ne 0 ]; then
    echo
    echo "${C_ERR}Missing prerequisites.${C_OFF} Install them as shown above and re-run."
    exit 1
fi

# --- C++ server ---------------------------------------------------------------
step "Building the C++ server"

if [ "${clean_build}" = true ]; then
    rm -rf "${BUILD_DIR}"
fi
mkdir -p "${BUILD_DIR}"
cmake -S "${ROOT}/cpp" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" -j "$(nproc)"
ok "cpp/build/serial_ocr_server"

if [ "${skip_web}" = true ]; then
    echo; echo "--no-web: skipping the frontend build."
    exit 0
fi

# --- Node.js -------------------------------------------------------------------
step "Web frontend"

# Source nvm if it is installed. Called under `set -e`, so it always returns 0:
# nvm simply being absent is not an error.
load_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "${NVM_DIR}/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "${NVM_DIR}/nvm.sh" || true
    fi
    return 0
}

have_node() {
    command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1
}

install_node() {
    echo "  Installing Node ${NODE_MAJOR} via nvm ${NVM_VERSION} (no sudo required)..."
    if ! command -v curl >/dev/null 2>&1; then
        bad "curl is required to install Node -> sudo apt install -y curl"
        return 1
    fi
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash || return 1
    load_nvm
    nvm install "${NODE_MAJOR}" || return 1
    have_node
}

if ! have_node; then load_nvm; fi

if ! have_node; then
    # The built frontend (web/dist) is committed, so the demo runs without Node.
    # Installing it is purely optional.
    echo "  Node.js not found."
    if [ -f "${ROOT}/web/dist/index.html" ]; then
        echo "  ${C_DIM}A prebuilt web/dist ships with this repository, so the demo runs without it.${C_OFF}"
        echo "  ${C_DIM}Install Node only if you intend to modify the frontend source.${C_OFF}"
    fi

    if [ "${assume_yes}" = true ]; then
        reply=y
    elif [ -t 0 ]; then
        read -r -p "  Install Node ${NODE_MAJOR} now? [Y/n] " reply
        reply=${reply:-y}
    else
        reply=n   # never install unattended (CI and the like)
    fi

    case "${reply}" in
        [Yy]*)
            if install_node; then
                ok "Node $(node -v) / npm $(npm -v)"
            else
                bad "Node installation failed."
                if [ -f "${ROOT}/web/dist/index.html" ]; then
                    warn "Falling back to the prebuilt web/dist."
                    echo; echo "Build complete. Run it with: ./run.sh"
                    exit 0
                fi
                exit 1
            fi
            ;;
        *)
            if [ -f "${ROOT}/web/dist/index.html" ]; then
                warn "Skipping installation; using the prebuilt web/dist."
                echo; echo "Build complete. Run it with: ./run.sh"
                exit 0
            fi
            bad "Cannot build the frontend: neither web/dist nor Node is available."
            echo "       To install Node later:"
            echo "         curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash"
            echo "         source ~/.nvm/nvm.sh && nvm install ${NODE_MAJOR}"
            exit 1
            ;;
    esac
else
    ok "Node $(node -v) / npm $(npm -v)"
fi

cd "${ROOT}/web"
if [ "${clean_build}" = true ]; then
    rm -rf node_modules dist
fi
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi
npm run build
ok "web/dist"

echo
echo "${C_OK}Build complete.${C_OFF} Run it with: ./run.sh"
