/**
 * client 语言注册表实现：同步快照（Map + 监听器集合），React 可经
 * useSyncExternalStore 读取（与 better-sidebar 注册表同模式）。重复注册
 * 同 id 抛错（防语言插件二次激活），disposer 由 fiber 卸载调用。
 */

import type { LanguageDescriptor, LspRegistryService } from './types.ts'

export function createLspRegistry(): LspRegistryService {
  const descriptors = new Map<string, LanguageDescriptor>()
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    register(descriptor) {
      if (descriptors.has(descriptor.id)) {
        throw new Error(`[dsh-lsp-core] language "${descriptor.id}" already registered`)
      }
      descriptors.set(descriptor.id, descriptor)
      emit()
      return () => {
        if (descriptors.get(descriptor.id) === descriptor) {
          descriptors.delete(descriptor.id)
          emit()
        }
      }
    },
    get(id) {
      return descriptors.get(id)
    },
    match(path) {
      const ext = (path.split('.').pop() ?? '').toLowerCase()
      for (const descriptor of descriptors.values()) {
        if (descriptor.extensions.includes(ext)) return descriptor
      }
      return undefined
    },
    list() {
      return [...descriptors.values()]
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
