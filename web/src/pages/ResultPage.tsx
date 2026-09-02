import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DeviceInfoCard from '../components/DeviceInfoCard'
import Layout from '../components/Layout'
import QrCard from '../components/QrCard'
import { buildDeviceUrl, fetchConfig, type ServerConfig } from '../lib/api'
import { useDevice } from '../hooks/useDevice'
import { useI18n } from '../i18n'

export default function ResultPage() {
  const { serial = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [configError, setConfigError] = useState(false)
  const { device, loading } = useDevice(serial)

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => setConfigError(true))
  }, [])

  const url = buildDeviceUrl(serial, config)

  return (
    <Layout step={2} title={t('result.title')} subtitle={t('result.subtitle')}>
      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <QrCard url={url} serial={serial} caption={device?.model} />

          {configError && (
            <p className="rounded-xl border border-dx-amber/40 bg-dx-amber/10 p-3 text-xs text-dx-amber">
              {t('result.configError')}
            </p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => navigate('/')} className="dx-btn-ghost flex-1">
              {t('result.rescan')}
            </button>
            <Link to={`/device/${encodeURIComponent(serial)}`} className="dx-btn-primary flex-1">
              {t('result.openLookup')}
            </Link>
          </div>
        </div>

        <div>
          {loading && <div className="dx-card h-80 animate-pulse" />}

          {!loading && device && <DeviceInfoCard device={device} />}

          {!loading && !device && (
            <div className="dx-card p-6">
              <p className="dx-label">{t('result.serial')}</p>
              <p className="font-mono text-xl font-bold text-dx-cyan">{serial}</p>
              <p className="mt-4 text-sm text-dx-amber">{t('result.notRegistered')}</p>
              <Link
                to={`/register?serial=${encodeURIComponent(serial)}`}
                className="dx-btn-primary mt-5 w-full"
              >
                {t('result.registerNow')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
