/** Browser half: WorkBuddy account status inside Plugin configuration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { WorkBuddyPluginCard } from './WorkBuddyPluginCard.js'
import type { WorkBuddyPluginCardInjected } from './WorkBuddyPluginCard.js'
import { SidebarCredits } from './SidebarCredits.js'
import { en, zh } from './locales.js'
import type { WorkBuddySettingsKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** WorkBuddy plugin card copy. */
    'settings.anyconnect': WorkBuddySettingsKey
  }
  // Owner 声明镜像：sidebar.footer.action 的槽位契约在
  // dsh-client-ui-sidebar 的 client/contract/slots.d.ts 里，本包没有把它
  // 作为类型依赖引入，这里按其形状（kind/scope/owner: { wide }）镜像一份
  // 使注册可类型检查。若日后引入 owner 包的类型，删除本段避免重复声明。
  interface SlotMap {
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-any-connect-client'
/** Client services required by the Plugin configuration contribution. */
export const inject = ['slots', 'locale']

/**
 * Register card copy and the WorkBuddy card under Plugin configuration.
 *
 * The entire body is wrapped so that a DSH slot-API breaking change (for
 * example the rc.6→rc.7 `id`→`key` / `order`→`priority` rename) degrades
 * to a `console.error` instead of throwing into the DSH loader and raising
 * the red "Failed to load plugins" banner. The host provider keeps working:
 * the `workbuddy` model channel is unaffected, and `dsh-any-connect
 * status` reports host health via the heartbeat file.
 *
 * NOTE: the try/catch boundary of this function is mirrored (duplicated) in
 * `tests/client-fallback.spec.ts`, because the real client entry imports
 * browser-only DSH packages that cannot load in the Node test environment.
 * That test therefore does not import this function — it replicates its
 * shape. If you change the guarded body or the `console.error` message here,
 * update the mirrored `apply()` in that spec too, or the fallback test will
 * silently diverge from this real implementation.
 */
export function apply(ctx: ClientContext): void {
  try {
    const namespace = 'settings.anyconnect'
    ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-any-connect: settings copy')
    const t = ctx.locale.bind(namespace) as WorkBuddyPluginCardInjected['t']
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'anyconnect',
      priority: 30,
      inject: (): WorkBuddyPluginCardInjected => ({ t }),
    }, WorkBuddyPluginCard))
    // 主页面常驻的剩余额度徽章：侧栏底部动作位，随侧栏收起退化为纯数字。
    // footer.action 是 list 型槽位：注册字段是 id/order（keyed 槽位才是 key/priority）。
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'workbuddy-credits',
      order: 40,
      inject: (): WorkBuddyPluginCardInjected => ({ t }),
    }, SidebarCredits))
  } catch (error: unknown) {
    // Degrade silently on the page: the host provider still serves models.
    // Developers see the full cause in the browser console; users see no banner.
    console.error('[dsh-any-connect] client card failed to load (host provider unaffected):', error)
  }
}
