# qrcode-from-ocr

一个网页演示：**用摄像头识别序列号 → 生成二维码 → 扫码查询设备信息**。

OCR 采用 PP-OCRv6，运行于 **DEEPX DX-M1 NPU**：检测约 150 ms，识别约 13 ms。

[🇰🇷 한국어](README.md) · [🇺🇸 English](README.en.md) · 🇨🇳 中文

```
[摄像头] ──MJPEG──> [浏览器]
                        │  实时自动识别
                        ▼
   POST /api/scan ─> [PP-OCRv6 @ DX-M1 NPU] ─> DX-M1-A7K3P9V2
                        │  置信度 ≥90% + 序列号标记 → 画面冻结并确认
                        ▼
                    [生成二维码]  http://<LAN-IP>:8090/device/DX-M1-A7K3P9V2
                        │  用手机扫码
                        ▼
                    [设备信息查询]
```

---

## 环境要求

| | |
|---|---|
| **架构** | x86_64 · aarch64 (ARM64) |
| **硬件** | DEEPX **DX-M1 NPU**、USB 摄像头 |
| **运行时** | **DX-RT**（DEEPX 运行时） |
| **构建** | CMake 3.14+、支持 C++17 的编译器、OpenCV 4 |
| **可选** | Node.js 20 — 仅在**修改**前端时需要，构建产物已提交到仓库 |

```bash
sudo apt install -y cmake build-essential libopencv-dev v4l-utils
```

请按 DEEPX 提供的安装包安装 DX-RT。若不在标准路径，可指定：
`DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh`。

`.dxnn` 模型（372 MB）**已包含在本仓库中**，无需另行下载。

### 关于架构

x86_64 与 aarch64（ARM64）均受支持。代码中没有任何架构相关实现 —— 不使用 SIMD
内建函数、内联汇编或 `-march` 标志，仓库中提交的二进制文件也只有模型本身。

`.dxnn` 模型是针对 **DX-M1 NPU 而非宿主 CPU** 编译的，因此与架构无关
（文件头为 `"chip_version": "M1A"`、`"bytes_order": "little"` —— x86_64 与
aarch64 都是小端）。

真正需要与架构匹配的只有 **DX-RT 的安装**。若不在标准路径：

```bash
DXRT_INSTALLED_DIR=/path/to/dxrt ./build.sh
```

交叉编译可通过 `-DCROSS_COMPILE=ON -DDXRT_INSTALLED_DIR=...` 进行。

> ⚠️ 开发与验证在 x86_64（Ubuntu 22.04、OpenCV 4.5.4、GCC 11.4）上完成。
> aarch64 在结构上应当可用，但尚未实测。若您在 ARM 板上运行，欢迎反馈结果。

---

## 快速开始

```bash
git clone git@github.com:deepx-mskang/qrcode-from-ocr.git
cd qrcode-from-ocr
./build.sh
./run.sh
```

`build.sh` 会先检查 cmake、OpenCV、DX-RT、模型和摄像头，缺少任何一项都会给出
具体的安装命令并停止。

`run.sh` 会**自动挑选真正能采集画面的 `/dev/video*` 节点**并打开浏览器。也可手动指定：

```bash
./run.sh --camera 2            # 按索引
./run.sh --device /dev/video2  # 按路径
./run.sh --port 9000 --no-browser
./stop.sh                      # 停止
```

---

## 演示步骤

1. **准备标签** — 打印 `assets/serial_labels.png`，或在手机屏幕上显示。
2. **对准摄像头** — 把标签放进取景框即可，**无需点击任何按钮**。
   识别成功后画面会自动冻结并显示号码。
3. **确认** — 点击 `맞습니다 · QR 생성 →`（或按空格键）。识别有误则点 `아니요 · 다시 스캔`。
4. **查询** — 用手机自带相机扫描二维码，即可打开设备信息页。
   **手机需与演示主机处于同一网络。**

没有标签时，可在扫描页底部的 `라벨 없이 시연하기` 中直接选择序列号，只演示第 3–4 步。

---

## 实时自动识别

扫描页不等待按钮，而是持续扫描摄像头画面。**同时满足**以下两个条件时冻结画面并请求确认：

**① 置信度** 达到阈值（默认 **90%**，可用 `--auto-confidence` 调整）

**② 依据** 三者之一：

| `autoReason` | 含义 |
|---|---|
| `keyword_same_box` | 序列号**同一行**存在标记 — 依据最强 |
| `keyword` | 画面中任意位置存在标记 |
| `strict_format` | 无标记，但符合标准格式 `DX-M1-XXXXXXXX` |

可识别的序列号标记：

| 语言 | 标记 |
|---|---|
| 英文 | `S/N` `S.N` `SN` `SERIAL` `SERIAL NO` |
| 韩文 | `시리얼` `일련번호` `제품번호` |
| 中文 | `序列号` `序列號` `序號` `編號` |
| 日文 | `シリアル` `製造番号` |

`SN` 这类短标记会检查**单词边界**，避免匹配到其他单词内部。标记检测在 OCR **原文**上
进行，因为归一化会把 `S/N` 变成 `S-N`。

**实现细节**

- **轮询方式** — 前端顺序调用 `/api/scan`（并非 `setInterval`）。
  OCR 在服务端串行执行，请求重叠只会堆积队列。
- **FPS 显示** — 最近 10 次扫描的平均值（通常 3~4 fps）。冻结在确认页的时间不计入。
- **带宽** — 实时轮询使用 `?frame=0`，不传输约 80 KB 的 base64 JPEG。
  服务端**仅在触发自动捕获的那一帧**附带图像。
- **已否决的号码会跳过** — 点击 `아니요` 后会记住该序列号，因此标签仍在镜头前时
  确认页不会反复弹出。点击 `지금 바로 인식` 可清除记录。

---

## 序列号判定规则

**归一化** — 字母数字转为大写，其余字符（空格、`:` `/` `.` `_`）折叠为一个 `-`。
折叠而非删除是为了保留词元边界（`S/N: DX-M1-A7K3P9V2` → `SN-DX-M1-A7K3P9V2`），
顺带还能还原 OCR 把连字符读成空格的 `DX M1 A7K3P9V2`。

**搜索** — 采用**子串搜索**而非整串匹配，因此序列号前后夹杂其他文字时仍能找到。

| 优先级 | 模式 | 条件 |
|---|---|---|
| 0 | `DX-?M1-?([A-Z0-9]{8})` | 标准格式 |
| 1 | `([A-Z]{2,4})-?([A-Z0-9]{6,12})` | 通用形态 + 主体含 ≥3 个数字 |
| 2 | 将优先级 0 应用于**所有文本框拼接后的字符串** | 序列号被拆分到多个框 |
| 3 | `DX-?M1-?([A-Z0-9]{5,12})` + ≥2 个数字 | 位数不符；仅在 0~2 全部失败时 |

匹配不得从字母数字中间开始或结束。数字数量的限制可防止说明文字被误判为序列号
（`S/N: DX-M1 NPU MODULE` 不会匹配任何一条）。

> **序列号命名规则** — 主体中请勿使用 `O Q I L S B Z`。服务端会将 OCR 易混淆字符
> 纠正为数字（`O→0`、`I→1`、`S→5` …），若正确答案本身含这些字母，反而会被破坏。

---

## 设备注册

设备信息由**服务端持有**（`data/registry.json`），而非浏览器 —— 因为扫码的**手机
必须看到同一份数据**。注册后立即生效，无需重新构建。

**序列号唯一。** 重复注册会被拒绝（HTTP 409）。大小写与首尾空格会归一化，
因此 `dx-m1-a7k3p9v2` 视为同一台设备。

### 两种注册入口

| 入口 | 进入方式 | 序列号栏 | 其余字段 |
|---|---|---|---|
| **预先注册** | 扫描页 `+ 기기 사전 등록` → `/register` | **留空**，自动聚焦 | 预填示例值 |
| **识别后注册** | 未注册序列号 → `이 기기 등록하기` → `/register?serial=…` | **自动填入**识别结果 | 预填示例值 |

两种入口都会预填型号、固件、MAC、生产日期、保修期、QA 状态和部署位置，
演示时只需输入序列号即可提交。注册完成后直接进入二维码页面。

### 删除设备

顶部的 **`기기 관리`**（`/devices`）可查看列表并删除。删除不可撤销，因此会在原处
再次确认。查询页（`/device/…`）**没有**删除按钮 —— 那是手机扫码后打开的页面，
不应让查看者误删数据。

```bash
curl -X DELETE localhost:8090/api/devices/DX-M1-A7K3P9V2
```

### 重置

注册表文件不存在时，服务端会用 `data/seed_devices.json` 自动生成。

```bash
./stop.sh && rm data/registry.json && ./run.sh
```

---

## 打印二维码标签

二维码页面的 `QR 프린트` 打印的不是网页截图，而是**可贴在设备上的黑白标签**
（宽 88 mm：55 mm 二维码、序列号、型号、URL）。

标签通过 React portal 挂载在 `#root` **之外**，打印时隐藏 `#root`，因此不会多出空白页。
由于应用是深色主题，打印样式会强制白色背景 —— 否则勾选"背景图形"会让整页糊满墨水
（`web/src/index.css`）。

---

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | `{"status":"ok","camera":true,"npu":true,"frames":N}` |
| `GET` | `/api/config` | `{"lanBaseUrl":"http://192.168.x.x:8090","port":8090}` |
| `GET` | `/api/stream` | MJPEG（`multipart/x-mixed-replace`） |
| `POST` | `/api/scan` | 对最新帧执行 OCR。`?frame=0` 时仅在自动捕获时附带图像 |
| `GET` | `/api/devices` | 全部已注册设备 |
| `GET` | `/api/devices/{serial}` | 单台查询（未注册返回 404） |
| `POST` | `/api/devices` | 注册（201 / 重复 409 / 格式错误 400） |
| `DELETE` | `/api/devices/{serial}` | 取消注册 |
| `GET` | `/*` | 静态服务 `web/dist`，404 回退到 `index.html`（SPA） |

**二维码使用 `/api/config` 中的 `lanBaseUrl`。** 若前端使用 `window.location.origin`，
在 `localhost` 下生成的二维码手机将无法打开，因此由服务端通过 `getifaddrs()`
查找并告知局域网地址。

---

## 目录结构

```
qrcode-from-ocr/
├── build.sh / run.sh / stop.sh
├── cpp/
│   ├── serial_ocr_server.cpp     摄像头(V4L2) + MJPEG + OCR + 静态服务
│   ├── device_registry.{hpp,cpp} 基于 JSON 文件的设备注册表
│   ├── ocr_engine.{hpp,cpp}      PP-OCRv6 推理（取自 DEEPX dx-demos）
│   └── third_party/              cpp-httplib、nlohmann/json
├── web/                          Vite + React + TypeScript + Tailwind
│   └── dist/                     ★ 构建产物已提交 —— 无需 Node 即可运行
├── models/                       8 个 .dxnn + 字典（372 MB）
├── data/seed_devices.json        8 台种子设备
└── assets/serial_labels.png      可打印标签页（A4，300 dpi）
```

不使用浏览器摄像头 API（`getUserMedia`），而由服务端持有摄像头并推送 MJPEG，
因此**无需配置 HTTPS**。

---

## 开发

```bash
# 终端 1 — C++ 服务端
./run.sh --no-browser

# 终端 2 — Vite 开发服务器（:5173，/api 代理到 8090）
cd web && npm run dev
```

### 无摄像头时验证 OCR

```bash
./cpp/build/serial_ocr_server --test-image assets/serial_labels.png
```

对单张图片执行 OCR，输出与 `/api/scan` 相同的 JSON 后退出 —— 调整序列号正则或
易混淆字符规则时很有用。完整参数见 `--help`。

---

## 故障排查

| 现象 | 检查项 |
|---|---|
| 没有摄像头画面 | `v4l2-ctl --list-devices`。能列出格式的节点才是采集节点，然后 `./run.sh --device /dev/videoN` |
| 手机打不开二维码 | ① 是否同一网络 ② 日志中 `LAN base URL` 是否为 `localhost` ③ 防火墙是否拦截端口。也可手动输入二维码下方的 URL |
| 始终不自动冻结 | 查看页面提示。显示 `신뢰도 87% — 임계값 90% 미만` 说明需把标签靠近；仍不行就用 `지금 바로 인식` |
| 反复出现同一号码 | 点 `아니요` 即会跳过，然后移开标签 |
| 识别出错误字符 | 检查序列号中是否含 `O Q I L S B Z`（见命名规则） |
| `DX-RT 없음` | 安装 DX-RT 后执行 `DXRT_INSTALLED_DIR=/path ./build.sh` |
| 模型加载失败 | `ls models/*.dxnn` 应有 8 个文件，不足请重新 clone |

---

## 许可

捆绑的第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
