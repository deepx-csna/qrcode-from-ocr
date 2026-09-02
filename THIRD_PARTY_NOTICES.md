# Third-Party Notices

This project bundles the following third-party components.

| Component | Version | License | Path |
|---|---|---|---|
| [cpp-httplib](https://github.com/yhirose/cpp-httplib) | 0.18.3 | MIT | `cpp/third_party/httplib.h` |
| [nlohmann/json](https://github.com/nlohmann/json) | 3.11.3 | MIT | `cpp/third_party/nlohmann/json.hpp` |
| [React](https://react.dev) | 18.3 | MIT | `web/` (npm) |
| [Vite](https://vitejs.dev) | 5.4 | MIT | `web/` (npm) |
| [Tailwind CSS](https://tailwindcss.com) | 3.4 | MIT | `web/` (npm) |
| [node-qrcode](https://github.com/soldair/node-qrcode) | 1.5 | MIT | `web/` (npm) |
| [react-router](https://reactrouter.com) | 6.28 | MIT | `web/` (npm) |

The OCR inference engine (`cpp/ocr_engine.{hpp,cpp}`) originates from the
DEEPX `dx-demos` repository (`apps/paddle-ocr/cpp`) and is vendored here so
this demo builds standalone.

The `.dxnn` models under `models/` are PP-OCRv6 weights compiled for the
DEEPX DX-M1 NPU. PP-OCRv6 derives from
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (Apache-2.0).

Fonts used to render `assets/serial_labels.png` are DejaVu (Bitstream Vera
license).
