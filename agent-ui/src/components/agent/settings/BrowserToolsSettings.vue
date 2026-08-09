<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bot, Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const status = ref<DesktopBrowserToolsStatus | null>(null)
const bridgeAvailable = ref(false)
const switching = ref(false)
const localError = ref('')
let removeListener: (() => void) | null = null

const statusKey = computed(() => {
  if (localError.value || status.value?.error) return 'error'
  return status.value?.state ?? 'disabled'
})

function desktopBridge(): HomeRailDesktopBridge | null {
  return typeof window === 'undefined' ? null : window.homerailDesktop ?? null
}

async function toggle(): Promise<void> {
  const bridge = desktopBridge()
  if (!bridge?.setBrowserToolsEnabled || switching.value || !status.value) return
  switching.value = true
  localError.value = ''
  try {
    status.value = await bridge.setBrowserToolsEnabled(!status.value.enabled)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  } finally {
    switching.value = false
  }
}

onMounted(() => {
  const bridge = desktopBridge()
  bridgeAvailable.value = Boolean(
    bridge?.browserToolsStatus && bridge?.setBrowserToolsEnabled,
  )
  if (!bridgeAvailable.value || !bridge?.browserToolsStatus) return
  removeListener = bridge.onBrowserToolsStatus?.((nextStatus) => {
    status.value = nextStatus
  }) ?? null
  void bridge.browserToolsStatus()
    .then((nextStatus) => {
      status.value = nextStatus
    })
    .catch((error) => {
      localError.value = error instanceof Error ? error.message : String(error)
    })
})

onBeforeUnmount(() => {
  removeListener?.()
  removeListener = null
})
</script>

<template>
  <div
    v-if="bridgeAvailable"
    class="rounded-2xl border border-[var(--hr-settings-divider)] bg-[var(--hr-settings-card)] p-5"
    data-testid="desktop-browser-tools-settings"
  >
    <div class="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--hr-border)] bg-[var(--hr-surface-1)] text-[var(--hr-accent)]"
        >
          <Loader2 v-if="switching" class="h-5 w-5 animate-spin" />
          <Bot v-else class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold text-[var(--hr-text-1)]">
              {{ t('settings.experimental.browserTools.title') }}
            </h3>
            <span
              class="rounded-full border border-[var(--hr-warning-border)] bg-[var(--hr-warning-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--hr-warning)]"
            >
              {{ t('settings.experimental.badge') }}
            </span>
          </div>
          <p class="mt-1 max-w-2xl text-sm leading-6 text-[var(--hr-text-3)]">
            {{ t('settings.experimental.browserTools.description') }}
          </p>
          <p
            v-if="status || localError"
            class="mt-2 text-xs leading-5"
            :class="statusKey === 'error' || statusKey === 'unavailable'
              ? 'text-[var(--hr-danger)]'
              : statusKey === 'connected'
                ? 'text-[var(--hr-success)]'
                : 'text-[var(--hr-text-3)]'"
            data-testid="desktop-browser-tools-state"
          >
            {{ t(`settings.experimental.browserTools.state.${statusKey}`) }}
            <span v-if="localError || status?.error">：{{ localError || status?.error }}</span>
          </p>
        </div>
      </div>

      <div class="inline-flex flex-shrink-0 items-center gap-3 sm:pl-4">
        <span
          class="text-xs font-medium"
          :class="status?.enabled ? 'text-[var(--hr-info)]' : 'text-[var(--hr-text-3)]'"
        >
          {{ status?.enabled ? t('settings.actions.enabled') : t('settings.actions.disabled') }}
        </span>
        <button
          data-testid="desktop-browser-tools-toggle"
          type="button"
          role="switch"
          class="relative h-7 w-12 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60"
          :class="status?.enabled
            ? 'border-[var(--hr-info-border)] bg-[var(--hr-info)]'
            : 'border-[var(--hr-border-strong)] bg-[var(--hr-surface-2)]'"
          :aria-checked="status?.enabled ?? false"
          :aria-label="t('settings.experimental.browserTools.title')"
          :disabled="switching || !status"
          @click="toggle"
        >
          <span
            class="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform"
            :class="status?.enabled ? 'translate-x-5' : 'translate-x-0'"
          />
        </button>
      </div>
    </div>
  </div>
</template>
