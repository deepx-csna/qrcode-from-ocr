// 한국어 / English / 中文 전환.
//
// 의존성 없이 사전 + 컨텍스트로만 만든다. 문자열 수가 100개 남짓이라
// i18n 라이브러리를 얹을 만한 규모가 아니다.
//
// 사전은 ko 를 기준으로 삼는다. TranslationKey 가 ko 의 키에서 파생되므로
// en/zh 에서 키를 빠뜨리면 타입 에러가 난다.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export const LANGS = ['ko', 'en', 'zh'] as const
export type Lang = (typeof LANGS)[number]

export const LANG_LABEL: Record<Lang, string> = {
  ko: '한국어',
  en: 'English',
  zh: '中文',
}

/** 헤더 버튼에 쓰는 짧은 표기 */
export const LANG_SHORT: Record<Lang, string> = {
  ko: 'KO',
  en: 'EN',
  zh: '中',
}

const ko = {
  // --- 공통 ---
  'app.name': 'Serial-QR Demo',
  'nav.devices': '기기 관리',
  'step.scan': '시리얼 인식',
  'step.qr': 'QR 발행',
  'step.lookup': '기기 조회',
  'common.cancel': '취소',
  'common.delete': '삭제',
  'common.loading': '불러오는 중…',

  // --- 카메라 ---
  'camera.guide': '시리얼 라벨을 이 안에 맞추세요',
  'camera.frozen': '정지 프레임',
  'camera.liveAlt': '카메라 라이브 뷰',
  'camera.frozenAlt': '스캔한 프레임',
  'camera.error.title': '카메라 스트림에 연결하지 못했습니다.',
  'camera.error.body':
    '서버가 실행 중인지, 카메라 설정이 맞는지 확인하세요. 3초 후 자동으로 다시 시도합니다.',

  // --- 성능 배지 ---
  'perf.det': '검출',
  'perf.rec': '인식',
  'perf.total': '전체',
  'perf.boxes': '텍스트 박스',

  // --- 스캔 화면 ---
  'scan.title': '시리얼 번호 인식',
  'scan.subtitle': '기기 라벨을 카메라에 비추면 자동으로 인식합니다. PP-OCRv6 이 DX-M1 NPU 에서 동작합니다.',
  'scan.confirmTitle': '이 시리얼이 맞습니까?',
  'scan.confirmSubtitle': '자동으로 인식해 화면을 멈췄습니다. 번호를 확인하고 진행하세요.',
  'scan.live': '실시간 인식 중',
  'scan.rule': '뒤의 값을 공백 전까지 그대로 읽습니다. 신뢰도 {threshold}% 이상이면 자동으로 화면을 멈춥니다.',
  'scan.rejected': '{serial} 는 방금 물린 번호라 건너뜁니다. 다른 라벨을 비추거나 아래에서 직접 인식하세요.',
  'scan.readingNow': '지금 읽히는 텍스트',
  'scan.manual': '지금 바로 인식 (스페이스바)',
  'scan.manualBusy': '인식 중…',
  'scan.recognized': '인식된 시리얼',
  'scan.confidence': '신뢰도',
  'scan.marker': '표기',
  'scan.checking': '등록 여부 확인 중…',
  'scan.registered': '등록된 기기 — {model}',
  'scan.unregistered': '레지스트리에 없는 시리얼입니다.',
  'scan.accept': '맞습니다 · QR 생성 →',
  'scan.reject': '아니요 · 다시 스캔',
  'scan.registerThis': '이 기기 등록하기',
  'scan.rawTexts': 'OCR 원본 텍스트 {count}건',
  'scan.preRegister': '+ 기기 사전 등록',
  'scan.demoPick': '라벨 없이 시연하기 (등록된 시리얼 직접 선택 · {count}대)',
  'scan.manageDevices': '기기 관리 →',

  // --- 시리얼 후보 ---
  'candidates.title': '인식된 시리얼 후보',

  // --- QR 화면 ---
  'result.title': 'QR 코드 발행',
  'result.subtitle': '이 QR 을 휴대폰 카메라로 찍으면 기기 정보 조회 페이지가 열립니다.',
  'result.qrUrl': 'QR 인코딩 주소',
  'result.print': 'QR 프린트',
  'result.hint': '휴대폰 기본 카메라로 QR 을 비추면 기기 정보 페이지가 열립니다. 휴대폰이 같은 네트워크에 있어야 합니다.',
  'result.configError':
    '서버에서 LAN 주소를 가져오지 못해 현재 브라우저 주소를 사용했습니다. 휴대폰에서 열리지 않으면 서버 로그의 LAN base URL 을 확인하세요.',
  'result.rescan': '← 다시 스캔',
  'result.openLookup': '조회 화면 열기',
  'result.serial': '시리얼 번호',
  'result.notRegistered':
    '레지스트리에 등록되지 않은 시리얼입니다. QR 은 정상적으로 생성되지만, 조회 화면에서는 미등록 기기로 표시됩니다.',
  'result.registerNow': '지금 등록하기',

  // --- 조회 화면 ---
  'device.title': '기기 정보',
  'device.titleLoading': '조회 중…',
  'device.titleUnknown': '미등록 기기',
  'device.subtitle': 'QR 로 조회된 기기의 상세 정보입니다.',
  'device.subtitleLoading': '서버에서 기기 정보를 가져오는 중입니다.',
  'device.subtitleUnknown': 'QR 에 담긴 시리얼이 레지스트리에 없습니다.',
  'device.queried': '조회한 시리얼',
  'device.notFound': '이 시리얼로 등록된 기기를 찾을 수 없습니다. 시리얼이 잘못 인식되었거나 아직 등록되지 않은 기기입니다.',
  'device.registerThis': '이 기기 등록하기',
  'device.scanNew': '새 기기 스캔하기',

  // --- 기기 정보 카드 ---
  'field.serial': '시리얼 번호',
  'field.model': '모델',
  'field.npu': 'NPU',
  'field.hwRevision': 'HW 리비전',
  'field.firmware': '펌웨어',
  'field.macAddress': 'MAC 주소',
  'field.manufacturedAt': '제조일',
  'field.warrantyUntil': '보증 만료',
  'field.deployedSite': '배치 위치',
  'spec.tops': '연산',
  'spec.memory': '메모리',
  'spec.power': '소비전력',
  'qa.PASS': 'QA 합격',
  'qa.PENDING': 'QA 대기',
  'qa.FAIL': 'QA 불합격',
  'qa.short.PASS': '합격',
  'qa.short.PENDING': '대기',
  'qa.short.FAIL': '불합격',

  // --- 등록 화면 ---
  'register.title': '기기 사전 등록',
  'register.titleFromScan': '인식된 기기 등록',
  'register.subtitle': '시리얼 번호만 입력하면 됩니다. 나머지 항목은 예시로 채워져 있습니다.',
  'register.subtitleFromScan': '카메라로 읽은 시리얼입니다. 나머지 항목은 예시로 채워져 있으니 필요한 것만 고치세요.',
  'register.serialLabel': '시리얼 번호',
  'register.serialHelp': '영문·숫자·하이픈 4~32자. 예: DX-M1-A7K3P9V2',
  'register.serialFromScan': '카메라로 인식된 시리얼입니다.',
  'register.serialManualLink': '직접 입력하려면 여기',
  'register.serialInvalid': '형식이 올바르지 않습니다. 영문·숫자·하이픈 4~32자여야 합니다.',
  'register.duplicate': '이미 등록된 시리얼입니다 ({site}).',
  'register.viewExisting': '등록 정보 보기',
  'register.sectionInfo': '기기 정보',
  'register.qaStatus': 'QA 상태',
  'register.afterTitle': '등록 후',
  'register.afterBody':
    '등록이 끝나면 바로 QR 발행 화면으로 이동합니다. 그 QR 을 휴대폰으로 찍으면 지금 입력한 정보가 그대로 조회됩니다.',
  'register.submit': '등록하고 QR 발행 →',
  'register.submitting': '등록 중…',
  'register.count': '현재 등록된 기기',
  'register.unit': '대',

  // --- 기기 관리 ---
  'devices.title': '등록 기기 관리',
  'devices.subtitle': '서버 레지스트리에 등록된 기기입니다. 삭제하면 QR 로 조회해도 미등록으로 표시됩니다.',
  'devices.total': '총',
  'devices.unit': '대',
  'devices.backToScan': '← 스캔으로',
  'devices.add': '+ 사전 등록',
  'devices.removed': '{serial} 를 삭제했습니다.',
  'devices.empty': '등록된 기기가 없습니다.',
  'devices.emptyCta': '기기 사전 등록',
  'devices.view': '조회',
  'devices.qr': 'QR',
  'devices.confirmDelete': '삭제할까요?',
  'devices.deleting': '삭제 중…',
  'devices.deleteFailed': '{serial} 삭제에 실패했습니다. 이미 지워졌을 수 있습니다.',
  'devices.resetHint':
    '기본 기기를 포함해 모두 되돌리려면 서버를 멈추고 data/registry.json 을 지운 뒤 다시 실행하세요. 시드로 재생성됩니다.',

  // --- 오류 메시지 ---
  'error.noSerialFound': '시리얼 번호를 찾지 못했습니다. 라벨을 가이드 안에 맞추고 다시 시도하세요.',
  'error.cameraUnavailable': '카메라를 열 수 없습니다. 서버의 카메라 설정을 확인하세요.',
  'error.noFrame': '아직 카메라 프레임이 준비되지 않았습니다. 잠시 후 다시 시도하세요.',
  'error.ocr': 'OCR 추론 중 오류가 발생했습니다. 서버 로그를 확인하세요.',
  'error.generic': '요청에 실패했습니다.',
  'error.genericWith': '요청에 실패했습니다 ({reason}).',
  'error.deviceList': '기기 목록을 가져오지 못했습니다.',
  'error.deviceOne': '기기 정보를 가져오지 못했습니다.',
  'error.serverConfig': '서버 설정을 가져오지 못했습니다.',
  'error.badResponse': '서버 응답을 해석하지 못했습니다.',
  'error.registerHttp': '등록에 실패했습니다 (HTTP {status}).',
  'error.lowConfidence':
    '신뢰도 {confidence}% — 임계값 {threshold}% 미만입니다. 라벨을 더 가까이, 정면으로 비추세요.',
  'error.noSerialYet': 'S/N 표기를 찾는 중…',
} as const

export type TranslationKey = keyof typeof ko

const en: Record<TranslationKey, string> = {
  'app.name': 'Serial-QR Demo',
  'nav.devices': 'Devices',
  'step.scan': 'Scan',
  'step.qr': 'Issue QR',
  'step.lookup': 'Look up',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.loading': 'Loading…',

  'camera.guide': 'Line the serial label up inside this box',
  'camera.frozen': 'Frozen frame',
  'camera.liveAlt': 'Live camera view',
  'camera.frozenAlt': 'Scanned frame',
  'camera.error.title': 'Could not connect to the camera stream.',
  'camera.error.body':
    'Check that the server is running and the camera is configured correctly. Retrying in 3 seconds.',

  'perf.det': 'Detect',
  'perf.rec': 'Recognize',
  'perf.total': 'Total',
  'perf.boxes': 'Text boxes',

  'scan.title': 'Serial number recognition',
  'scan.subtitle':
    'Hold a device label up to the camera and it is recognized automatically. PP-OCRv6 runs on the DX-M1 NPU.',
  'scan.confirmTitle': 'Is this serial correct?',
  'scan.confirmSubtitle': 'Recognized automatically and the view is frozen. Check the number and continue.',
  'scan.live': 'Scanning',
  'scan.rule':
    'is read verbatim up to the next whitespace. The view freezes automatically at {threshold}% confidence or above.',
  'scan.rejected': '{serial} was just rejected, so it is skipped. Show another label or scan manually below.',
  'scan.readingNow': 'Currently reading',
  'scan.manual': 'Scan now (Space)',
  'scan.manualBusy': 'Scanning…',
  'scan.recognized': 'Recognized serial',
  'scan.confidence': 'Confidence',
  'scan.marker': 'marker',
  'scan.checking': 'Checking registration…',
  'scan.registered': 'Registered — {model}',
  'scan.unregistered': 'This serial is not in the registry.',
  'scan.accept': 'Correct · Issue QR →',
  'scan.reject': 'No · Scan again',
  'scan.registerThis': 'Register this device',
  'scan.rawTexts': 'Raw OCR text ({count})',
  'scan.preRegister': '+ Pre-register a device',
  'scan.demoPick': 'Demo without a label (pick a registered serial · {count})',
  'scan.manageDevices': 'Manage devices →',

  'candidates.title': 'Serial candidates',

  'result.title': 'QR code issued',
  'result.subtitle': 'Scan this QR with a phone camera to open the device lookup page.',
  'result.qrUrl': 'Encoded URL',
  'result.print': 'Print QR',
  'result.hint':
    'Point a phone camera at the QR to open the device page. The phone must be on the same network.',
  'result.configError':
    'Could not get the LAN address from the server, so the current browser address was used. If it does not open on a phone, check the LAN base URL in the server log.',
  'result.rescan': '← Scan again',
  'result.openLookup': 'Open lookup page',
  'result.serial': 'Serial number',
  'result.notRegistered':
    'This serial is not in the registry. The QR is still valid, but the lookup page will show it as unregistered.',
  'result.registerNow': 'Register it now',

  'device.title': 'Device information',
  'device.titleLoading': 'Looking up…',
  'device.titleUnknown': 'Unregistered device',
  'device.subtitle': 'Details for the device looked up by QR.',
  'device.subtitleLoading': 'Fetching device information from the server.',
  'device.subtitleUnknown': 'The serial in this QR is not in the registry.',
  'device.queried': 'Serial looked up',
  'device.notFound':
    'No device is registered under this serial. Either it was misread or it has not been registered yet.',
  'device.registerThis': 'Register this device',
  'device.scanNew': 'Scan another device',

  'field.serial': 'Serial number',
  'field.model': 'Model',
  'field.npu': 'NPU',
  'field.hwRevision': 'HW revision',
  'field.firmware': 'Firmware',
  'field.macAddress': 'MAC address',
  'field.manufacturedAt': 'Manufactured',
  'field.warrantyUntil': 'Warranty until',
  'field.deployedSite': 'Deployed at',
  'spec.tops': 'Compute',
  'spec.memory': 'Memory',
  'spec.power': 'Power',
  'qa.PASS': 'QA passed',
  'qa.PENDING': 'QA pending',
  'qa.FAIL': 'QA failed',
  'qa.short.PASS': 'Pass',
  'qa.short.PENDING': 'Pending',
  'qa.short.FAIL': 'Fail',

  'register.title': 'Pre-register a device',
  'register.titleFromScan': 'Register the scanned device',
  'register.subtitle': 'Just enter the serial number. Everything else is prefilled with examples.',
  'register.subtitleFromScan':
    'This serial came from the camera. The rest is prefilled with examples — change only what you need.',
  'register.serialLabel': 'Serial number',
  'register.serialHelp': 'Letters, digits and hyphens, 4–32 characters. e.g. DX-M1-A7K3P9V2',
  'register.serialFromScan': 'Recognized by the camera.',
  'register.serialManualLink': 'enter one manually',
  'register.serialInvalid': 'Invalid format. Use letters, digits and hyphens, 4–32 characters.',
  'register.duplicate': 'This serial is already registered ({site}).',
  'register.viewExisting': 'View it',
  'register.sectionInfo': 'Device information',
  'register.qaStatus': 'QA status',
  'register.afterTitle': 'After registering',
  'register.afterBody':
    'You go straight to the QR screen. Scanning that QR with a phone shows exactly what you enter here.',
  'register.submit': 'Register and issue QR →',
  'register.submitting': 'Registering…',
  'register.count': 'Devices registered',
  'register.unit': '',

  'devices.title': 'Registered devices',
  'devices.subtitle':
    'Devices in the server registry. Deleting one makes its QR resolve to "unregistered".',
  'devices.total': 'Total',
  'devices.unit': '',
  'devices.backToScan': '← Back to scan',
  'devices.add': '+ Pre-register',
  'devices.removed': 'Deleted {serial}.',
  'devices.empty': 'No devices registered.',
  'devices.emptyCta': 'Pre-register a device',
  'devices.view': 'View',
  'devices.qr': 'QR',
  'devices.confirmDelete': 'Delete it?',
  'devices.deleting': 'Deleting…',
  'devices.deleteFailed': 'Could not delete {serial}. It may already be gone.',
  'devices.resetHint':
    'To restore everything including the seed devices, stop the server, delete data/registry.json and start again — it is recreated from the seed.',

  'error.noSerialFound': 'No serial number found. Line the label up inside the guide and try again.',
  'error.cameraUnavailable': 'Cannot open the camera. Check the server camera settings.',
  'error.noFrame': 'No camera frame is ready yet. Try again in a moment.',
  'error.ocr': 'OCR inference failed. Check the server log.',
  'error.generic': 'The request failed.',
  'error.genericWith': 'The request failed ({reason}).',
  'error.deviceList': 'Could not fetch the device list.',
  'error.deviceOne': 'Could not fetch the device information.',
  'error.serverConfig': 'Could not fetch the server configuration.',
  'error.badResponse': 'Could not parse the server response.',
  'error.registerHttp': 'Registration failed (HTTP {status}).',
  'error.lowConfidence':
    'Confidence {confidence}% — below the {threshold}% threshold. Move the label closer and square to the camera.',
  'error.noSerialYet': 'Looking for an S/N marker…',
}

const zh: Record<TranslationKey, string> = {
  'app.name': 'Serial-QR Demo',
  'nav.devices': '设备管理',
  'step.scan': '识别序列号',
  'step.qr': '生成二维码',
  'step.lookup': '查询设备',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.loading': '加载中…',

  'camera.guide': '请将序列号标签对准此框内',
  'camera.frozen': '已冻结画面',
  'camera.liveAlt': '摄像头实时画面',
  'camera.frozenAlt': '已扫描的画面',
  'camera.error.title': '无法连接摄像头视频流。',
  'camera.error.body': '请确认服务已启动、摄像头配置正确。3 秒后自动重试。',

  'perf.det': '检测',
  'perf.rec': '识别',
  'perf.total': '合计',
  'perf.boxes': '文本框',

  'scan.title': '识别序列号',
  'scan.subtitle': '将设备标签对准摄像头即可自动识别。PP-OCRv6 运行于 DX-M1 NPU。',
  'scan.confirmTitle': '这个序列号正确吗？',
  'scan.confirmSubtitle': '已自动识别并冻结画面。请确认号码后继续。',
  'scan.live': '实时识别中',
  'scan.rule': '之后的内容会原样读取到空格为止。置信度达到 {threshold}% 以上时自动冻结画面。',
  'scan.rejected': '{serial} 刚刚被否决，已跳过。请对准其他标签，或使用下方手动识别。',
  'scan.readingNow': '当前读到的文本',
  'scan.manual': '立即识别（空格键）',
  'scan.manualBusy': '识别中…',
  'scan.recognized': '识别到的序列号',
  'scan.confidence': '置信度',
  'scan.marker': '标记',
  'scan.checking': '正在确认是否已注册…',
  'scan.registered': '已注册设备 — {model}',
  'scan.unregistered': '该序列号不在注册表中。',
  'scan.accept': '正确 · 生成二维码 →',
  'scan.reject': '不对 · 重新扫描',
  'scan.registerThis': '注册此设备',
  'scan.rawTexts': 'OCR 原始文本 {count} 条',
  'scan.preRegister': '+ 预先注册设备',
  'scan.demoPick': '无标签演示（直接选择已注册序列号 · {count} 台）',
  'scan.manageDevices': '设备管理 →',

  'candidates.title': '识别到的候选序列号',

  'result.title': '生成二维码',
  'result.subtitle': '用手机相机扫描此二维码即可打开设备信息查询页。',
  'result.qrUrl': '二维码编码地址',
  'result.print': '打印二维码',
  'result.hint': '用手机自带相机对准二维码即可打开设备信息页。手机需与本机处于同一网络。',
  'result.configError':
    '未能从服务端获取局域网地址，已改用当前浏览器地址。若手机无法打开，请查看服务日志中的 LAN base URL。',
  'result.rescan': '← 重新扫描',
  'result.openLookup': '打开查询页',
  'result.serial': '序列号',
  'result.notRegistered': '该序列号未注册。二维码仍会正常生成，但查询页会显示为未注册设备。',
  'result.registerNow': '立即注册',

  'device.title': '设备信息',
  'device.titleLoading': '查询中…',
  'device.titleUnknown': '未注册设备',
  'device.subtitle': '通过二维码查询到的设备详情。',
  'device.subtitleLoading': '正在从服务端获取设备信息。',
  'device.subtitleUnknown': '二维码中的序列号不在注册表中。',
  'device.queried': '查询的序列号',
  'device.notFound': '未找到以该序列号注册的设备。可能是识别有误，或该设备尚未注册。',
  'device.registerThis': '注册此设备',
  'device.scanNew': '扫描新设备',

  'field.serial': '序列号',
  'field.model': '型号',
  'field.npu': 'NPU',
  'field.hwRevision': '硬件版本',
  'field.firmware': '固件',
  'field.macAddress': 'MAC 地址',
  'field.manufacturedAt': '生产日期',
  'field.warrantyUntil': '保修至',
  'field.deployedSite': '部署位置',
  'spec.tops': '算力',
  'spec.memory': '内存',
  'spec.power': '功耗',
  'qa.PASS': 'QA 合格',
  'qa.PENDING': 'QA 待检',
  'qa.FAIL': 'QA 不合格',
  'qa.short.PASS': '合格',
  'qa.short.PENDING': '待检',
  'qa.short.FAIL': '不合格',

  'register.title': '预先注册设备',
  'register.titleFromScan': '注册识别到的设备',
  'register.subtitle': '只需填写序列号，其余项目已填入示例值。',
  'register.subtitleFromScan': '这是摄像头读取到的序列号。其余项目已填入示例值，按需修改即可。',
  'register.serialLabel': '序列号',
  'register.serialHelp': '字母、数字与连字符，4~32 位。例：DX-M1-A7K3P9V2',
  'register.serialFromScan': '由摄像头识别得到。',
  'register.serialManualLink': '手动输入请点此',
  'register.serialInvalid': '格式不正确。应为字母、数字与连字符，4~32 位。',
  'register.duplicate': '该序列号已注册（{site}）。',
  'register.viewExisting': '查看注册信息',
  'register.sectionInfo': '设备信息',
  'register.qaStatus': 'QA 状态',
  'register.afterTitle': '注册之后',
  'register.afterBody': '注册完成后直接进入二维码页面。用手机扫描该二维码，就能看到此处填写的信息。',
  'register.submit': '注册并生成二维码 →',
  'register.submitting': '注册中…',
  'register.count': '当前已注册设备',
  'register.unit': '台',

  'devices.title': '已注册设备管理',
  'devices.subtitle': '服务端注册表中的设备。删除后，用二维码查询会显示为未注册。',
  'devices.total': '共',
  'devices.unit': '台',
  'devices.backToScan': '← 返回扫描',
  'devices.add': '+ 预先注册',
  'devices.removed': '已删除 {serial}。',
  'devices.empty': '尚无已注册设备。',
  'devices.emptyCta': '预先注册设备',
  'devices.view': '查询',
  'devices.qr': '二维码',
  'devices.confirmDelete': '确定删除吗？',
  'devices.deleting': '删除中…',
  'devices.deleteFailed': '删除 {serial} 失败，可能已被删除。',
  'devices.resetHint':
    '若要连同默认设备一起还原，请停止服务、删除 data/registry.json 后重新启动，系统会依据种子文件重新生成。',

  'error.noSerialFound': '未找到序列号。请将标签对准取景框后重试。',
  'error.cameraUnavailable': '无法打开摄像头。请检查服务端的摄像头设置。',
  'error.noFrame': '摄像头画面尚未就绪，请稍后重试。',
  'error.ocr': 'OCR 推理出错。请查看服务日志。',
  'error.generic': '请求失败。',
  'error.genericWith': '请求失败（{reason}）。',
  'error.deviceList': '未能获取设备列表。',
  'error.deviceOne': '未能获取设备信息。',
  'error.serverConfig': '未能获取服务端配置。',
  'error.badResponse': '无法解析服务端响应。',
  'error.registerHttp': '注册失败（HTTP {status}）。',
  'error.lowConfidence': '置信度 {confidence}% —— 低于阈值 {threshold}%。请将标签靠近并正对摄像头。',
  'error.noSerialYet': '正在寻找 S/N 标记…',
}

const DICT: Record<Lang, Record<TranslationKey, string>> = { ko, en, zh }

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

/** 사전에서 문자열을 꺼내 {placeholder} 를 채운다. 컴포넌트 밖에서도 쓸 수 있다. */
export function translate(
  lang: Lang,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const raw = DICT[lang][key] ?? DICT.ko[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  )
}

const STORAGE_KEY = 'dx-serial-qr.lang'

// React 밖에서 문자열이 필요한 곳(api.ts 의 fetch 오류 등)을 위한 현재 언어.
// Provider 가 갱신한다.
let activeLang: Lang = 'ko'

/** 컴포넌트가 아닌 코드에서 쓰는 번역. */
export function tr(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(activeLang, key, params)
}

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (LANGS as readonly string[]).includes(saved)) {
      return saved as Lang
    }
  } catch {
    // 시크릿 모드 등에서 localStorage 접근이 막힐 수 있다. 무시하고 넘어간다.
  }
  const nav = navigator.language.toLowerCase()
  if (nav.startsWith('zh')) return 'zh'
  if (nav.startsWith('en')) return 'en'
  return 'ko'
}

activeLang = detectLang()

interface I18nValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  useEffect(() => {
    activeLang = lang
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 저장 실패는 치명적이지 않다. 이번 세션에만 적용된다.
    }
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>')
  }
  return ctx
}
