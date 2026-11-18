<script setup lang="ts">
import { ref, onMounted, computed, type Component } from "vue";
import { usePluginRegistryStore } from "@/shell/plugin-host/registry";
import { useWorkspaceStore } from "@/stores/workspace";
import { useTargetStore } from "@/stores/target";

const registry = usePluginRegistryStore();
const wsStore = useWorkspaceStore();
const targetStore = useTargetStore();

const isReady = ref(false);

const vncComponent = computed<Component | null>(() => {
  if (!registry.isLoaded) return null;
  return registry.blockRenderer("system.quick-actions", "quick-actions");
});

const lapsComponent = computed<Component | null>(() => {
  if (!registry.isLoaded) return null;
  return registry.blockRenderer("system.laps", "view");
});

const ldapComponent = computed<Component | null>(() => {
  if (!registry.isLoaded) return null;
  return registry.blockRenderer("system.ldap", "user-card");
});

const smbComponent = computed<Component | null>(() => {
  if (!registry.isLoaded) return null;
  return registry.blockRenderer("system.smb", "shares");
});

onMounted(async () => {
  const ws = wsStore.createWorkspace("Администрирование ПК");
  wsStore.setActiveWorkspace(ws.id);
  targetStore.setTarget(ws.id, {
    raw: "pc2345.corp.local",
    host: "pc2345.corp.local",
    ip: "10.0.12.45",
    status: "online",
    responseTimeMs: 12,
    lastChecked: new Date().toISOString(),
  });

  // Инициализируем реестр плагинов (загружает и компилирует все системные плагины)
  await registry.init();
  isReady.value = true;
});
</script>

<template>
  <div class="demo-wrapper">
    <!-- Верхний бар демонстрации -->
    <header class="demo-header">
      <div class="demo-title-group">
        <div class="demo-badge">Шаг 14</div>
        <h1 class="demo-title">TMAdmin · Системные плагины (VNC, LAPS, LDAP, SMB)</h1>
      </div>

      <div class="target-badge-pill">
        <span class="status-dot"></span>
        <span class="target-name">pc2345.corp.local</span>
        <span class="target-ip">10.0.12.45</span>
        <span class="target-rtt">12 мс</span>
      </div>

      <div class="meta-plugins">
        <span class="meta-tag">system.quick-actions</span>
        <span class="meta-tag">system.laps</span>
        <span class="meta-tag">system.ldap</span>
        <span class="meta-tag">system.smb</span>
      </div>
    </header>

    <!-- Сетка 2x2 со всеми 4 блоками -->
    <main v-if="isReady" class="demo-grid">
      <!-- Блок 1: VNC / Quick Actions -->
      <section class="block-card">
        <div class="block-card-header">
          <div class="header-left">
            <span class="block-id-tag">system.quick-actions:quick-actions</span>
            <span class="block-title">Быстрые действия</span>
          </div>
          <span class="block-perm-tag">process.exec, keychain</span>
        </div>
        <div class="block-card-body">
          <component :is="vncComponent" />
        </div>
      </section>

      <!-- Блок 2: LAPS Password -->
      <section class="block-card">
        <div class="block-card-header">
          <div class="header-left">
            <span class="block-id-tag">system.laps:view</span>
            <span class="block-title">Пароль LAPS (Local Admin)</span>
          </div>
          <span class="block-perm-tag">ldap.query, keychain</span>
        </div>
        <div class="block-card-body">
          <component :is="lapsComponent" />
        </div>
      </section>

      <!-- Блок 3: Active Directory LDAP Card -->
      <section class="block-card">
        <div class="block-card-header">
          <div class="header-left">
            <span class="block-id-tag">system.ldap:user-card</span>
            <span class="block-title">Объект Active Directory</span>
          </div>
          <span class="block-perm-tag">ldap.query, store.write</span>
        </div>
        <div class="block-card-body">
          <component :is="ldapComponent" />
        </div>
      </section>

      <!-- Блок 4: SMB Shares & Printers -->
      <section class="block-card">
        <div class="block-card-header">
          <div class="header-left">
            <span class="block-id-tag">system.smb:shares</span>
            <span class="block-title">Принтеры и сетевые ресурсы</span>
          </div>
          <span class="block-perm-tag">process.exec, terminal</span>
        </div>
        <div class="block-card-body">
          <component :is="smbComponent" />
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.demo-wrapper {
  padding: 18px 24px;
  background-color: #101014;
  min-height: 100vh;
  box-sizing: border-box;
  font-family: inherit;
}

.demo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.demo-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.demo-badge {
  background: #63e2b7;
  color: #0c1c14;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.demo-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.target-badge-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(99, 226, 183, 0.12);
  border: 1px solid rgba(99, 226, 183, 0.35);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #63e2b7;
  box-shadow: 0 0 8px #63e2b7;
}

.target-name {
  font-family: monospace;
  font-weight: 600;
  color: #63e2b7;
}

.target-ip {
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
}

.target-rtt {
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
}

.meta-plugins {
  display: flex;
  gap: 6px;
}

.meta-tag {
  font-size: 11px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
  font-family: monospace;
}

.demo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.block-card {
  background: #18181c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  height: 380px;
}

.block-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.block-id-tag {
  font-family: monospace;
  color: #63e2b7;
  font-weight: 600;
  font-size: 11px;
}

.block-title {
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
}

.block-perm-tag {
  color: rgba(255, 255, 255, 0.4);
  font-family: monospace;
  font-size: 10px;
}

.block-card-body {
  flex: 1;
  padding: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
