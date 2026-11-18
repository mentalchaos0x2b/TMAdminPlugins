<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useTarget, usePluginStore } from "@tmadmin/sdk";
import {
  NCard,
  NButton,
  NSpace,
  NTag,
  NStatistic,
  NIcon,
} from "naive-ui";
import {
  AddOutline,
  RefreshOutline,
  SparklesOutline,
  DesktopOutline,
} from "@vicons/ionicons5";
import { formatGreeting } from "../lib/greeting";

const target = useTarget();
const store = usePluginStore();

const counter = ref<number>(0);
const savedClicks = ref<number>(0);

onMounted(() => {
  const stored = store.get<number>("click_count");
  if (typeof stored === "number") {
    savedClicks.value = stored;
    counter.value = stored;
  }
});

async function increment(): Promise<void> {
  counter.value++;
  savedClicks.value = counter.value;
  await store.set("click_count", counter.value, { persist: "temp" });
}

async function reset(): Promise<void> {
  counter.value = 0;
  savedClicks.value = 0;
  await store.remove("click_count");
}

function getStatusType(status?: string): "success" | "warning" | "error" | "default" {
  switch (status) {
    case "online":
      return "success";
    case "offline":
      return "error";
    default:
      return "default";
  }
}
</script>

<template>
  <div class="hello-root" data-testid="hello-block">
    <n-card size="small" :bordered="false" class="hello-card">
      <template #header>
        <div class="hello-header">
          <div class="title-left">
            <n-icon :component="SparklesOutline" class="title-ico" />
            <span class="hello-title">{{ formatGreeting(target?.host) }}</span>
          </div>
          <n-tag size="tiny" type="info" round :bordered="false">
            Runtime SFC
          </n-tag>
        </div>
      </template>

      <div class="hello-content">
        <!-- Инфо о целевом хосте -->
        <div class="target-card">
          <div class="target-left">
            <n-icon :component="DesktopOutline" />
            <span class="label">Целевой узел:</span>
            <span class="host-val" data-testid="hello-target-host">
              {{ target?.host || "Узел не выбран" }}
            </span>
          </div>
          <n-tag
            size="tiny"
            round
            :bordered="false"
            :type="getStatusType(target?.status)"
          >
            {{ target?.status || "idle" }}
          </n-tag>
        </div>

        <!-- Счётчик сессии -->
        <div class="counter-card">
          <n-statistic label="Счётчик сессии" class="stat-ctrl">
            <template #default>
              <span class="counter-val" data-testid="hello-counter">{{ counter }}</span>
            </template>
          </n-statistic>

          <n-space :size="8">
            <n-button
              type="primary"
              size="small"
              secondary
              data-testid="hello-inc-btn"
              @click="increment"
            >
              <template #icon>
                <n-icon :component="AddOutline" />
              </template>
              +1 Клик
            </n-button>
            <n-button
              size="small"
              quaternary
              data-testid="hello-reset-btn"
              @click="reset"
            >
              <template #icon>
                <n-icon :component="RefreshOutline" />
              </template>
              Сброс
            </n-button>
          </n-space>
        </div>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.hello-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  padding: 6px;
}

.hello-card {
  height: 100%;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
}

.hello-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.hello-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-ico {
  color: #58a6ff;
  font-size: 15px;
}

.hello-title {
  font-size: 13px;
  font-weight: 600;
  color: #58a6ff;
}

.hello-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.target-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 6px;
  font-size: 12px;
}

.target-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  color: #8b949e;
}

.host-val {
  font-weight: 600;
  color: #f0f6fc;
  font-family: monospace;
}

.counter-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 6px;
}

.counter-val {
  font-size: 20px;
  font-weight: 700;
  color: #63e2b7;
  font-family: "JetBrains Mono", Consolas, monospace;
}
</style>
