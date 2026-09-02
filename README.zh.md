# qrcode-from-ocr

一个网页演示：**用摄像头识别序列号 → 生成二维码 → 扫码查询设备信息**。

OCR 采用 PP-OCRv6，运行于 **DEEPX DX-M1 NPU**。

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

x86_64 与 aarch64（ARM64）均受支持。

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

**摄像头由服务端自动查找。** 它按编号依次打开 `/dev/video*`，采用第一个**真正能
取到画面**的设备，因此没有 `video0`、或 `video0` 并非采集节点的机器同样可用。

```bash
./run.sh                       # 自动探测
./run.sh --list-cameras        # 查看哪些设备可用（立即返回）
./run.sh --camera 2            # 按索引指定
./run.sh --device /dev/video2  # 按路径指定
./run.sh --port 9000 --no-browser
./stop.sh                      # 停止
```

`--list-cameras` 不加载 NPU 模型，1 秒内完成：

```
Probing 2 camera candidate(s) by actually grabbing a frame:
  OK   /dev/video2  1280x720
       /dev/video3  opens but delivers no frames (likely a metadata node)
```

---

## 演示步骤

1. **准备标签** — 打印 `assets/serial_labels.png`，或在手机屏幕上显示。
2. **对准摄像头** — 把标签放进取景框即可，**无需点击任何按钮**。
   识别成功后画面会自动冻结并显示号码。
3. **确认** — 点击 `正确 · 生成二维码 →`（或按空格键）。识别有误则点 `不对 · 重新扫描`。
4. **查询** — 用手机自带相机扫描二维码，即可打开设备信息页。
   **手机需与演示主机处于同一网络。**

没有标签时，可在扫描页底部的 `无标签演示` 中直接选择序列号，只演示第 3–4 步。

## 界面语言

右上角的 **`KO` / `EN` / `中`** 按钮可在韩语、英语、中文之间切换。选择会保存在浏览器中，
重新打开仍然有效；首次访问时按浏览器语言判断（`zh*` → 中文，`en*` → 英语，其余为韩语）。

---

## 实时自动识别

扫描页不等待按钮，而是持续扫描摄像头画面。**同时满足**以下两个条件时冻结画面并请求确认：

**① 置信度** 达到阈值（默认 **90%**，可用 `--auto-confidence` 调整）

**② 成功提取序列号** —— 从 `S/N:` 之类的标记之后截取到了值
（见[序列号判定规则](#序列号判定规则)）

---

## 序列号判定规则

**规则只有一条。** 在标签上找到标记，取**冒号之后、直到下一个空格为止**的内容，
**原样**作为序列号。不做形态检查，也不做易混淆字符纠正。

```
S/N: DX-M1-A7K3P9V2  REV.C1
     └──────┬──────┘
         取这一段
```

可识别的标记 —— 忽略大小写，冒号前可有空格，支持全角冒号（`：`）：

| 语言 | 标记 |
|---|---|
| 英文 | `SN:` `S/N:` `S.N:` `SERIAL:` `SERIAL NO:` |
| 中文 | 简体 `序列号:` `序号:` · 繁体 `序列號:` `序號:` |

### 验证结果

以下为在实际 **DX-M1 NPU** 上的推理结果。复现方式：
`./cpp/build/serial_ocr_server --test-image <图片>`。

**规则行为**

| 输入（标签上印刷的字符串） | 识别结果 | 置信度 | 标记 |
|---|---|---|---|
| `SN: DX-M1-A7K3P9V2` | `DX-M1-A7K3P9V2` | 0.9913 | `SN` |
| `S/N: ABC-9981-XYZ` | `ABC-9981-XYZ` | 0.9762 | `S/N` |
| `序列号：NPU-15674X` | `NPU-15674X` | 0.9921 | `序列号` |
| `编号：NPU-15674X` | `NPU-15674X` | 0.9999 | `编号(X)` |
| `Serial: SO-BIG-2024` | `SO-BIG-2024` | 0.9775 | `SERIAL` |
| `S/N: DX-M1-16716Y  REV.C1` | `DX-M1-16716Y` | 0.9856 | `S/N` |
| `s/n: dx-m1-c4m8t6hd` | `DX-M1-C4M8T6HD` | 0.9776 | `S/N` |
| `S/N:QR-2025-0001` | `QR-2025-0001` | 0.9999 | `S/N` |
| `S/N: DX-M1 NPU MODULE` | `DX-M1` | 0.9741 | `S/N` |
| `DX-M1-H8T4Y2MD`（无标记） | —（`no_serial`） | — | — |

要点：

- `Serial: SO-BIG-2024` 的 **`SO-BIG` 被完整保留**。旧实现会因易混淆字符纠正
  而破坏为 `50-81G` —— 这正是更换规则的原因。
- 同一行尾部的 `REV.C1` 会**在空格处截断**。
- 全角冒号（`：`）、小写输入、冒号后无空格均可处理。
- 最后两行是**预期行为**：`S/N:` 之后的首个词元就是 `DX-M1`；没有标记时不作猜测。

**随附标签页（`assets/serial_labels.png`）8 张**

| | |
|---|---|
| 准确率 | **8 / 8** |
| 置信度 | 0.9947 ~ 0.9991 |
| 检测 | 平均 149.6 ms |
| 识别 | 平均 11.4 ms |
| 端到端 | 平均 188.2 ms |

测试环境：x86_64、Ubuntu 22.04、OpenCV 4.5.4、GCC 11.4、DX-M1 (M1A)。


---

## 设备注册

设备信息由**服务端持有**（`data/registry.json`），而非浏览器 —— 因为扫码的**手机
必须看到同一份数据**。注册后立即生效，无需重新构建。

**序列号唯一。** 重复注册会被拒绝（HTTP 409）。大小写与首尾空格会归一化，
因此 `dx-m1-a7k3p9v2` 视为同一台设备。

### 两种注册入口

| 入口 | 进入方式 | 序列号栏 | 其余字段 |
|---|---|---|---|
| **预先注册** | 扫描页 `+ 预先注册设备` → `/register` | **留空**，自动聚焦 | 预填示例值 |
| **识别后注册** | 未注册序列号 → `注册此设备` → `/register?serial=…` | **自动填入**识别结果 | 预填示例值 |

两种入口都会预填型号、固件、MAC、生产日期、保修期、QA 状态和部署位置，
演示时只需输入序列号即可提交。注册完成后直接进入二维码页面。

### 删除设备

顶部的 **`设备管理`**（`/devices`）可查看列表并删除。删除不可撤销，因此会在原处
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

二维码页面的 `打印二维码` 打印的不是网页截图，而是**可贴在设备上的黑白标签**
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
│   ├── src/i18n/index.tsx        韩/英/中 词典（无依赖）
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
标记识别或截断规则时很有用。完整参数见 `--help`。

---

## 故障排查

| 现象 | 检查项 |
|---|---|
| 页面错乱或没有摄像头画面 | 重新构建后浏览器仍缓存旧包所致。服务端现已对 `index.html` 返回 `no-store`。若仍异常，请 `Ctrl+Shift+R` |
| 没有摄像头画面 | 先用 `./run.sh --list-cameras` 查看可用设备，再 `./run.sh --device /dev/videoN`。若全部失败，请检查连接与权限（`id -nG \| grep video`） |
| 手机打不开二维码 | ① 是否同一网络 ② 日志中 `LAN base URL` 是否为 `localhost` ③ 防火墙是否拦截端口。也可手动输入二维码下方的 URL |
| 始终不自动冻结 | 查看页面提示。显示 `置信度 87% —— 低于阈值 90%` 说明需把标签靠近；仍不行就用 `立即识别（空格键）` |
| 反复出现同一号码 | 点 `不对 · 重新扫描` 即会跳过，然后移开标签 |
| 完全无法识别 | 检查标签上是否有 `S/N:` 标记；没有标记则不会识别 |
| `DX-RT not found` | 安装 DX-RT 后执行 `DXRT_INSTALLED_DIR=/path ./build.sh` |
| 模型加载失败 | `ls models/*.dxnn` 应有 8 个文件，不足请重新 clone |

---

## 许可

捆绑的第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
