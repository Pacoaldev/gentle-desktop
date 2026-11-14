import type { ProviderChoice } from '../../../shared/ipc.ts'

/** One pickable model: the stored `provider/id` pair, and the words the row shows. */
export interface ModelOption {
  value: string
  label: string
}

/**
 * The models the engine can actually use right now, flattened from the providers it
 * reports. Only ready providers with models appear: a provider the engine does not
 * report models for cannot be picked, and picking it would only fail at session start.
 * The stored value is the `provider/id` pair the engine expects; the label names the
 * provider and the model's own name when it has one. The list is sorted by provider,
 * then label, and the same pair twice is one option.
 */
export function modelOptions(providers: readonly ProviderChoice[]): ModelOption[] {
  const options: ModelOption[] = []
  for (const provider of providers) {
    if (!provider.ready || provider.models.length === 0) continue
    for (const model of provider.models) {
      const value = `${provider.id}/${model.id}`
      if (options.some((option) => option.value === value)) continue
      options.push({ value, label: `${provider.id} — ${model.name ?? model.id}` })
    }
  }
  return options.sort((left, right) => {
    const leftProvider = left.value.slice(0, left.value.indexOf('/'))
    const rightProvider = right.value.slice(0, right.value.indexOf('/'))
    return leftProvider.localeCompare(rightProvider) || left.label.localeCompare(right.label)
  })
}

/** Why an agent model change is safe to make any time. */
export function agentNote(): string {
  return 'Applies to the next session.'
}

/** Why the orchestrator is different: its change reaches the running session too. */
export function orchestratorNote(): string {
  return 'Applies live, and to the next session.'
}
