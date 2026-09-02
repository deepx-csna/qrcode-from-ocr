// DEEPX Serial-QR 데모 서버
//
// apps/paddle-ocr 의 PP-OCRv6 엔진(camocr::PaddleOcrEngine)을 그대로 재사용하되,
// Qt GUI 대신 HTTP 서버로 감싼다.
//
//   - 카메라는 서버가 V4L2 로 직접 잡고 MJPEG 로 브라우저에 스트리밍한다.
//     (브라우저 getUserMedia 를 쓰지 않으므로 HTTPS 가 필요 없다)
//   - POST /api/scan 이 오면 최신 프레임을 복사해 OCR 을 돌리고
//     인식된 텍스트에서 시리얼 번호를 추출해 JSON 으로 돌려준다.

#define CPPHTTPLIB_THREAD_POOL_COUNT 16

#include "device_registry.hpp"
#include "httplib.h"
#include "ocr_engine.hpp"

#include <opencv2/opencv.hpp>

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netdb.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace {

// ---------------------------------------------------------------------------
// 최소 JSON 직렬화
// ---------------------------------------------------------------------------

std::string jsonEscape(const std::string& s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (const unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out += static_cast<char>(c);
            }
        }
    }
    return out;
}

std::string jsonStr(const std::string& s)
{
    return "\"" + jsonEscape(s) + "\"";
}

std::string jsonNum(double v, int precision = 2)
{
    std::ostringstream oss;
    oss.setf(std::ios::fixed);
    oss.precision(precision);
    oss << v;
    return oss.str();
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

std::string base64Encode(const std::vector<unsigned char>& data)
{
    static constexpr char kTable[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string out;
    out.reserve(((data.size() + 2) / 3) * 4);

    std::size_t i = 0;
    for (; i + 2 < data.size(); i += 3) {
        const std::uint32_t v = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        out += kTable[(v >> 18) & 0x3F];
        out += kTable[(v >> 12) & 0x3F];
        out += kTable[(v >> 6) & 0x3F];
        out += kTable[v & 0x3F];
    }
    if (i + 1 == data.size()) {
        const std::uint32_t v = data[i] << 16;
        out += kTable[(v >> 18) & 0x3F];
        out += kTable[(v >> 12) & 0x3F];
        out += "==";
    } else if (i + 2 == data.size()) {
        const std::uint32_t v = (data[i] << 16) | (data[i + 1] << 8);
        out += kTable[(v >> 18) & 0x3F];
        out += kTable[(v >> 12) & 0x3F];
        out += kTable[(v >> 6) & 0x3F];
        out += "=";
    }
    return out;
}

// ---------------------------------------------------------------------------
// LAN IP 탐색
//
// QR 에 넣을 주소는 반드시 휴대폰이 접근 가능한 LAN 주소여야 한다.
// 프론트가 window.location.origin 을 쓰면 데모 PC 에서 localhost 로 열었을 때
// QR 이 휴대폰에서 열리지 않으므로, 서버가 직접 알려준다.
// ---------------------------------------------------------------------------

std::string detectLanIPv4()
{
    struct ifaddrs* ifaddr = nullptr;
    if (getifaddrs(&ifaddr) == -1) {
        return {};
    }

    std::string fallback;
    std::string preferred;

    for (struct ifaddrs* ifa = ifaddr; ifa != nullptr; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr == nullptr || ifa->ifa_addr->sa_family != AF_INET) {
            continue;
        }
        if ((ifa->ifa_flags & IFF_UP) == 0 || (ifa->ifa_flags & IFF_LOOPBACK) != 0) {
            continue;
        }

        char host[NI_MAXHOST] = {0};
        auto* addr = reinterpret_cast<struct sockaddr_in*>(ifa->ifa_addr);
        if (!inet_ntop(AF_INET, &addr->sin_addr, host, sizeof(host))) {
            continue;
        }

        const std::string ip = host;
        const std::string name = ifa->ifa_name ? ifa->ifa_name : "";

        // docker/virbr 같은 가상 브릿지는 휴대폰에서 접근 불가하므로 뒤로 미룬다.
        const bool virtualIface = name.rfind("docker", 0) == 0 || name.rfind("virbr", 0) == 0 ||
                                  name.rfind("br-", 0) == 0 || name.rfind("veth", 0) == 0;
        if (virtualIface) {
            if (fallback.empty()) {
                fallback = ip;
            }
            continue;
        }
        if (preferred.empty()) {
            preferred = ip;
        }
    }

    freeifaddrs(ifaddr);
    return !preferred.empty() ? preferred : fallback;
}

// ---------------------------------------------------------------------------
// 시리얼 추출
//
// 규칙은 하나뿐이다.
//   라벨에서 "S/N" / "SN" / "SERIAL" / "序列号" 같은 표기를 찾고,
//   콜론(:) 뒤부터 다음 공백 전까지를 시리얼로 그대로 쓴다.
//
// 형태 검사도, 혼동 문자 보정도 하지 않는다. 라벨에 적힌 그대로가 정답이다.
// ---------------------------------------------------------------------------

struct SerialCandidate {
    std::string text;     ///< 잘라낸 시리얼 (대문자)
    std::string rawText;  ///< 잘라낸 원본 OCR 텍스트
    std::string prefix;   ///< 매칭된 표기 ("S/N", "序列号" …)
    double score = 0.0;
};

// ASCII 만 대문자로 올린다. UTF-8 멀티바이트(한글/중국어)는 건드리지 않는다.
std::string upperAscii(const std::string& in)
{
    std::string out = in;
    for (char& c : out) {
        const auto uc = static_cast<unsigned char>(c);
        if (uc < 0x80) {
            c = static_cast<char>(std::toupper(uc));
        }
    }
    return out;
}

// 표기 뒤 콜론까지 건너뛴 위치를 돌려준다. 콜론이 없으면 npos.
// 전각 콜론(U+FF1A, "：")도 받는다. 중국어 라벨에서 흔하다.
std::size_t skipToAfterColon(const std::string& s, std::size_t pos)
{
    while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t')) {
        ++pos;
    }
    if (pos < s.size() && s[pos] == ':') {
        return pos + 1;
    }
    // "：" == EF BC 9A
    if (pos + 2 < s.size() && static_cast<unsigned char>(s[pos]) == 0xEF &&
        static_cast<unsigned char>(s[pos + 1]) == 0xBC &&
        static_cast<unsigned char>(s[pos + 2]) == 0x9A) {
        return pos + 3;
    }
    return std::string::npos;
}

// pos 부터 공백 전까지의 토큰. 시리얼에 올 수 없는 끝 문장부호는 떼어 낸다.
std::string tokenAt(const std::string& s, std::size_t pos)
{
    const auto isSpace = [](char c) {
        return c == ' ' || c == '\t' || c == '\n' || c == '\r';
    };
    while (pos < s.size() && isSpace(s[pos])) {
        ++pos;
    }
    std::size_t end = pos;
    while (end < s.size() && !isSpace(s[end])) {
        ++end;
    }
    std::string token = s.substr(pos, end - pos);
    while (!token.empty() && (token.back() == '.' || token.back() == ',' ||
                              token.back() == ';' || token.back() == ':')) {
        token.pop_back();
    }
    return token;
}

/// texts[i] 에서 "표기:" 를 찾아 그 뒤 토큰을 뽑는다.
/// 표기 박스가 콜론에서 끝나면 texts[i+1] 의 첫 토큰을 쓴다
/// (OCR 이 "S/N:" 과 시리얼을 다른 박스로 쪼개는 경우).
bool extractAfterPrefix(const std::vector<camocr::OcrText>& texts,
                        std::size_t i,
                        SerialCandidate* out)
{
    // ASCII 는 대문자로 올려 비교하므로 여기서도 대문자로 적는다.
    // 긴 표기를 먼저 둬야 "SERIAL NO" 가 "SERIAL" 에 먹히지 않는다.
    static const char* kAsciiPrefixes[] = {"SERIAL NO", "SERIAL", "S/N", "S.N", "SN"};
    static const char* kUnicodePrefixes[] = {
        "序列号", "序列號", "序號", "編號",
        "시리얼", "일련번호", "제품번호",
        "シリアル", "製造番号",
    };

    const std::string& raw = texts[i].text;
    const std::string upper = upperAscii(raw);

    std::size_t bestPos = std::string::npos;
    std::size_t afterColon = std::string::npos;
    std::string matched;

    const auto consider = [&](const std::string& hay, const char* kw, bool checkBoundary) {
        const std::size_t len = std::strlen(kw);
        std::size_t pos = hay.find(kw);
        while (pos != std::string::npos) {
            const std::size_t after = skipToAfterColon(hay, pos + len);
            // "SN" 처럼 짧은 ASCII 표기가 다른 단어에 묻힌 경우를 걸러낸다.
            const bool boundaryOk =
                !checkBoundary || pos == 0 ||
                std::isalnum(static_cast<unsigned char>(hay[pos - 1])) == 0;
            if (after != std::string::npos && boundaryOk && pos < bestPos) {
                bestPos = pos;
                afterColon = after;
                matched = kw;
            }
            pos = hay.find(kw, pos + 1);
        }
    };

    for (const char* kw : kAsciiPrefixes) {
        consider(upper, kw, true);
    }
    for (const char* kw : kUnicodePrefixes) {
        consider(raw, kw, false);
    }

    if (afterColon == std::string::npos) {
        return false;
    }

    std::string token = tokenAt(raw, afterColon);
    std::string source = raw;

    // 표기 박스가 콜론에서 끝났으면 다음 박스의 첫 토큰을 가져온다.
    if (token.empty() && i + 1 < texts.size()) {
        token = tokenAt(texts[i + 1].text, 0);
        source = texts[i + 1].text;
    }
    if (token.empty()) {
        return false;
    }

    out->text = upperAscii(token);
    out->rawText = source;
    out->prefix = matched;
    out->score = texts[i].score;
    return true;
}

std::vector<SerialCandidate> extractSerials(const std::vector<camocr::OcrText>& texts)
{
    std::vector<SerialCandidate> out;

    for (std::size_t i = 0; i < texts.size(); ++i) {
        SerialCandidate c;
        if (!extractAfterPrefix(texts, i, &c)) {
            continue;
        }
        const bool dup = std::any_of(out.begin(), out.end(), [&](const SerialCandidate& u) {
            return u.text == c.text;
        });
        if (!dup) {
            out.push_back(std::move(c));
        }
    }

    // 같은 시리얼이 여러 박스에서 잡히면 점수가 높은 쪽을 앞으로.
    std::stable_sort(out.begin(), out.end(),
                     [](const SerialCandidate& a, const SerialCandidate& b) {
                         return a.score > b.score;
                     });
    return out;
}

// OCR 결과에서 시리얼과 자동 캡처 판정을 뽑아낸다.
struct ScanAnalysis {
    std::vector<SerialCandidate> candidates;
    bool autoCapture = false;
    std::string autoReason = "none";
    double autoConfidence = 0.90;
};

ScanAnalysis analyzeScan(const camocr::OcrResult& result, double autoConfidence)
{
    ScanAnalysis a;
    a.autoConfidence = autoConfidence;
    a.candidates = extractSerials(result.texts);

    // 실시간 모드에서 화면을 멈출지 결정한다.
    // 표기 뒤에서 잘라냈다는 것 자체가 충분한 근거이므로, 남은 조건은 신뢰도뿐이다.
    if (a.candidates.empty()) {
        a.autoReason = "no_serial";
    } else if (a.candidates.front().score < autoConfidence) {
        a.autoReason = "low_confidence";
    } else {
        a.autoCapture = true;
        a.autoReason = "ok";
    }
    return a;
}

// 분석 결과를 스캔 응답 JSON 으로 만든다.
// HTTP 핸들러와 --test-image 경로가 같은 포맷을 쓰도록 한 곳에 모아 둔다.
std::string buildScanJson(const camocr::OcrResult& result,
                          const ScanAnalysis& a,
                          const std::string& frameB64)
{
    const auto& candidates = a.candidates;

    std::ostringstream oss;
    oss << "{";
    oss << "\"ok\":" << (candidates.empty() ? "false" : "true");
    if (candidates.empty()) {
        oss << ",\"reason\":\"no_serial_found\"";
        oss << ",\"serial\":null,\"confidence\":0";
    } else {
        oss << ",\"serial\":" << jsonStr(candidates.front().text);
        oss << ",\"confidence\":" << jsonNum(candidates.front().score, 4);
    }

    oss << ",\"candidates\":[";
    for (std::size_t i = 0; i < candidates.size(); ++i) {
        const auto& c = candidates[i];
        if (i > 0) {
            oss << ",";
        }
        oss << "{\"text\":" << jsonStr(c.text) << ",\"rawText\":" << jsonStr(c.rawText)
            << ",\"prefix\":" << jsonStr(c.prefix)
            << ",\"score\":" << jsonNum(c.score, 4) << "}";
    }
    oss << "]";

    oss << ",\"rawTexts\":[";
    for (std::size_t i = 0; i < result.texts.size(); ++i) {
        if (i > 0) {
            oss << ",";
        }
        oss << jsonStr(result.texts[i].text);
    }
    oss << "]";

    oss << ",\"perf\":{"
        << "\"detMs\":" << jsonNum(result.perf.detTimeMs)
        << ",\"recMs\":" << jsonNum(result.perf.recTimeMs)
        << ",\"e2eMs\":" << jsonNum(result.perf.e2eTimeMs)
        << ",\"numBoxes\":" << result.perf.numBoxes
        << ",\"numCrops\":" << result.perf.numCrops
        << ",\"totalChars\":" << result.perf.totalChars
        << ",\"cps\":" << jsonNum(result.perf.cps) << "}";

    oss << ",\"autoCapture\":" << (a.autoCapture ? "true" : "false");
    oss << ",\"autoReason\":" << jsonStr(a.autoReason);
    oss << ",\"autoConfidence\":" << jsonNum(a.autoConfidence, 2);

    oss << ",\"frame\":" << jsonStr(frameB64);
    oss << "}";
    return oss.str();
}


// ---------------------------------------------------------------------------
// 카메라 워커
//
// 전용 스레드가 계속 grab 하고 최신 프레임 1장만 들고 있는다.
// MJPEG 스트리밍과 OCR 스캔이 같은 버퍼를 공유하되, 항상 복사본을 꺼내 쓴다.
// ---------------------------------------------------------------------------

struct CameraConfig {
    int deviceIndex = -1;    ///< -1 이면 자동 탐색
    std::string devicePath;  ///< 비어 있지 않으면 인덱스 대신 경로로 연다
    int width = 1280;
    int height = 720;
    int cropSize = 960;
    double fps = 15.0;
};

// /dev/video* 를 번호 순으로 열거한다.
std::vector<std::string> enumerateVideoDevices()
{
    std::vector<std::pair<int, std::string>> found;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator("/dev", ec)) {
        const std::string name = entry.path().filename().string();
        if (name.rfind("video", 0) != 0) {
            continue;
        }
        try {
            found.emplace_back(std::stoi(name.substr(5)), entry.path().string());
        } catch (const std::exception&) {
            // video 뒤가 숫자가 아니면 건너뛴다
        }
    }
    std::sort(found.begin(), found.end());

    std::vector<std::string> paths;
    paths.reserve(found.size());
    for (auto& [_, path] : found) {
        paths.push_back(std::move(path));
    }
    return paths;
}

// 카메라 후보 하나를 실제로 열어 프레임이 나오는지 확인한다.
//
// v4l2-ctl 로 포맷 목록만 보고 고르면 다른 환경에서 틀린다. UVC 웹캠은
// 캡처 노드와 메타데이터 노드를 함께 만들고, 열리기만 하고 프레임은
// 주지 않는 장치도 있다. 실제로 한 장 받아 보는 것이 유일하게 확실하다.
bool probeCamera(const std::string& path, const CameraConfig& config, std::string* why)
{
    cv::VideoCapture cap;
    if (!cap.open(path, cv::CAP_V4L2)) {
        *why = "cannot open (permission, or in use by another process)";
        return false;
    }

    cap.set(cv::CAP_PROP_BUFFERSIZE, 1);
    cap.set(cv::CAP_PROP_FOURCC, cv::VideoWriter::fourcc('M', 'J', 'P', 'G'));
    cap.set(cv::CAP_PROP_FRAME_WIDTH, config.width);
    cap.set(cv::CAP_PROP_FRAME_HEIGHT, config.height);

    // 첫 프레임은 늦게 오는 장치가 있다. 잠깐 기다려 준다.
    cv::Mat frame;
    for (int attempt = 0; attempt < 15; ++attempt) {
        if (cap.read(frame) && !frame.empty()) {
            std::ostringstream oss;
            oss << frame.cols << "x" << frame.rows;
            *why = oss.str();
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
    }
    *why = "opens but delivers no frames (likely a metadata node)";
    return false;
}

cv::Mat centerCropToSize(const cv::Mat& frame, int cropSize)
{
    if (frame.empty() || cropSize <= 0) {
        return frame;
    }
    if (frame.cols >= cropSize && frame.rows >= cropSize) {
        const int x = (frame.cols - cropSize) / 2;
        const int y = (frame.rows - cropSize) / 2;
        return frame(cv::Rect(x, y, cropSize, cropSize)).clone();
    }
    const int square = std::min(frame.cols, frame.rows);
    const int x = (frame.cols - square) / 2;
    const int y = (frame.rows - square) / 2;
    cv::Mat cropped = frame(cv::Rect(x, y, square, square));
    cv::Mat resized;
    cv::resize(cropped, resized, cv::Size(cropSize, cropSize), 0.0, 0.0, cv::INTER_LINEAR);
    return resized;
}

class CameraWorker {
public:
    explicit CameraWorker(CameraConfig config) : config_(std::move(config)) {}

    ~CameraWorker() { stop(); }

    bool start()
    {
        if (!open()) {
            return false;
        }
        running_.store(true);
        thread_ = std::thread([this] { loop(); });
        return true;
    }

    void stop()
    {
        running_.store(false);
        if (thread_.joinable()) {
            thread_.join();
        }
        if (cap_.isOpened()) {
            cap_.release();
        }
    }

    // 최신 프레임의 복사본. 아직 한 장도 못 읽었으면 empty.
    cv::Mat latestFrame() const
    {
        std::lock_guard<std::mutex> lock(frameMutex_);
        return latestFrame_.empty() ? cv::Mat() : latestFrame_.clone();
    }

    bool healthy() const { return running_.load() && frameCount_.load() > 0; }
    std::uint64_t frameCount() const { return frameCount_.load(); }

private:
    bool open()
    {
        // 후보 결정: --device > --camera N > 자동 탐색
        std::vector<std::string> candidates;
        bool explicitChoice = false;
        if (!config_.devicePath.empty()) {
            candidates.push_back(config_.devicePath);
            explicitChoice = true;
        } else if (config_.deviceIndex >= 0) {
            candidates.push_back("/dev/video" + std::to_string(config_.deviceIndex));
            explicitChoice = true;
        } else {
            candidates = enumerateVideoDevices();
            if (candidates.empty()) {
                std::cerr << "[camera] no /dev/video* devices found." << std::endl;
                return false;
            }
            std::cout << "[camera] auto-detecting from " << candidates.size() << " candidate(s)"
                      << std::endl;
        }

        // 실제로 프레임이 나오는 첫 장치를 쓴다. 시도 결과를 모두 찍어
        // 다른 환경에서도 원인을 바로 알 수 있게 한다.
        std::string chosen;
        for (const auto& dev : candidates) {
            std::string detail;
            if (probeCamera(dev, config_, &detail)) {
                std::cout << "[camera]   " << dev << " : OK (" << detail << ")" << std::endl;
                chosen = dev;
                break;
            }
            std::cout << "[camera]   " << dev << " : " << detail << std::endl;
        }

        if (chosen.empty()) {
            std::cerr << "[camera] no usable camera found." << std::endl;
            if (explicitChoice) {
                std::cerr << "[camera] the device you specified does not work. "
                             "Run --list-cameras to see what does."
                          << std::endl;
            } else {
                std::cerr << "[camera] check that a camera is connected, no other "
                             "program is using it, and your user is in the video "
                             "group (id -nG | grep video)."
                          << std::endl;
            }
            return false;
        }

        if (!cap_.open(chosen, cv::CAP_V4L2)) {
            std::cerr << "[camera] failed to reopen " << chosen << std::endl;
            return false;
        }

        cap_.set(cv::CAP_PROP_BUFFERSIZE, 1);
        cap_.set(cv::CAP_PROP_FOURCC, cv::VideoWriter::fourcc('M', 'J', 'P', 'G'));
        cap_.set(cv::CAP_PROP_FRAME_WIDTH, config_.width);
        cap_.set(cv::CAP_PROP_FRAME_HEIGHT, config_.height);
        cap_.set(cv::CAP_PROP_FPS, config_.fps);
        cap_.set(cv::CAP_PROP_AUTOFOCUS, 1.0);

        openedPath_ = chosen;
        std::cout << "[camera] using " << chosen << " -> "
                  << cap_.get(cv::CAP_PROP_FRAME_WIDTH) << "x"
                  << cap_.get(cv::CAP_PROP_FRAME_HEIGHT) << " @ " << cap_.get(cv::CAP_PROP_FPS)
                  << " FPS, crop " << config_.cropSize << "x" << config_.cropSize << std::endl;
        return true;
    }

    void loop()
    {
        while (running_.load()) {
            cv::Mat frame;
            if (!cap_.read(frame) || frame.empty()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            cv::Mat cropped = centerCropToSize(frame, config_.cropSize);
            {
                std::lock_guard<std::mutex> lock(frameMutex_);
                latestFrame_ = std::move(cropped);
            }
            frameCount_.fetch_add(1);
        }
    }

    CameraConfig config_;
    std::string openedPath_;
    cv::VideoCapture cap_;
    std::thread thread_;
    std::atomic_bool running_{false};
    std::atomic<std::uint64_t> frameCount_{0};
    mutable std::mutex frameMutex_;
    cv::Mat latestFrame_;
};

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

struct Args {
    CameraConfig camera;
    int port = 8090;
    std::string host = "0.0.0.0";
    fs::path webRoot;
    fs::path assetsDir;
    std::string detModel = "det_v6_m_640.dxnn";
    int jpegQuality = 80;
    double streamFps = 15.0;
    /** 지정되면 서버를 띄우지 않고 이 이미지로 OCR 을 한 번 돌린 뒤 결과를 출력한다. */
    fs::path testImage;
    fs::path registryPath;
    fs::path seedPath;
    /** 실시간 모드에서 화면을 멈출 최소 신뢰도. */
    double autoConfidence = 0.90;
    /** 카메라 후보를 진단 출력하고 종료한다. */
    bool listCameras = false;
};

// 저장소 루트. 빌드 시점에 박히므로 실행 위치와 무관하게 자산을 찾는다.
fs::path defaultRoot()
{
#ifdef APP_ROOT_DIR
    if (fs::exists(APP_ROOT_DIR)) {
        return APP_ROOT_DIR;
    }
#endif
    return fs::current_path();
}

void printUsage(const char* argv0)
{
    std::cout
        << "Usage: " << argv0 << " [options]\n"
        << "  --camera <idx>       camera index (auto-detected when omitted)\n"
        << "  --device <path>      카메라 디바이스 경로 (예: /dev/video2, --camera 보다 우선)\n"
        << "  --port <n>           HTTP 포트 (기본 8090)\n"
        << "  --host <addr>        바인딩 주소 (기본 0.0.0.0)\n"
        << "  --width <n>          캡처 폭 (기본 1280)\n"
        << "  --height <n>         캡처 높이 (기본 720)\n"
        << "  --crop <n>           중앙 정사각 크롭 크기 (기본 960)\n"
        << "  --fps <n>            카메라 FPS (기본 15)\n"
        << "  --stream-fps <n>     MJPEG 전송 FPS (기본 15)\n"
        << "  --jpeg-quality <n>   MJPEG JPEG 품질 1-100 (기본 80)\n"
        << "  --web-root <dir>     정적 파일 루트 (기본 web/dist)\n"
        << "  --assets <dir>       PP-OCRv6 모델 디렉터리 (기본 models/)\n"
        << "  --det-model <name>   검출 모델 파일명 (기본 det_v6_m_640.dxnn)\n"
        << "  --test-image <path>  카메라 대신 이미지 1장으로 OCR 을 돌리고 종료\n"
        << "  --registry <path>    기기 레지스트리 JSON (기본 data/registry.json)\n"
        << "  --seed <path>        레지스트리 최초 생성 시 쓸 시드 JSON\n"
        << "  --auto-confidence <f> 실시간 자동 캡처 최소 신뢰도 0~1 (기본 0.90)\n"
        << "  --list-cameras       probe cameras, print the result and exit\n"
        << "  -h, --help           도움말\n";
}

bool parseArgs(int argc, char** argv, Args* args)
{
    const fs::path root = defaultRoot();
    args->webRoot = root / "web" / "dist";
    args->assetsDir = root / "models";
    args->registryPath = root / "data" / "registry.json";
    args->seedPath = root / "data" / "seed_devices.json";

    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](const char* name) -> std::string {
            if (i + 1 >= argc) {
                throw std::runtime_error(std::string("Missing value for ") + name);
            }
            return argv[++i];
        };

        if (a == "-h" || a == "--help") {
            printUsage(argv[0]);
            return false;
        } else if (a == "--camera") {
            args->camera.deviceIndex = std::stoi(next("--camera"));
        } else if (a == "--device") {
            args->camera.devicePath = next("--device");
        } else if (a == "--port") {
            args->port = std::stoi(next("--port"));
        } else if (a == "--host") {
            args->host = next("--host");
        } else if (a == "--width") {
            args->camera.width = std::stoi(next("--width"));
        } else if (a == "--height") {
            args->camera.height = std::stoi(next("--height"));
        } else if (a == "--crop") {
            args->camera.cropSize = std::stoi(next("--crop"));
        } else if (a == "--fps") {
            args->camera.fps = std::stod(next("--fps"));
        } else if (a == "--stream-fps") {
            args->streamFps = std::stod(next("--stream-fps"));
        } else if (a == "--jpeg-quality") {
            args->jpegQuality = std::clamp(std::stoi(next("--jpeg-quality")), 1, 100);
        } else if (a == "--web-root") {
            args->webRoot = next("--web-root");
        } else if (a == "--assets") {
            args->assetsDir = next("--assets");
        } else if (a == "--det-model") {
            args->detModel = next("--det-model");
        } else if (a == "--test-image") {
            args->testImage = next("--test-image");
        } else if (a == "--registry") {
            args->registryPath = next("--registry");
        } else if (a == "--seed") {
            args->seedPath = next("--seed");
        } else if (a == "--list-cameras") {
            args->listCameras = true;
        } else if (a == "--auto-confidence") {
            args->autoConfidence = std::clamp(std::stod(next("--auto-confidence")), 0.0, 1.0);
        } else {
            std::cerr << "Unknown argument: " << a << "\n";
            printUsage(argv[0]);
            throw std::runtime_error("bad arguments");
        }
    }
    return true;
}

}  // namespace

int main(int argc, char** argv)
{
    Args args;
    try {
        if (!parseArgs(argc, argv, &args)) {
            return 0;
        }
    } catch (const std::exception& e) {
        std::cerr << "[args] " << e.what() << std::endl;
        return 1;
    }

    // 카메라 진단은 NPU 모델을 올리기 전에 끝낸다. 로딩에 수십 초가 걸린다.
    if (args.listCameras) {
        const std::vector<std::string> devices = enumerateVideoDevices();
        if (devices.empty()) {
            std::cout << "No /dev/video* devices found." << std::endl;
            return 1;
        }
        std::cout << "Probing " << devices.size()
                  << " camera candidate(s) by actually grabbing a frame:" << std::endl;
        int usable = 0;
        for (const auto& dev : devices) {
            std::string detail;
            const bool ok = probeCamera(dev, args.camera, &detail);
            usable += ok ? 1 : 0;
            std::cout << "  " << (ok ? "OK   " : "     ") << dev << "  " << detail << std::endl;
        }
        std::cout << std::endl;
        if (usable == 0) {
            std::cout << "None are usable. Check the camera connection and "
                         "permissions (id -nG | grep video)."
                      << std::endl;
            return 1;
        }
        std::cout << "To pin one explicitly: --device <path>" << std::endl;
        return 0;
    }

    args.webRoot = fs::weakly_canonical(args.webRoot);
    args.assetsDir = fs::weakly_canonical(args.assetsDir);
    args.registryPath = fs::weakly_canonical(args.registryPath);
    if (!args.seedPath.empty()) {
        args.seedPath = fs::weakly_canonical(args.seedPath);
    }

    std::cout << "[serial-qr] assets   : " << args.assetsDir << std::endl;
    std::cout << "[serial-qr] web root : " << args.webRoot << std::endl;
    std::cout << "[serial-qr] registry : " << args.registryPath << std::endl;

    // --- OCR 엔진 ---------------------------------------------------------
    std::unique_ptr<camocr::PaddleOcrEngine> engine;
    try {
        camocr::EngineOptions options;
        options.rootDir = args.assetsDir;
        options.assetsDir = args.assetsDir;
        options.detModelName = args.detModel;
        engine = std::make_unique<camocr::PaddleOcrEngine>(options);
    } catch (const std::exception& e) {
        std::cerr << "[ocr] Failed to initialize engine: " << e.what() << std::endl;
        std::cerr << "[ocr] models/ 에 .dxnn 파일이 있는지 확인하세요." << std::endl;
        return 1;
    }
    std::cout << "[ocr] engine ready" << std::endl;

    // PaddleOcrEngine 은 내부에 async 콜백과 inflight 카운터를 들고 있어
    // 스레드 안전하지 않다. run() 호출을 반드시 직렬화한다.
    std::mutex ocrMutex;

    serialqr::DeviceRegistry registry(args.registryPath, args.seedPath);

    // --- --test-image: 카메라 없이 OCR/시리얼 추출만 검증하고 종료 -------
    if (!args.testImage.empty()) {
        const cv::Mat image = cv::imread(args.testImage.string(), cv::IMREAD_COLOR);
        if (image.empty()) {
            std::cerr << "[test] 이미지를 열 수 없습니다: " << args.testImage << std::endl;
            return 1;
        }
        try {
            const camocr::OcrResult result = engine->run(image);
            const ScanAnalysis analysis = analyzeScan(result, args.autoConfidence);
            std::cout << buildScanJson(result, analysis, std::string()) << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "[test] OCR 실패: " << e.what() << std::endl;
            return 1;
        }
        return 0;
    }

    // --- 카메라 -----------------------------------------------------------
    CameraWorker camera(args.camera);
    const bool cameraOk = camera.start();
    if (!cameraOk) {
        std::cerr << "[camera] 카메라를 열지 못했습니다. /api/stream 과 /api/scan 은 "
                     "503 을 반환합니다."
                  << std::endl;
    }

    const std::string lanIp = detectLanIPv4();
    const std::string lanBaseUrl =
        lanIp.empty() ? "" : "http://" + lanIp + ":" + std::to_string(args.port);
    std::cout << "[serial-qr] LAN base URL: " << (lanBaseUrl.empty() ? "(none)" : lanBaseUrl)
              << std::endl;

    const std::vector<int> jpegParams{cv::IMWRITE_JPEG_QUALITY, args.jpegQuality};

    httplib::Server server;
    server.set_payload_max_length(32 * 1024 * 1024);

    // --- /api/health ------------------------------------------------------
    server.Get("/api/health", [&](const httplib::Request&, httplib::Response& res) {
        std::ostringstream oss;
        oss << "{\"status\":" << (camera.healthy() ? "\"ok\"" : "\"degraded\"")
            << ",\"camera\":" << (camera.healthy() ? "true" : "false")
            << ",\"npu\":true"
            << ",\"frames\":" << camera.frameCount() << "}";
        res.set_content(oss.str(), "application/json");
    });

    // --- /api/config ------------------------------------------------------
    server.Get("/api/config", [&](const httplib::Request&, httplib::Response& res) {
        std::ostringstream oss;
        oss << "{\"lanBaseUrl\":" << jsonStr(lanBaseUrl) << ",\"port\":" << args.port << "}";
        res.set_content(oss.str(), "application/json");
    });

    // --- 기기 레지스트리 --------------------------------------------------
    //
    // 프론트엔드가 아니라 서버가 기기 정보를 들고 있다. QR 을 찍은 휴대폰이
    // 같은 데이터를 조회해야 하기 때문이다. 시리얼은 유니크하다.

    server.Get("/api/devices", [&registry](const httplib::Request&, httplib::Response& res) {
        res.set_content(registry.all().dump(), "application/json");
    });

    server.Get(R"(/api/devices/([^/]+))", [&registry](const httplib::Request& req,
                                                      httplib::Response& res) {
        const auto device = registry.find(req.matches[1].str());
        if (!device) {
            res.status = 404;
            res.set_content(R"({"ok":false,"reason":"not_found"})", "application/json");
            return;
        }
        res.set_content(device->dump(), "application/json");
    });

    server.Post("/api/devices", [&registry](const httplib::Request& req, httplib::Response& res) {
        nlohmann::json payload;
        try {
            payload = nlohmann::json::parse(req.body);
        } catch (const nlohmann::json::exception&) {
            res.status = 400;
            res.set_content(R"({"ok":false,"reason":"bad_json"})", "application/json");
            return;
        }

        nlohmann::json stored;
        std::string message;
        const serialqr::RegisterResult result = registry.add(payload, &stored, &message);

        nlohmann::json body;
        body["message"] = message;

        switch (result) {
        case serialqr::RegisterResult::Ok:
            body["ok"] = true;
            body["device"] = stored;
            res.status = 201;
            break;
        case serialqr::RegisterResult::DuplicateSerial:
            body["ok"] = false;
            body["reason"] = "duplicate_serial";
            res.status = 409;
            break;
        case serialqr::RegisterResult::InvalidSerial:
            body["ok"] = false;
            body["reason"] = "invalid_serial";
            res.status = 400;
            break;
        case serialqr::RegisterResult::InvalidPayload:
            body["ok"] = false;
            body["reason"] = "invalid_payload";
            res.status = 400;
            break;
        case serialqr::RegisterResult::WriteFailed:
            body["ok"] = false;
            body["reason"] = "write_failed";
            res.status = 500;
            break;
        }
        res.set_content(body.dump(), "application/json");
    });

    // 데모를 반복 시연할 때 등록분을 되돌리기 위한 경로
    server.Delete(R"(/api/devices/([^/]+))", [&registry](const httplib::Request& req,
                                                         httplib::Response& res) {
        if (!registry.remove(req.matches[1].str())) {
            res.status = 404;
            res.set_content(R"({"ok":false,"reason":"not_found"})", "application/json");
            return;
        }
        res.set_content(R"({"ok":true})", "application/json");
    });

    // --- /api/stream (MJPEG) ---------------------------------------------
    const auto frameInterval =
        std::chrono::milliseconds(static_cast<int>(1000.0 / std::max(1.0, args.streamFps)));

    server.Get("/api/stream", [&, frameInterval, jpegParams](const httplib::Request&,
                                                             httplib::Response& res) {
        if (!cameraOk) {
            res.status = 503;
            res.set_content("{\"error\":\"camera_unavailable\"}", "application/json");
            return;
        }

        res.set_chunked_content_provider(
            "multipart/x-mixed-replace; boundary=frame",
            [&camera, frameInterval, jpegParams](std::size_t, httplib::DataSink& sink) {
                const cv::Mat frame = camera.latestFrame();
                if (frame.empty()) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(30));
                    return true;
                }

                std::vector<unsigned char> buf;
                if (!cv::imencode(".jpg", frame, buf, jpegParams)) {
                    return true;
                }

                std::ostringstream head;
                head << "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " << buf.size()
                     << "\r\n\r\n";
                const std::string header = head.str();

                if (!sink.write(header.data(), header.size())) {
                    return false;
                }
                if (!sink.write(reinterpret_cast<const char*>(buf.data()), buf.size())) {
                    return false;
                }
                if (!sink.write("\r\n", 2)) {
                    return false;
                }

                std::this_thread::sleep_for(frameInterval);
                return true;
            });
    });

    // --- /api/scan --------------------------------------------------------
    auto handleScan = [&](const httplib::Request& req, httplib::Response& res) {
        if (!cameraOk) {
            res.status = 503;
            res.set_content("{\"ok\":false,\"reason\":\"camera_unavailable\"}", "application/json");
            return;
        }

        const cv::Mat frame = camera.latestFrame();
        if (frame.empty()) {
            res.status = 503;
            res.set_content("{\"ok\":false,\"reason\":\"no_frame\"}", "application/json");
            return;
        }

        camocr::OcrResult result;
        try {
            std::lock_guard<std::mutex> lock(ocrMutex);
            result = engine->run(frame);
        } catch (const std::exception& e) {
            std::cerr << "[ocr] scan failed: " << e.what() << std::endl;
            res.status = 500;
            res.set_content(std::string("{\"ok\":false,\"reason\":\"ocr_error\",\"message\":") +
                                jsonStr(e.what()) + "}",
                            "application/json");
            return;
        }

        const ScanAnalysis analysis = analyzeScan(result, args.autoConfidence);

        // 실시간 폴링에서는 매 프레임 base64 JPEG(~80KB)를 돌려줄 필요가 없다.
        // 화면을 멈출 때(autoCapture)만 있으면 되므로, 클라이언트가 frame=0 을
        // 보내면 자동 캡처가 걸린 경우에만 프레임을 붙인다.
        const bool frameRequested = req.get_param_value("frame") != "0";

        std::string frameB64;
        if (frameRequested || analysis.autoCapture) {
            std::vector<unsigned char> jpeg;
            cv::imencode(".jpg", frame, jpeg, jpegParams);
            frameB64 = base64Encode(jpeg);
        }

        res.set_content(buildScanJson(result, analysis, frameB64), "application/json");
    };

    server.Post("/api/scan", handleScan);
    server.Get("/api/scan", handleScan);  // 브라우저에서 바로 눌러보기 편하도록

    // --- 정적 파일 + SPA 폴백 --------------------------------------------
    const bool webRootExists = fs::exists(args.webRoot);
    if (webRootExists) {
        server.set_mount_point("/", args.webRoot.string());
    } else {
        std::cerr << "[web] " << args.webRoot << " 가 없습니다. "
                  << "./build.sh 로 프론트엔드를 빌드하세요." << std::endl;
    }

    // 캐시 정책.
    //
    // index.html 을 캐시하면 재빌드 후 브라우저가 옛 해시 에셋을 요청한다.
    // 그 파일은 이미 없으므로, 아래 SPA 폴백까지 겹치면 CSS/JS 자리에 HTML 이
    // 200 으로 돌아가 화면이 통째로 깨진다. Chrome 은 캐시 헤더가 없으면
    // HTML 을 임의로 캐시하므로 반드시 막아야 한다.
    server.set_post_routing_handler([](const httplib::Request& req, httplib::Response& res) {
        if (req.path.rfind("/api/", 0) == 0) {
            res.set_header("Cache-Control", "no-store");
        } else if (req.path.rfind("/assets/", 0) == 0) {
            // 파일명에 콘텐츠 해시가 들어 있어 영구 캐시해도 안전하다.
            res.set_header("Cache-Control", "public, max-age=31536000, immutable");
        } else {
            res.set_header("Cache-Control", "no-store, must-revalidate");
        }
    });

    // 경로의 마지막 조각에 확장자가 있으면 정적 파일 요청으로 본다.
    const auto looksLikeFile = [](const std::string& path) {
        const std::size_t slash = path.rfind('/');
        const std::string leaf = slash == std::string::npos ? path : path.substr(slash + 1);
        return leaf.find('.') != std::string::npos;
    };

    const fs::path indexPath = args.webRoot / "index.html";
    server.set_error_handler([&](const httplib::Request& req, httplib::Response& res) {
        // SPA 라우팅(/device/xxx 직접 진입, 새로고침)을 위해 index.html 로 폴백한다.
        if (res.status != 404 || req.method != "GET" || req.path.rfind("/api/", 0) == 0) {
            return;
        }
        // 정적 파일 요청에는 폴백하지 않는다. 없는 .js/.css 자리에 HTML 을
        // 돌려주면 브라우저가 그것을 파싱하다 실패해, 단순한 404 가 화면 전체
        // 장애로 번진다. 404 를 그대로 남겨 원인이 드러나게 한다.
        if (req.path.rfind("/assets/", 0) == 0 || looksLikeFile(req.path)) {
            return;
        }
        if (!fs::exists(indexPath)) {
            res.set_content(
                "<h1>serial-qr</h1><p>프론트엔드가 빌드되지 않았습니다. "
                "<code>./build.sh</code> 를 실행하세요.</p>",
                "text/html; charset=utf-8");
            res.status = 200;
            return;
        }
        std::ifstream in(indexPath, std::ios::binary);
        std::ostringstream body;
        body << in.rdbuf();
        res.set_content(body.str(), "text/html; charset=utf-8");
        res.status = 200;
    });

    // 런처가 붙을 경우를 대비한 준비 완료 신호 (다른 데모와 동일한 규약)
    if (const char* readyPath = std::getenv("DX_LAUNCHER_READY_FILE")) {
        if (readyPath[0] != '\0') {
            std::ofstream(readyPath).put('\n');
        }
    }

    std::cout << "[serial-qr] listening on http://" << args.host << ":" << args.port << std::endl;
    if (!lanBaseUrl.empty()) {
        std::cout << "[serial-qr] 휴대폰에서 접속: " << lanBaseUrl << std::endl;
    }

    if (!server.listen(args.host, args.port)) {
        std::cerr << "[serial-qr] 포트 " << args.port << " 바인딩 실패" << std::endl;
        camera.stop();
        return 1;
    }

    camera.stop();
    return 0;
}
