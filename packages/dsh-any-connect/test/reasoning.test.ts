import { describe, expect, it } from 'vitest'
import { reasoningFields } from '../src/adapter.js'
import type { WorkBuddyModelInfo } from '../src/upstream.js'

/**
 * Per-model thinking-level resolution. The DSH picker offers exactly what
 * this map enables, so its shape is the user-facing "可用思考强度" contract:
 * declared sets are honored per-model, and rows without a declared set run at
 * their built-in default only (the upstream ignores the effort field for
 * them — offering more would advertise control that does not exist).
 */
describe('reasoningFields', () => {
  function model(reasoning: WorkBuddyModelInfo['reasoning']): WorkBuddyModelInfo {
    return {
      id: 'm',
      name: 'M',
      contextWindow: 1000,
      maxTokens: 100,
      supportsImages: false,
      ...(reasoning === undefined ? {} : { reasoning }),
    } as WorkBuddyModelInfo
  }

  it('offers exactly the declared set for a new-form model', () => {
    const { reasoning, thinkingLevelMap } = reasoningFields(model({
      supports: true,
      onlyReasoning: true,
      supportedEfforts: ['low', 'high', 'xhigh'],
      defaultEffort: 'high',
      canDisableThinking: true,
    }))
    expect(reasoning).toBe(true)
    expect(thinkingLevelMap).toEqual({
      off: 'off',
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: 'xhigh',
      max: null,
    })
  })

  it('offers only the default effort for an old-form model (wire value is ignored)', () => {
    const { thinkingLevelMap } = reasoningFields(model({
      supports: true,
      onlyReasoning: true,
      defaultEffort: 'medium',
      canDisableThinking: false,
    }))
    expect(thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: null,
      medium: 'medium',
      high: null,
      xhigh: null,
      max: null,
    })
  })

  it('falls back to high for an old-form model with no default declared', () => {
    const { thinkingLevelMap } = reasoningFields(model({
      supports: true,
      onlyReasoning: true,
      canDisableThinking: false,
    }))
    expect(thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: 'high',
      xhigh: null,
      max: null,
    })
  })

  it('a non-reasoning model reports no thinking at all', () => {
    expect(reasoningFields(model(undefined))).toEqual({ reasoning: false })
  })
})
