# qrcode-from-ocr

**카메라로 시리얼 번호를 읽고 → QR 을 발행하고 → 그 QR 로 기기 정보를 조회하는** 웹 데모.

OCR 은 PP-OCRv6 이 **DEEPX DX-M1 NPU** 에서 동작합니다. 검출 ~150ms, 인식 ~13ms.

🇰🇷 한국어 · [🇺🇸 English](README.en.md) · [🇨🇳 中文](README.zh.md)

```
[카메라] ──MJPEG──> [브라우저]
                        │  실시간 자동 인식
                        ▼
   POST /api/scan ─> [PP-OCRv6 @ DX-M1 NPU] ─> DX-M1-A7K3P9V2
                        │  신뢰도 90%↑ + S/N 표기 → 화면 정지, 확인
                        ▼
                   [QR 발행]  http://<LAN-IP>:8090/device/DX-M1-A7K3P9V2
                        │  휴대폰으로 촬영
                        ▼
                   [기기 정보 조회]
```

---

## 요구사항

| | |
|---|---|
| **아키텍처** | x86_64 · aarch64 (ARM64) |
| **하드웨어** | DEEPX **DX-M1 NPU**, USB 카메라 |
| **런타임** | **DX-RT** (DEEPX 런타임) |
| **빌드** | CMake 3.14+, C++17 컴파일러, OpenCV 4 |
| **선택** | Node.js 20 — 프론트엔드를 **수정**할 때만. 빌드 산출물이 저장소에 포함되어 있습니다 |

```bash
sudo apt install -y cmake build-essential libopencv-dev v4l-utils
```

DX-RT 는 DEEPX 에서 제공하는 설치 패키지를 따르세요. 표준 경로가 아니면
`DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh` 로 알려주면 됩니다.

`.dxnn` 모델(372MB)은 **저장소에 포함**되어 있습니다. 따로 받을 것이 없습니다.

### 아키텍처에 대해

x86_64 와 aarch64(ARM64) 를 모두 지원합니다. 아키텍처 의존 코드가 없습니다 —
SIMD 인트린식, 인라인 어셈블리, `-march` 플래그를 쓰지 않고, 저장소에 커밋된
바이너리도 모델뿐입니다.

`.dxnn` 모델은 **호스트 CPU 가 아니라 DX-M1 NPU 를 타깃으로** 컴파일된 것이라
아키텍처와 무관하게 그대로 씁니다 (헤더의 `"chip_version": "M1A"`,
`"bytes_order": "little"` — x86_64 와 aarch64 모두 little-endian).

실제로 챙겨야 하는 것은 **해당 아키텍처용 DX-RT 설치** 하나입니다.
표준 경로가 아니면:

```bash
DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh
```

크로스 컴파일은 `-DCROSS_COMPILE=ON -DDXRT_INSTALLED_DIR=...` 로 지원합니다.

> ⚠️ 개발·검증은 x86_64 (Ubuntu 22.04, OpenCV 4.5.4, GCC 11.4) 에서 했습니다.
> aarch64 는 구조상 문제가 없어야 하지만 실측하지 않았습니다.
> ARM 보드에서 돌려 보시면 결과를 알려 주세요.

---

## 빠른 시작

```bash
git clone git@github.com:deepx-mskang/qrcode-from-ocr.git
cd qrcode-from-ocr
./build.sh
./run.sh
```

`build.sh` 는 시작할 때 cmake · OpenCV · DX-RT · 모델 · 카메라를 검사하고,
빠진 것이 있으면 설치 명령과 함께 멈춥니다.

`run.sh` 는 `/dev/video*` 중 **실제로 캡처되는 장치를 자동으로 골라** 실행하고
브라우저를 엽니다. 원하면 직접 지정할 수도 있습니다:

```bash
./run.sh --camera 2            # 인덱스로
./run.sh --device /dev/video2  # 경로로
./run.sh --port 9000 --no-browser
./stop.sh                      # 종료
```

---

## 데모 진행 방법

1. **라벨 준비** — `assets/serial_labels.png` 를 인쇄하거나 휴대폰 화면에 띄웁니다.
2. **비추기** — 가이드 안에 넣기만 하면 됩니다. **버튼을 누를 필요가 없습니다.**
   자동으로 인식되면 화면이 멈추고 번호를 보여 줍니다.
3. **확인** — `맞습니다 · QR 생성 →` (스페이스바). 틀렸으면 `아니요 · 다시 스캔`.
4. **조회** — 휴대폰 기본 카메라로 QR 을 비추면 기기 정보 페이지가 열립니다.
   **휴대폰이 같은 네트워크에 있어야 합니다.**

라벨이 없으면 화면 하단 `라벨 없이 시연하기` 에서 시리얼을 직접 골라 3~4 단계만 시연할 수 있습니다.

---

## 실시간 자동 인식

버튼을 기다리지 않고 카메라를 계속 훑습니다. 아래를 **모두** 만족하면 화면을 멈추고 확인을 받습니다.

**① 신뢰도** 임계값 이상 (기본 **90%**, `--auto-confidence` 로 조정)

**② 시리얼 추출 성공** — `S/N:` 류 표기 뒤에서 값을 잘라냈을 것
(아래 [시리얼 판정 기준](#시리얼-판정-기준) 참고)

응답의 `autoReason` 값:

| 값 | 뜻 |
|---|---|
| `ok` | 잘라냈고 신뢰도도 충분 — 화면을 멈춘다 |
| `low_confidence` | 잘라냈지만 신뢰도가 임계값 미만 |
| `no_serial` | 표기를 찾지 못함 |

**동작 세부**

- **폴링 방식** — 프론트엔드가 `/api/scan` 을 순차 호출합니다(`setInterval` 아님).
  OCR 이 서버에서 직렬화되므로 요청이 겹치면 큐만 쌓입니다.
- **대역폭** — 실시간 폴링은 `?frame=0` 으로 호출해 base64 JPEG(~80KB)를 받지 않습니다.
  서버는 **자동 캡처된 프레임에만** 이미지를 붙입니다.
- **거부한 번호는 건너뜁니다** — `아니요` 를 누르면 그 시리얼을 기억합니다. 라벨을 그대로
  두고 있어도 확인 화면이 반복되지 않습니다. `지금 바로 인식` 을 누르면 기억을 지웁니다.

---

## 시리얼 판정 기준

**규칙은 하나뿐입니다.** 라벨에서 표기를 찾고, **콜론 뒤부터 다음 공백 전까지**를
시리얼로 **그대로** 씁니다. 형태 검사도, 혼동 문자 보정도 하지 않습니다.

```
S/N: DX-M1-A7K3P9V2  REV.C1
     └──────┬──────┘
        여기까지
```

| 입력 | 결과 |
|---|---|
| `S/N: ABC-9981-XYZ` | `ABC-9981-XYZ` |
| `S/N: DX-M1-16716Y  REV.C1` | `DX-M1-16716Y` (공백에서 자름) |
| `Serial: SO-BIG-2024` | `SO-BIG-2024` (`S` `O` `B` `I` 그대로) |
| `序列号：NPU-15674X` | `NPU-15674X` (전각 콜론도 인식) |
| `s/n: dx-m1-c4m8t6hd` | `DX-M1-C4M8T6HD` (대문자화만) |
| `S/N:QR-2025-0001` | `QR-2025-0001` (콜론 뒤 공백 없어도 됨) |
| `DX-M1-H8T4Y2MD` (표기 없음) | **인식 안 됨** |

인식하는 표기 — 대소문자 무시, 콜론 앞 공백 허용, 전각 콜론(`：`) 허용:

| 언어 | 표기 |
|---|---|
| 영문 | `SN:` `S/N:` `S.N:` `SERIAL:` `SERIAL NO:` |
| 한국어 | `시리얼:` `일련번호:` `제품번호:` |
| 중국어 | `序列号:` `序列號:` `序號:` `編號:` |
| 일본어 | `シリアル:` `製造番号:` |

- `SN` 처럼 짧은 표기는 **단어 경계**를 확인해 다른 단어에 묻힌 경우를 걸러냅니다.
- OCR 이 `S/N:` 과 시리얼을 다른 박스로 쪼개면 다음 박스의 첫 토큰을 씁니다.
- 끝에 붙은 `.` `,` `;` `:` 는 떼어 냅니다.

> ⚠️ **라벨에 표기가 없으면 인식되지 않습니다.** 형태만 보고 추측하지 않습니다.
> 시리얼 앞에 `S/N:` 을 반드시 넣으세요. 대신 형태 제약이 전혀 없으므로
> **어떤 형식의 시리얼이든** 적힌 그대로 읽힙니다.

---

## 기기 등록

기기 정보는 **서버가 소유**합니다 (`data/registry.json`). 브라우저 저장소가 아니라 서버에
두는 이유는 QR 을 찍은 **휴대폰이 같은 데이터를 조회**해야 하기 때문입니다.
등록 즉시 반영되며 재빌드가 필요 없습니다.

**시리얼은 유니크합니다.** 중복 등록은 거부됩니다(HTTP 409). 대소문자·앞뒤 공백은
정규화하므로 `dx-m1-a7k3p9v2` 도 같은 기기입니다.

### 등록 경로 두 가지

| 경로 | 진입 | 시리얼 칸 | 나머지 |
|---|---|---|---|
| **사전 등록** | 스캔 화면 `+ 기기 사전 등록` → `/register` | **비어 있음** (자동 포커스) | 예시 프리필 |
| **인식 후 등록** | 미등록 시리얼 → `이 기기 등록하기` → `/register?serial=…` | **인식된 값 자동 입력** | 예시 프리필 |

두 경로 모두 모델·펌웨어·MAC·제조일·보증만료·QA·배치위치가 미리 채워져 있어,
데모 중에는 시리얼만 넣고 바로 등록하면 됩니다. 등록 후 QR 발행 화면으로 넘어갑니다.

### 기기 삭제

헤더의 **`기기 관리`** (`/devices`) 에서 목록 조회·삭제. 삭제는 되돌릴 수 없어
같은 자리에서 한 번 더 확인받습니다. 조회 화면(`/device/…`)에는 삭제 버튼이 없습니다 —
QR 을 찍은 사람이 실수로 지우지 않도록.

CLI 로도 됩니다:

```bash
curl -X DELETE localhost:8090/api/devices/DX-M1-A7K3P9V2
```

### 초기화

레지스트리가 없으면 서버가 `data/seed_devices.json` 으로 자동 생성합니다.

```bash
./stop.sh && rm data/registry.json && ./run.sh
```

기본 8대는 `data/seed_devices.json` 에서 편집합니다.

---

## QR 프린트

QR 발행 화면의 `QR 프린트` 는 화면이 아니라 **기기에 붙일 흑백 라벨**을 인쇄합니다
(88mm 폭, QR 55mm · 시리얼 · 모델명 · URL).

인쇄 라벨은 React 포털로 `#root` **밖**에 붙고, 인쇄 시 `#root` 를 감춰 빈 페이지가
따라 나오지 않게 했습니다. 앱이 다크 테마라 `배경 그래픽` 옵션을 켜도 지면이 새까맣게
나오지 않도록 인쇄 스타일에서 배경을 흰색으로 되돌립니다 (`web/src/index.css`).

---

## API

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/health` | `{"status":"ok","camera":true,"npu":true,"frames":N}` |
| `GET` | `/api/config` | `{"lanBaseUrl":"http://192.168.x.x:8090","port":8090}` |
| `GET` | `/api/stream` | MJPEG (`multipart/x-mixed-replace`) |
| `POST` | `/api/scan` | 최신 프레임 OCR → 시리얼 추출. `?frame=0` 이면 자동 캡처 시에만 이미지 포함 |
| `GET` | `/api/devices` | 등록된 기기 전체 |
| `GET` | `/api/devices/{serial}` | 단건 조회 (미등록 404) |
| `POST` | `/api/devices` | 등록 (201 / 중복 409 / 형식 오류 400) |
| `DELETE` | `/api/devices/{serial}` | 등록 취소 |
| `GET` | `/*` | `web/dist` 정적 서빙, 404 는 `index.html` 폴백 (SPA) |

`/api/scan` 응답:

```json
{
  "ok": true,
  "serial": "DX-M1-A7K3P9V2",
  "confidence": 0.9961,
  "candidates": [
    { "text": "DX-M1-A7K3P9V2", "rawText": "S/N: DX-M1-A7K3P9V2",
      "prefix": "S/N", "score": 0.9961 }
  ],
  "rawTexts": ["DEEPX", "S/N: DX-M1-A7K3P9V2", "DX-M1 NPU MODULE"],
  "perf": { "detMs": 150.2, "recMs": 13.1, "e2eMs": 177.8, "numBoxes": 3,
            "numCrops": 3, "totalChars": 39, "cps": 198.7 },
  "autoCapture": true,
  "autoReason": "ok",
  "autoConfidence": 0.90,
  "frame": "<base64 jpeg>"
}
```

**QR 주소는 `/api/config` 의 `lanBaseUrl` 을 씁니다.** 프론트가 `window.location.origin`
을 쓰면 `localhost` 로 열었을 때 만들어진 QR 을 휴대폰이 열 수 없기 때문에, 서버가
`getifaddrs()` 로 찾은 LAN 주소를 알려줍니다.

---

## 구조

```
qrcode-from-ocr/
├── build.sh / run.sh / stop.sh
├── cpp/
│   ├── serial_ocr_server.cpp     카메라(V4L2) + MJPEG + OCR + 정적 서빙
│   ├── device_registry.{hpp,cpp} JSON 파일 기반 기기 레지스트리
│   ├── ocr_engine.{hpp,cpp}      PP-OCRv6 추론 (DEEPX dx-demos 에서 가져옴)
│   └── third_party/              cpp-httplib, nlohmann/json
├── web/                          Vite + React + TypeScript + Tailwind
│   └── dist/                     ★ 빌드 산출물도 커밋 — Node 없이 실행 가능
├── models/                       .dxnn 8개 + 사전 (372MB)
├── data/seed_devices.json        기본 기기 8대
└── assets/serial_labels.png      인쇄용 라벨 시트 (A4, 300dpi)
```

브라우저 카메라(`getUserMedia`)를 쓰지 않고 서버가 카메라를 잡아 MJPEG 으로 흘려보내므로
**HTTPS 설정이 필요 없습니다.**

---

## 개발

```bash
# 터미널 1 — C++ 서버
./run.sh --no-browser

# 터미널 2 — Vite 개발 서버 (:5173, /api 는 8090 으로 프록시)
cd web && npm run dev
```

### 카메라 없이 OCR 만 검증

```bash
./cpp/build/serial_ocr_server --test-image assets/serial_labels.png
```

이미지 1장으로 OCR 을 돌리고 `/api/scan` 과 같은 JSON 을 출력한 뒤 종료합니다.
표기 인식이나 잘라내기 규칙을 손볼 때 쓰세요. 전체 옵션은 `--help`.

---

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 카메라 화면이 안 나옴 | `v4l2-ctl --list-devices` 로 장치 확인. 포맷 목록이 나오는 노드가 캡처 노드입니다. `./run.sh --device /dev/videoN` |
| 휴대폰에서 QR 이 안 열림 | ① 같은 네트워크인지 ② 로그의 `LAN base URL` 이 `localhost` 가 아닌지 ③ 방화벽이 포트를 막는지. QR 아래 URL 을 직접 입력해도 됩니다 |
| 자동으로 안 멈춤 | 화면 안내를 보세요. `신뢰도 87% — 임계값 90% 미만` 이면 라벨을 더 가까이. 안 되면 `지금 바로 인식` |
| 같은 번호가 계속 뜸 | `아니요` 를 누르면 건너뜁니다. 라벨을 치우거나 다른 라벨을 비추세요 |
| 아무것도 인식 안 됨 | 라벨에 `S/N:` 표기가 있는지 확인. 표기가 없으면 인식하지 않습니다 |
| `DX-RT 없음` | DX-RT 설치 후 `DXRT_INSTALLED_DIR=/path ./build.sh` |
| 모델 로딩 실패 | `ls models/*.dxnn` 가 8개인지 확인. 부족하면 다시 clone |

---

## 라이선스

번들된 서드파티 구성요소는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 참고.
