// C++ 서버(serial_ocr_server) API 클라이언트

import type { DeviceInfo } from '../data/devices'
import { tr } from '../i18n'

export interface SerialCandidate {
  text: string
  rawText: string
  /** 이 시리얼을 뽑아낸 표기 ("S/N", "序列号" …) */
  prefix: string
  score: number
}

export interface OcrPerf {
  detMs: number
  recMs: number
  e2eMs: number
  numBoxes: number
  numCrops: number
  totalChars: number
  cps: number
}

/** 서버의 자동 캡처 판정 결과. */
export type AutoReason =
  | 'ok'             // 표기 뒤에서 잘라냈고 신뢰도도 충분하다
  | 'low_confidence' // 잘라내긴 했지만 신뢰도가 임계값 미만
  | 'no_serial'      // 표기를 찾지 못했다
  | 'none'

export interface ScanResponse {
  ok: boolean
  reason?: string
  serial: string | null
  confidence: number
  candidates: SerialCandidate[]
  rawTexts: string[]
  perf: OcrPerf
  /** 실시간 모드에서 화면을 멈추고 확인을 받을지 */
  autoCapture: boolean
  autoReason: AutoReason
  /** 자동 캡처 최소 신뢰도 (서버 설정, 기본 0.9) */
  autoConfidence: number
  /** 스캔 시점 프레임 (base64 JPEG, data: 접두사 없음) */
  frame?: string
}

export interface ServerConfig {
  lanBaseUrl: string
  port: number
}

export const STREAM_URL = '/api/stream'

/**
 * 한 프레임을 OCR 한다.
 *
 * 실시간 폴링에서는 includeFrame=false 로 호출한다. 매번 base64 JPEG(~80KB)를
 * 받을 필요가 없기 때문이다. 서버는 자동 캡처가 걸린 경우에만 프레임을 붙여 준다.
 */
export async function scan(
  opts: { signal?: AbortSignal; includeFrame?: boolean } = {},
): Promise<ScanResponse> {
  const { signal, includeFrame = true } = opts
  const url = includeFrame ? '/api/scan' : '/api/scan?frame=0'
  const res = await fetch(url, { method: 'POST', signal })
  const body = await res.json().catch(() => null)

  if (!res.ok) {
    const reason = body?.reason ?? `http_${res.status}`
    throw new Error(reasonToMessage(reason))
  }
  if (!body) {
    throw new Error(tr('error.badResponse'))
  }
  return body as ScanResponse
}

export async function fetchConfig(): Promise<ServerConfig> {
  const res = await fetch('/api/config')
  if (!res.ok) {
    throw new Error(tr('error.serverConfig'))
  }
  return (await res.json()) as ServerConfig
}

/** 자동 캡처가 걸리지 않은 이유를 사람이 읽을 문장으로. */
export function autoReasonToMessage(res: ScanResponse): string {
  switch (res.autoReason) {
    case 'low_confidence':
      return tr('error.lowConfidence', {
        confidence: (res.confidence * 100).toFixed(0),
        threshold: (res.autoConfidence * 100).toFixed(0),
      })
    case 'no_serial':
      return tr('error.noSerialYet')
    default:
      return ''
  }
}

export function reasonToMessage(reason: string | undefined): string {
  switch (reason) {
    case 'no_serial_found':
      return tr('error.noSerialFound')
    case 'camera_unavailable':
      return tr('error.cameraUnavailable')
    case 'no_frame':
      return tr('error.noFrame')
    case 'ocr_error':
      return tr('error.ocr')
    default:
      return reason ? tr('error.genericWith', { reason }) : tr('error.generic')
  }
}

/**
 * QR 에 넣을 조회 URL을 만든다.
 *
 * 서버가 알려준 LAN 주소를 우선 쓴다. 데모 PC 에서 localhost 로 열어 놓고
 * window.location.origin 을 쓰면 휴대폰이 그 QR 을 열 수 없기 때문이다.
 */
export function buildDeviceUrl(serial: string, config: ServerConfig | null): string {
  const base = config?.lanBaseUrl?.trim() || window.location.origin
  return `${base.replace(/\/$/, '')}/device/${encodeURIComponent(serial)}`
}

// ---------------------------------------------------------------------------
// 기기 레지스트리
//
// 기기 정보는 서버가 소유한다(data/registry.json). QR 을 찍은 휴대폰이 같은
// 데이터를 봐야 하므로 브라우저 저장소에 두지 않는다. 시리얼은 유니크하다.
// ---------------------------------------------------------------------------

export interface RegisterOutcome {
  ok: boolean
  reason?: 'duplicate_serial' | 'invalid_serial' | 'invalid_payload' | 'write_failed' | 'bad_json'
  message: string
  device?: DeviceInfo
}

export async function fetchDevices(): Promise<DeviceInfo[]> {
  const res = await fetch('/api/devices')
  if (!res.ok) {
    throw new Error(tr('error.deviceList'))
  }
  return (await res.json()) as DeviceInfo[]
}

/** 등록되지 않은 시리얼이면 null. */
export async function fetchDevice(serial: string): Promise<DeviceInfo | null> {
  const res = await fetch(`/api/devices/${encodeURIComponent(serial)}`)
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw new Error(tr('error.deviceOne'))
  }
  return (await res.json()) as DeviceInfo
}

export async function registerDevice(device: DeviceInfo): Promise<RegisterOutcome> {
  const res = await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device),
  })
  const body = (await res.json().catch(() => null)) as RegisterOutcome | null
  if (!body) {
    return { ok: false, message: tr('error.registerHttp', { status: res.status }) }
  }
  return body
}

export async function deleteDevice(serial: string): Promise<boolean> {
  const res = await fetch(`/api/devices/${encodeURIComponent(serial)}`, { method: 'DELETE' })
  return res.ok
}
