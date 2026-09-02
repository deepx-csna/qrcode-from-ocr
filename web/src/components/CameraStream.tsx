import { useEffect, useRef, useState } from 'react'
import { STREAM_URL } from '../lib/api'
import { useI18n } from '../i18n'

/**
 * C++ 서버가 보내는 MJPEG 스트림을 그대로 <img> 로 받는다.
 * 브라우저 카메라(getUserMedia)를 쓰지 않으므로 HTTPS 가 필요 없다.
 */
export default function CameraStream({ frozenFrame }: { frozenFrame?: string | null }) {
  const { t } = useI18n()
  const imgRef = useRef<HTMLImageElement>(null)
  const [error, setError] = useState(false)
  // 스트림을 재시작할 때 캐시를 우회하기 위한 캐시버스터
  const [nonce, setNonce] = useState(() => Date.now())

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => {
      setError(false)
      setNonce(Date.now())
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [error])

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-dx-border bg-black">
      {frozenFrame ? (
        <img
          src={`data:image/jpeg;base64,${frozenFrame}`}
          alt={t('camera.frozenAlt')}
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          ref={imgRef}
          src={`${STREAM_URL}?t=${nonce}`}
          alt={t('camera.liveAlt')}
          className="h-full w-full object-cover"
          onError={() => setError(true)}
        />
      )}

      {/* 라벨 정렬 가이드 — OCR 이 보는 영역과 화면이 1:1 로 일치한다 */}
      {!frozenFrame && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[28%] w-[78%] rounded-lg border-2 border-dashed border-dx-cyan/70">
            <span className="absolute -top-7 left-0 rounded bg-dx-cyan/90 px-2 py-0.5 text-xs font-semibold text-dx-bg">
              {t('camera.guide')}
            </span>
          </div>
        </div>
      )}

      {frozenFrame && (
        <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs font-medium text-dx-text">
          {t('camera.frozen')}
        </span>
      )}

      {error && !frozenFrame && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-dx-bg/90 p-6 text-center">
          <p className="font-semibold text-dx-red">{t('camera.error.title')}</p>
          <p className="text-sm text-dx-muted">{t('camera.error.body')}</p>
        </div>
      )}
    </div>
  )
}
