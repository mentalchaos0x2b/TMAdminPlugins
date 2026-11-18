<script setup lang="ts">
import { ref, onMounted, computed, type Component } from "vue";
import { usePluginRegistryStore } from "@/shell/plugin-host/registry";
import { useWorkspaceStore } from "@/stores/workspace";
import { useTargetStore } from "@/stores/target";
import { useDataStore } from "@/stores/data";

const registry = usePluginRegistryStore();
const wsStore = useWorkspaceStore();
const targetStore = useTargetStore();
const dataStore = useDataStore();

const isReady = ref(false);

const infoComponent = computed<Component | null>(() => {
  if (!registry.isLoaded) return null;
  return registry.blockRenderer("system.network", "info");
});

const pingChartComponent = computed<Component | null>(() => {
  if (!registry.isLoaded) return null;
  return registry.blockRenderer("system.network", "ping-chart");
});

const networkPlugin = computed(() => registry.getPlugin("system.network"));

onMounted(async () => {
  const ws = wsStore.createWorkspace("Сетевой мониторинг");
  wsStore.setActiveWorkspace(ws.id);
  targetStore.setTarget(ws.id, {
    raw: "srv-dc01.corp.local",
    host: "srv-dc01.corp.local",
    ip: "10.0.10.1",
    status: "online",
    responseTimeMs: 14,
    lastChecked: new Date().toISOString(),
  });

  // Заполняем постоянную заметку устройства для демонстрации
  await dataStore.set(
    "plugin:system.network:note_srv-dc01.corp.local",
    "Контроллер домена DC01 (AD DS / DNS) • Серверная стойка A-04 • Порт SW-CORE-01/14",
    "permanent",
  );

  await registry.init();
  isReady.value = true;
});
</script>

<template>
  <div class="demo-wrapper">
    <!-- Верхний бар -->
    <header class="demo-header">
      <div class="demo-title-group">
        <div class="demo-badge">Шаг 12</div>
        <h1 class="demo-title">TMAdmin · Системный плагин Network (`system.network`)</h1>
      </div>
      <div class="meta-tags">
        <span class="meta-tag">id: system.network</span>
        <span class="meta-tag">permissions: [net.ping, store.write]</span>
        <span class="meta-tag target">target: srv-dc01.corp.local (10.0.10.1)</span>
      </div>
    </header>

    <!-- Основной контент: блоки плагина в сетке -->
    <main v-if="isReady" class="demo-grid">
      <!-- Блок 1: Информация об узле (DeviceInfo.vue) -->
      <section class="block-container info-container">
        <div class="block-bar">
          <div class="bar-left">
            <span class="block-badge">Блок: info</span>
            <span class="block-label">DeviceInfo.vue (8x6)</span>
          </div>
          <span class="block-perm">permissions: store.write, net.ping</span>
        </div>
        <div class="block-body">
          <component :is="infoComponent" />
        </div>
      </section>

      <!-- Блок 2: График задержки (PingChart.vue) -->
      <section class="block-container chart-container">
        <div class="block-bar">
          <div class="bar-left">
            <span class="block-badge pulse">Блок: ping-chart</span>
            <span class="block-label">PingChart.vue (16x8) — Live SVG RTT</span>
          </div>
          <span class="block-perm">permissions: net.ping, store.write</span>
        </div>
        <div class="block-body">
          <component :is="pingChartComponent" />
        </div>
      </section>
    </main>

    <!-- Подвал с метаданными манифеста -->
    <footer v-if="networkPlugin" class="demo-footer">
      <div class="manifest-info">
        <span class="manifest-label">Манифест:</span>
        <code>{{ networkPlugin.manifest.name }} v{{ networkPlugin.manifest.version }} — {{ networkPlugin.manifest.description }}</code>
      </div>
      <div class="blocks-summary">
        Зарегистрировано блоков: <b>{{ networkPlugin.manifest.blocks.length }}</b> (info, ping-chart)
      </div>
    </footer>
  </div>
</template>

<style scoped>
.demo-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  background-color: #101014;
  color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 24px;
  gap: 20px;
}

.demo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-wrap: wrap;
  gap: 12px;
}

.demo-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.demo-badge {
  background: #18a058;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 4px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.demo-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #f0f6fc;
}

.meta-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-tag {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #8b949e;
}

.meta-tag.target {
  background: rgba(24, 160, 88, 0.12);
  border-color: rgba(24, 160, 88, 0.35);
  color: #18a058;
  font-weight: 600;
}

.demo-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
  align-items: stretch;
}

.block-container {
  display: flex;
  flex-direction: column;
  background: #18181c;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.block-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
}

.bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.block-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
  border: 1px solid rgba(88, 166, 255, 0.3);
}

.block-badge.pulse {
  background: rgba(24, 160, 88, 0.15);
  color: #18a058;
  border-color: rgba(24, 160, 88, 0.3);
}

.block-label {
  color: #8b949e;
  font-weight: 500;
}

.block-perm {
  color: #8b949e;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.block-body {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
}

.demo-footer {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #8b949e;
}

.manifest-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.manifest-label {
  font-weight: 600;
  color: #f0f6fc;
}

code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

b {
  color: #18a058;
}
</style>
