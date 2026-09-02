/** General-settings row: WorkBuddy remaining credit, refreshed quietly. */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WORKBUDDY_STATUS_PATH } from '../src/status-paths.js'
import type { WorkBuddyWebStatus } from '../src/status-paths.js'
import type { WorkBuddyPluginCardInjected } from './WorkBuddyPluginCard.js'

const POLL_INTERVAL_MS = 120_000

/**
 * The General section stacks preference rows and each row draws its own
 * internals (its slot contract says so); these styles follow the section's
 * visual language — separated by a hairline, label in the primary tone and
 * the value right-aligned in the secondary tone.
 */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 0',
  borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
}
const labelStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
}
const valueStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: '20px',
  fontVariantNumeric: 'tabular-nums',
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value)
}

/**
 * One General-settings row showing the WorkBuddy credit total. Renders
 * nothing until the status route reports a signed-in account with credit
 * data, so users without a WorkBuddy sign-in never see an empty row. The
 * full breakdown (per-package bars, model offers) stays on the plugin card
 * in 设置 → 插件.
 */
export function GeneralCreditsRow({ t }: PropsRuntime<'settings.general.item'> & Partial<WorkBuddyPluginCardInjected>) {
  const [total, setTotal] = useState<number | undefined>(undefined)

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(WORKBUDDY_STATUS_PATH, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          signal: controller.signal,
        })
        const value: unknown = await response.json().catch(() => undefined)
        if (disposed || controller.signal.aborted) return
        const status = value as WorkBuddyWebStatus
        setTotal(status.status === 'signed-in' && status.credits !== undefined && status.credits.total > 0
          ? status.credits.total
          : undefined)
      } catch {
        if (!disposed && !controller.signal.aborted) setTotal(undefined)
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  if (t === undefined || total === undefined) return null
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{t('generalCreditsLabel')}</span>
      <span style={valueStyle}>{formatNumber(total)}</span>
    </div>
  )
}
