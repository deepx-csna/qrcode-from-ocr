# qrcode-from-ocr

A web demo that **reads a serial number with a camera → issues a QR code → looks up
the device from that QR**.

OCR runs PP-OCRv6 on a **DEEPX DX-M1 NPU**: ~150 ms detection, ~13 ms recognition.

[🇰🇷 한국어](README.md) · 🇺🇸 English · [🇨🇳 中文](README.zh.md)

```
[camera] ──MJPEG──> [browser]
                        │  continuous auto-recognition
                        ▼
   POST /api/scan ─> [PP-OCRv6 @ DX-M1 NPU] ─> DX-M1-A7K3P9V2
                        │  ≥90% confidence + S/N marker → freeze, confirm
                        ▼
                     [issue QR]  http://<LAN-IP>:8090/device/DX-M1-A7K3P9V2
                        │  scan with a phone
                        ▼
                   [device lookup]
```

---

## Requirements

| | |
|---|---|
| **Architecture** | x86_64 · aarch64 (ARM64) |
| **Hardware** | DEEPX **DX-M1 NPU**, USB camera |
| **Runtime** | **DX-RT** (DEEPX runtime) |
| **Build** | CMake 3.14+, a C++17 compiler, OpenCV 4 |
| **Optional** | Node.js 20 — only to **modify** the frontend. The built bundle is committed |

```bash
sudo apt install -y cmake build-essential libopencv-dev v4l-utils
```

Install DX-RT from the package DEEPX provides. If it is not on a standard path,
point the build at it: `DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh`.

The `.dxnn` models (372 MB) are **included in this repository** — nothing to download.

### About architectures

Both x86_64 and aarch64 (ARM64) are supported. There is no architecture-specific
code — no SIMD intrinsics, no inline assembly, no `-march` flags, and the only
binaries committed are the models themselves.

The `.dxnn` models are compiled for the **DX-M1 NPU, not the host CPU**, so they
are architecture-independent (header says `"chip_version": "M1A"`,
`"bytes_order": "little"` — both x86_64 and aarch64 are little-endian).

The one thing that must match your architecture is the **DX-RT installation**.
If it is not on a standard path:

```bash
DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh
```

Cross-compilation is supported via `-DCROSS_COMPILE=ON -DDXRT_INSTALLED_DIR=...`.

> ⚠️ Development and verification were done on x86_64 (Ubuntu 22.04, OpenCV 4.5.4,
> GCC 11.4). aarch64 should work by construction but has not been measured.
> If you run it on an ARM board, please report back.

---

## Quick start

```bash
git clone git@github.com:deepx-mskang/qrcode-from-ocr.git
cd qrcode-from-ocr
./build.sh
./run.sh
```

`build.sh` checks cmake, OpenCV, DX-RT, the models and the camera up front, and
stops with the exact install command if something is missing.

`run.sh` **auto-selects the `/dev/video*` node that actually captures** and opens a
browser. You can also be explicit:

```bash
./run.sh --camera 2            # by index
./run.sh --device /dev/video2  # by path
./run.sh --port 9000 --no-browser
./stop.sh                      # stop
```

---

## Running the demo

1. **Prepare labels** — print `assets/serial_labels.png`, or show it on a phone screen.
2. **Point the camera** — just hold the label inside the guide. **No button press.**
   When it locks on, the view freezes and shows the number.
3. **Confirm** — `맞습니다 · QR 생성 →` (or Space). If wrong, `아니요 · 다시 스캔`.
4. **Look up** — scan the QR with a phone's default camera to open the device page.
   **The phone must be on the same network.**

Without labels, use `라벨 없이 시연하기` at the bottom of the scan screen to pick a
serial directly and demo steps 3–4 only.

---

## Continuous auto-recognition

The scan screen never waits for a button — it keeps sweeping the camera. It freezes
and asks for confirmation when **both** hold:

**① Confidence** at or above the threshold (default **90%**, `--auto-confidence`)

**② Evidence**, one of:

| `autoReason` | Meaning |
|---|---|
| `keyword_same_box` | A serial marker on the **same line** as the serial — strongest |
| `keyword` | A serial marker somewhere in the frame |
| `strict_format` | No marker, but the canonical `DX-M1-XXXXXXXX` format |

Markers recognized:

| Language | Markers |
|---|---|
| English | `S/N` `S.N` `SN` `SERIAL` `SERIAL NO` |
| Korean | `시리얼` `일련번호` `제품번호` |
| Chinese | `序列号` `序列號` `序號` `編號` |
| Japanese | `シリアル` `製造番号` |

Short markers like `SN` are checked for **word boundaries** so they don't match inside
another word. Marker detection runs on the **raw OCR text**, because normalization
turns `S/N` into `S-N`.

**Details**

- **Polling** — the frontend calls `/api/scan` sequentially (not `setInterval`).
  OCR is serialized server-side, so overlapping requests would only queue up.
- **Bandwidth** — live polling uses `?frame=0` to skip the ~80 KB base64 JPEG.
  The server attaches the image **only for the frame that triggered auto-capture**.
- **Rejected serials are skipped** — pressing `아니요` remembers that serial, so the
  confirm screen doesn't loop while the same label is still in view. `지금 바로 인식`
  clears the memory.

---

## How a serial is identified

**Normalization** — alphanumerics are uppercased; everything else (spaces, `:` `/` `.`
`_`) collapses to a single `-`. Collapsing instead of deleting preserves token
boundaries (`S/N: DX-M1-A7K3P9V2` → `SN-DX-M1-A7K3P9V2`), and as a bonus recovers
`DX M1 A7K3P9V2` when OCR reads hyphens as spaces.

**Search** — substring search, not whole-string match, so a serial surrounded by other
text in the same box is still found.

| Rank | Pattern | Condition |
|---|---|---|
| 0 | `DX-?M1-?([A-Z0-9]{8})` | Canonical format |
| 1 | `([A-Z]{2,4})-?([A-Z0-9]{6,12})` | Generic shape + ≥3 digits in the body |
| 2 | Rank 0 re-applied to **all boxes concatenated** | Serial split across boxes |
| 3 | `DX-?M1-?([A-Z0-9]{5,12})` + ≥2 digits | Wrong length; only if 0–2 all fail |

A match must not start or end mid-alphanumeric. The digit requirement keeps caption
text from being mistaken for a serial (`S/N: DX-M1 NPU MODULE` matches nothing).

> **Serial naming rule** — avoid `O Q I L S B Z` in the body. The server corrects
> OCR-confusable characters to digits (`O→0`, `I→1`, `S→5` …), so those letters in a
> correct serial would corrupt an otherwise perfect read.

---

## Device registry

Device data is **owned by the server** (`data/registry.json`), not the browser —
a phone that scans the QR has to see the same data. Registration takes effect
immediately; no rebuild.

**Serials are unique.** Duplicate registration is rejected (HTTP 409). Case and
surrounding whitespace are normalized, so `dx-m1-a7k3p9v2` is the same device.

### Two ways to register

| Path | Entry | Serial field | Other fields |
|---|---|---|---|
| **Pre-register** | `+ 기기 사전 등록` → `/register` | **empty**, auto-focused | example values |
| **After a scan** | unregistered serial → `이 기기 등록하기` → `/register?serial=…` | **pre-filled** from OCR | example values |

Both prefill model, firmware, MAC, dates, QA status and site, so during a demo you
only type the serial. Registration goes straight to the QR screen.

### Deleting

Header link **`기기 관리`** (`/devices`) lists devices with a delete action. Deletion is
irreversible, so it asks again inline. The lookup page (`/device/…`) has no delete
button — that page is what a phone opens, and a viewer shouldn't be able to erase data.

```bash
curl -X DELETE localhost:8090/api/devices/DX-M1-A7K3P9V2
```

### Resetting

If the registry file is absent the server seeds it from `data/seed_devices.json`.

```bash
./stop.sh && rm data/registry.json && ./run.sh
```

---

## Printing a QR label

`QR 프린트` on the QR screen prints a **black-and-white label to stick on the device**
(88 mm wide: 55 mm QR, serial, model, URL) — not a screenshot of the page.

The label is mounted through a React portal **outside `#root`**, and printing hides
`#root` so no blank page follows. The app is dark-themed, so the print stylesheet
forces a white background — otherwise enabling "Background graphics" would flood the
page with ink (`web/src/index.css`).

---

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | `{"status":"ok","camera":true,"npu":true,"frames":N}` |
| `GET` | `/api/config` | `{"lanBaseUrl":"http://192.168.x.x:8090","port":8090}` |
| `GET` | `/api/stream` | MJPEG (`multipart/x-mixed-replace`) |
| `POST` | `/api/scan` | OCR the latest frame. `?frame=0` attaches the image only on auto-capture |
| `GET` | `/api/devices` | All registered devices |
| `GET` | `/api/devices/{serial}` | One device (404 if unregistered) |
| `POST` | `/api/devices` | Register (201 / 409 duplicate / 400 invalid) |
| `DELETE` | `/api/devices/{serial}` | Unregister |
| `GET` | `/*` | Serves `web/dist`; 404 falls back to `index.html` (SPA) |

**The QR encodes `lanBaseUrl` from `/api/config`.** If the frontend used
`window.location.origin`, a QR generated while browsing `localhost` would be
unopenable from a phone — so the server reports the LAN address it finds via
`getifaddrs()`.

---

## Layout

```
qrcode-from-ocr/
├── build.sh / run.sh / stop.sh
├── cpp/
│   ├── serial_ocr_server.cpp     camera (V4L2) + MJPEG + OCR + static serving
│   ├── device_registry.{hpp,cpp} JSON-file device registry
│   ├── ocr_engine.{hpp,cpp}      PP-OCRv6 inference (from DEEPX dx-demos)
│   └── third_party/              cpp-httplib, nlohmann/json
├── web/                          Vite + React + TypeScript + Tailwind
│   └── dist/                     ★ built bundle is committed — runs without Node
├── models/                       8 .dxnn files + dictionary (372 MB)
├── data/seed_devices.json        8 seed devices
└── assets/serial_labels.png      printable label sheet (A4, 300 dpi)
```

The browser camera API (`getUserMedia`) is not used — the server owns the camera and
streams MJPEG — so **no HTTPS setup is required**.

---

## Development

```bash
# terminal 1 — C++ server
./run.sh --no-browser

# terminal 2 — Vite dev server (:5173, proxies /api to 8090)
cd web && npm run dev
```

### Testing OCR without a camera

```bash
./cpp/build/serial_ocr_server --test-image assets/serial_labels.png
```

Runs OCR on one image, prints the same JSON as `/api/scan`, and exits — handy when
tuning the serial regexes or the confusable-character rules. See `--help` for all flags.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| No camera image | `v4l2-ctl --list-devices`. The node that lists formats is the capture node. Then `./run.sh --device /dev/videoN` |
| Phone won't open the QR | ① same network? ② is `LAN base URL` in the log not `localhost`? ③ firewall on the port. The URL under the QR can be typed manually |
| Never auto-freezes | Read the on-screen hint. `신뢰도 87% — 임계값 90% 미만` means move the label closer. Otherwise use `지금 바로 인식` |
| Same number keeps appearing | Press `아니요` to skip it, then move the label away |
| Wrong characters | Check the serial for `O Q I L S B Z` (see the naming rule) |
| `DX-RT 없음` | Install DX-RT, then `DXRT_INSTALLED_DIR=/path ./build.sh` |
| Model load fails | `ls models/*.dxnn` should list 8 files; re-clone if fewer |

---

## License

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled components.
