import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LANGS, LANG_LABEL, LANG_SHORT, useI18n } from '../i18n'

interface Props {
  title: string
  subtitle?: string
  step?: 1 | 2 | 3
  children: ReactNode
}

export default function Layout({ title, subtitle, step, children }: Props) {
  const { t, lang, setLang } = useI18n()
  const steps = [t('step.scan'), t('step.qr'), t('step.lookup')]

  return (
    <div className="min-h-full bg-dx-bg">
      <header className="border-b border-dx-border bg-dx-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-dx-cyan">DEEPX</span>
            <span className="text-sm text-dx-muted">{t('app.name')}</span>
          </Link>

          <Link
            to="/devices"
            className="text-sm text-dx-muted transition-colors hover:text-dx-cyan"
          >
            {t('nav.devices')}
          </Link>

          {step && (
            <ol className="ml-auto flex items-center gap-2 text-xs">
              {steps.map((label, i) => {
                const n = (i + 1) as 1 | 2 | 3
                const active = n === step
                const done = n < step
                return (
                  <li key={label} className="flex items-center gap-2">
                    <span
                      className={[
                        'flex items-center gap-2 rounded-full px-3 py-1.5 font-medium',
                        active
                          ? 'bg-dx-cyan text-dx-bg'
                          : done
                            ? 'bg-dx-cyan/15 text-dx-cyan'
                            : 'bg-dx-card text-dx-muted',
                      ].join(' ')}
                    >
                      <span className="tabular-nums">{done ? '✓' : n}</span>
                      {label}
                    </span>
                    {n < 3 && <span className="text-dx-border">→</span>}
                  </li>
                )
              })}
            </ol>
          )}

          {/* 언어 전환. step 이 없는 화면에서는 이 요소가 오른쪽 끝을 차지한다. */}
          <div
            className={[
              'flex items-center gap-1 rounded-lg border border-dx-border bg-dx-card p-0.5',
              step ? '' : 'ml-auto',
            ].join(' ')}
          >
            {LANGS.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                title={LANG_LABEL[code]}
                aria-label={LANG_LABEL[code]}
                aria-pressed={lang === code}
                className={[
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  lang === code
                    ? 'bg-dx-cyan text-dx-bg'
                    : 'text-dx-muted hover:text-dx-text',
                ].join(' ')}
              >
                {LANG_SHORT[code]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-dx-muted">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  )
}
