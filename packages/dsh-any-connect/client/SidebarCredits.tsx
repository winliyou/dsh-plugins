/** Sidebar footer badge: live WorkBuddy credit total, polled quietly. */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WORKBUDDY_STATUS_PATH } from '../src/status-paths.js'
import type { WorkBuddyWebStatus } from '../src/status-paths.js'
import type { WorkBuddyPluginCardInjected } from './WorkBuddyPluginCard.js'

const POLL_INTERVAL_MS = 120_000

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 9px',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value)
}

/**
 * Compact credit total for the sidebar footer. Renders nothing until the
 * status route reports a signed-in account with credit data, so users without
 * a WorkBuddy sign-in never see a dead widget. Polls slower than the settings
 * card (the badge is ambient information, not a live meter), and the host
 * collapse state (`wide`) decides between the full copy and the bare number.
 */
export function SidebarCredits({ t, wide }: PropsRuntime<'sidebar.footer.action'> & Partial<WorkBuddyPluginCardInjected>) {
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

  // 无 t（宿主未注入翻译座）或未登录/无额度数据：安静地不渲染，侧栏 footer
  // 是全局区域，不能给没有 WorkBuddy 登录的用户留一个死部件。
  if (t === undefined || total === undefined) return null
  return (
    <span style={badgeStyle} title={t('creditsHeading')}>
      <span aria-hidden="true">⚡</span>
      {wide === false
        ? formatNumber(total)
        : t('sidebarCredits', { total: formatNumber(total) })}
    </span>
  )
}
