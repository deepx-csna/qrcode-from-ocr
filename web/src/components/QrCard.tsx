import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { useI18n } from '../i18n'

interface Props {
  url: string
  serial: string
  /** 인쇄 라벨에 함께 찍을 부가 정보 (모델명 등) */
  caption?: string
}

export default function QrCard({ url, serial, caption }: Props) {
  const { t } = useI18n()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, {
      width: 640, // 인쇄 시 뭉개지지 않도록 화면 표시보다 크게 뽑는다
      margin: 2,
      errorCorrectionLevel: 'M',
      // 휴대폰 카메라 인식률을 위해 QR 자체는 항상 밝은 배경으로 그린다.
      color: { dark: '#0a0e14', light: '#ffffff' },
    })
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <>
      <div className="dx-card flex flex-col items-center gap-4 p-6">
        <div className="rounded-xl bg-white p-3">
          {dataUrl ? (
            <img src={dataUrl} alt={`${serial} QR`} className="block h-80 w-80" />
          ) : (
            <div className="h-80 w-80 animate-pulse bg-dx-border/40" />
          )}
        </div>

        <div className="w-full text-center">
          <p className="dx-label mb-1">{t('result.qrUrl')}</p>
          {/* 휴대폰이 없거나 QR 인식이 안 될 때를 위해 URL 을 그대로 노출한다 */}
          <p className="break-all font-mono text-sm text-dx-text">{url}</p>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={!dataUrl}
          className="dx-btn-ghost w-full py-2 text-sm"
        >
          {t('result.print')}
        </button>

        <p className="text-center text-xs text-dx-muted">{t('result.hint')}</p>

        {error && <p className="text-sm text-dx-red">{error}</p>}
      </div>

      {/*
        인쇄 전용 라벨. 화면에서는 숨겨져 있고 @media print 에서만 보인다.
        앱은 다크 테마라 그대로 인쇄하면 잉크만 먹으므로, 기기에 붙일 수 있는
        흑백 라벨을 따로 그린다.

        #root 밖(document.body)에 붙인다. 인쇄할 때 #root 를 통째로
        display:none 하면 앱 콘텐츠가 차지하던 지면이 사라져 빈 페이지가
        딸려 나오지 않는다.
      */}
      {createPortal(
        <div className="print-area">
          <div className="print-label">
            <div className="print-brand">DEEPX</div>
            {dataUrl && <img src={dataUrl} alt="" className="print-qr" />}
            <div className="print-serial">{serial}</div>
            {caption && <div className="print-caption">{caption}</div>}
            <div className="print-url">{url}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
