import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CameraStream from '../components/CameraStream'
import Layout from '../components/Layout'
import PerfBadges from '../components/PerfBadges'
import SerialCandidates from '../components/SerialCandidates'
import { autoReasonToMessage, reasonToMessage, scan, type ScanResponse } from '../lib/api'
import { useDevice, useDevices } from '../hooks/useDevice'
import { useI18n } from '../i18n'

/** 실시간 스캔 간격. OCR 자체가 ~200ms 라 사실상 연속으로 돈다. */
const POLL_INTERVAL_MS = 150


export default function ScanPage() {
  const navigate = useNavigate()
  const { t } = useI18n()

  // 'live'    : 카메라를 계속 훑으며 시리얼을 찾는 중
  // 'confirm' : 찾았다. 화면을 멈추고 사용자 확인을 기다린다.
  const [mode, setMode] = useState<'live' | 'confirm'>('live')
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [live, setLive] = useState<ScanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 루프가 자기 자신을 중단시킬 수 있도록 최신 mode 를 참조로 들고 있는다.
  const modeRef = useRef(mode)
  modeRef.current = mode

  // 사용자가 "아니요" 로 물린 시리얼. 라벨이 카메라 앞에 그대로 있으면
  // 같은 번호를 즉시 다시 잡아 확인 화면이 무한히 반복되기 때문에 건너뛴다.
  const rejectedRef = useRef<Set<string>>(new Set())
  const [rejectedSerial, setRejectedSerial] = useState<string | null>(null)

  const capture = useCallback((res: ScanResponse) => {
    setResult(res)
    setSelected(res.serial)
    setMode('confirm')
  }, [])

  // --- 실시간 인식 루프 --------------------------------------------------
  // setInterval 이 아니라 순차 실행이다. OCR 은 서버에서 직렬화되므로
  // 요청이 겹치면 큐만 쌓인다.
  useEffect(() => {
    if (mode !== 'live') return

    let cancelled = false
    const controller = new AbortController()

    const loop = async () => {
      while (!cancelled && modeRef.current === 'live') {
        try {
          const res = await scan({ signal: controller.signal, includeFrame: false })
          if (cancelled) return

          setLive(res)
          setError(null)

          if (res.autoCapture && res.serial) {
            if (rejectedRef.current.has(res.serial)) {
              // 물린 번호다. 계속 훑으면서 다른 라벨을 기다린다.
              setRejectedSerial(res.serial)
            } else {
              capture(res)
              return
            }
          } else {
            setRejectedSerial(null)
          }
        } catch (e) {
          if (cancelled || controller.signal.aborted) return
          setError(e instanceof Error ? e.message : String(e))
          // 서버가 죽었을 때 초당 수십 번 때리지 않도록 잠시 쉰다.
          await new Promise((r) => setTimeout(r, 1500))
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    }

    void loop()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [mode, capture])

  // --- 수동 인식 (자동이 안 걸릴 때의 탈출구) ----------------------------
  const manualScan = useCallback(async () => {
    setBusy(true)
    setError(null)
    // 수동 인식은 사용자가 명시적으로 누른 것이므로 거부 목록을 비운다.
    rejectedRef.current.clear()
    setRejectedSerial(null)
    try {
      const res = await scan({ includeFrame: true })
      if (res.serial) {
        capture(res)
      } else {
        setLive(res)
        setError(reasonToMessage(res.reason))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [capture])

  const resume = useCallback(() => {
    // 방금 보여 준 번호를 물린 것으로 기록한다. 그래야 같은 라벨을
    // 비추고 있어도 확인 화면이 다시 뜨지 않는다.
    if (result?.serial) {
      rejectedRef.current.add(result.serial)
      setRejectedSerial(result.serial)
    }
    setResult(null)
    setSelected(null)
    setError(null)
    setMode('live')
  }, [result])

  const { device: registered, loading: lookupLoading } = useDevice(selected ?? undefined)
  const { devices } = useDevices()

  // 스페이스바: 확인 화면에서는 승인, 실시간에서는 수동 인식
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName)) return
      e.preventDefault()
      if (mode === 'confirm' && selected) {
        navigate(`/result/${encodeURIComponent(selected)}`)
      } else if (!busy) {
        void manualScan()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selected, busy, manualScan, navigate])

  const hint = live && !live.autoCapture ? autoReasonToMessage(live) : ''

  return (
    <Layout
      step={1}
      title={mode === 'confirm' ? t('scan.confirmTitle') : t('scan.title')}
      subtitle={mode === 'confirm' ? t('scan.confirmSubtitle') : t('scan.subtitle')}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <CameraStream frozenFrame={mode === 'confirm' ? (result?.frame ?? null) : null} />

        <div className="flex flex-col gap-4">
          {mode === 'live' ? (
            <>
              {/* --- 스캔 중 상태 --- */}
              <div className="dx-card p-5">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dx-cyan opacity-60" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-dx-cyan" />
                  </span>
                  <span className="font-semibold">{t('scan.live')}</span>
                </div>

                <p className="mt-3 text-sm text-dx-muted">
                  <code className="font-mono text-dx-text">S/N:</code>{' '}
                  <code className="font-mono text-dx-text">SN:</code>{' '}
                  <code className="font-mono text-dx-text">SERIAL:</code>{' '}
                  <code className="font-mono text-dx-text">序列号:</code>{' '}
                  {t('scan.rule', {
                    threshold: live ? (live.autoConfidence * 100).toFixed(0) : 90,
                  })}
                </p>

                {rejectedSerial ? (
                  <p className="mt-2 text-sm text-dx-amber">
                    {t('scan.rejected', { serial: rejectedSerial })}
                  </p>
                ) : (
                  hint && <p className="mt-2 text-sm text-dx-amber">{hint}</p>
                )}
              </div>

              {live && live.perf && <PerfBadges perf={live.perf} />}

              {live && live.rawTexts.length > 0 && (
                <div className="dx-card p-4">
                  <p className="dx-label mb-2">{t('scan.readingNow')}</p>
                  <ul className="space-y-1">
                    {live.rawTexts.slice(0, 6).map((t, i) => (
                      <li key={`${t}-${i}`} className="truncate font-mono text-sm text-dx-text">
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={() => void manualScan()}
                disabled={busy}
                className="dx-btn-ghost w-full"
              >
                {busy ? t('scan.manualBusy') : t('scan.manual')}
              </button>
            </>
          ) : (
            <>
              {/* --- 확인 --- */}
              <div className="dx-card border-dx-cyan/40 p-5">
                <p className="dx-label mb-1">{t('scan.recognized')}</p>
                <p className="font-mono text-3xl font-bold tracking-wide text-dx-cyan">
                  {selected}
                </p>
                <p className="mt-2 text-sm text-dx-muted">
                  {t('scan.confidence')}{' '}
                  <span className="font-mono text-dx-text">
                    {result ? (result.confidence * 100).toFixed(1) : '—'}%
                  </span>
                  {result?.candidates[0]?.prefix && (
                    <> · {t('scan.marker')} {result.candidates[0].prefix}</>
                  )}
                </p>

                <p className="mt-2 text-sm">
                  {lookupLoading ? (
                    <span className="text-dx-muted">{t('scan.checking')}</span>
                  ) : registered ? (
                    <span className="text-dx-green">
                      {t('scan.registered', { model: registered.model })}
                    </span>
                  ) : (
                    <span className="text-dx-amber">{t('scan.unregistered')}</span>
                  )}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => selected && navigate(`/result/${encodeURIComponent(selected)}`)}
                  className="dx-btn-primary w-full py-4 text-lg"
                >
                  {t('scan.accept')}
                </button>
                <button type="button" onClick={resume} className="dx-btn-ghost w-full">
                  {t('scan.reject')}
                </button>
                {!lookupLoading && !registered && selected && (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/register?serial=${encodeURIComponent(selected)}`)
                    }
                    className="dx-btn-ghost w-full"
                  >
                    {t('scan.registerThis')}
                  </button>
                )}
              </div>

              {result && result.candidates.length > 1 && (
                <SerialCandidates
                  candidates={result.candidates}
                  selected={selected}
                  onSelect={setSelected}
                />
              )}

              {result && <PerfBadges perf={result.perf} />}

              {result && result.rawTexts.length > 0 && (
                <details className="dx-card p-4">
                  <summary className="cursor-pointer text-sm text-dx-muted">
                    {t('scan.rawTexts', { count: result.rawTexts.length })}
                  </summary>
                  <ul className="mt-3 space-y-1">
                    {result.rawTexts.map((t, i) => (
                      <li key={`${t}-${i}`} className="font-mono text-sm text-dx-text">
                        {t}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {error && (
            <div className="rounded-xl border border-dx-red/40 bg-dx-red/10 p-4 text-sm text-dx-red">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/register')}
            className="dx-btn-ghost w-full"
          >
            {t('scan.preRegister')}
          </button>

          <details className="dx-card p-4">
            <summary className="cursor-pointer text-sm text-dx-muted">
              {t('scan.demoPick', { count: devices.length })}
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {devices.map((d) => (
                <button
                  key={d.serial}
                  type="button"
                  onClick={() => navigate(`/result/${encodeURIComponent(d.serial)}`)}
                  className="rounded-lg border border-dx-border bg-dx-surface px-3 py-1.5 font-mono text-xs hover:border-dx-cyanDim"
                >
                  {d.serial}
                </button>
              ))}
              <button
                type="button"
                onClick={() => navigate('/devices')}
                className="rounded-lg border border-dx-border px-3 py-1.5 text-xs text-dx-muted hover:text-dx-cyan"
              >
                {t('scan.manageDevices')}
              </button>
            </div>
          </details>
        </div>
      </div>
    </Layout>
  )
}
