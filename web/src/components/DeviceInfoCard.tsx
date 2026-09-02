import type { DeviceInfo, QaStatus } from '../data/devices'
import { useI18n } from '../i18n'

const QA_STYLE: Record<QaStatus, string> = {
  PASS: 'bg-dx-green/15 text-dx-green border-dx-green/30',
  PENDING: 'bg-dx-amber/15 text-dx-amber border-dx-amber/30',
  FAIL: 'bg-dx-red/15 text-dx-red border-dx-red/30',
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dx-border/60 py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-dx-muted">{label}</dt>
      <dd className={`text-right text-sm font-medium ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

export default function DeviceInfoCard({ device }: { device: DeviceInfo }) {
  const { t } = useI18n()

  return (
    <div className="dx-card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="dx-label">{t('field.serial')}</p>
          <p className="font-mono text-xl font-bold tracking-wide text-dx-cyan">
            {device.serial}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${QA_STYLE[device.qaStatus]}`}
        >
          {t(`qa.${device.qaStatus}`)}
        </span>
      </div>

      <dl>
        <Row label={t('field.model')} value={device.model} />
        <Row label={t('field.npu')} value={device.npu} />
        <Row label={t('field.hwRevision')} value={device.hwRevision} />
        <Row label={t('field.firmware')} value={device.firmware} mono />
        <Row label={t('field.macAddress')} value={device.macAddress} mono />
        <Row label={t('field.manufacturedAt')} value={device.manufacturedAt} mono />
        <Row label={t('field.warrantyUntil')} value={device.warrantyUntil} mono />
        <Row label={t('field.deployedSite')} value={device.deployedSite} />
      </dl>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          { label: t('spec.tops'), value: `${device.specs.tops}`, unit: 'TOPS' },
          { label: t('spec.memory'), value: `${device.specs.memoryGb}`, unit: 'GB' },
          { label: t('spec.power'), value: `${device.specs.powerW}`, unit: 'W' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-dx-border bg-dx-surface p-3">
            <p className="dx-label">{s.label}</p>
            <p className="mt-1">
              <span className="font-mono text-xl font-bold text-dx-text">{s.value}</span>
              <span className="ml-1 text-xs text-dx-muted">{s.unit}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
