import { Link, useParams } from 'react-router-dom'
import DeviceInfoCard from '../components/DeviceInfoCard'
import Layout from '../components/Layout'
import { useDevice } from '../hooks/useDevice'
import { useI18n } from '../i18n'

/**
 * QR 을 찍은 휴대폰이 도착하는 화면. 모바일 우선 레이아웃이다.
 * 기기 정보는 서버 레지스트리에서 조회하므로 등록한 PC 가 아니어도 보인다.
 */
export default function DevicePage() {
  const { serial = '' } = useParams()
  const { device, loading, error } = useDevice(serial)
  const { t } = useI18n()

  const title = loading
    ? t('device.titleLoading')
    : device
      ? t('device.title')
      : t('device.titleUnknown')
  const subtitle = loading
    ? t('device.subtitleLoading')
    : device
      ? t('device.subtitle')
      : t('device.subtitleUnknown')

  return (
    <Layout step={3} title={title} subtitle={subtitle}>
      <div className="mx-auto max-w-xl space-y-4">
        {loading && <div className="dx-card h-64 animate-pulse" />}

        {!loading && error && (
          <div className="rounded-xl border border-dx-red/40 bg-dx-red/10 p-4 text-sm text-dx-red">
            {error}
          </div>
        )}

        {!loading && !error && device && <DeviceInfoCard device={device} />}

        {!loading && !error && !device && (
          <div className="dx-card p-6 text-center">
            <p className="dx-label">{t('device.queried')}</p>
            <p className="mt-1 break-all font-mono text-xl font-bold text-dx-cyan">{serial}</p>
            <p className="mt-4 text-sm text-dx-muted">{t('device.notFound')}</p>
            <Link
              to={`/register?serial=${encodeURIComponent(serial)}`}
              className="dx-btn-primary mt-5 w-full"
            >
              {t('device.registerThis')}
            </Link>
          </div>
        )}

        <Link to="/" className="dx-btn-ghost w-full">
          {t('device.scanNew')}
        </Link>
      </div>
    </Layout>
  )
}
