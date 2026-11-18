<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { defineBlock, useTarget, usePluginStore } from "@tmadmin/sdk";
import {
  NInput,
  NButton,
  NTag,
  NSpace,
  NDescriptions,
  NDescriptionsItem,
  NIcon,
  NText,
  NTooltip,
} from "naive-ui";
import {
  SearchOutline,
  RefreshOutline,
  CopyOutline,
  CheckmarkOutline,
  BusinessOutline,
  ShieldCheckmarkOutline,
} from "@vicons/ionicons5";
import {
  parseDistinguishedName,
  parseUserAccountControl,
  formatGroupList,
  getMockLdapComputerRecord,
  type LdapComputerRecord,
} from "../lib/ldapParser";

defineBlock({
  title: "Объект Active Directory",
  description: "Карточка компьютера и учётной записи в Active Directory: DN, иерархия OU, ОС, группы и статус",
  icon: "BusinessOutline",
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 8, h: 5 },
});

const target = useTarget();
const store = usePluginStore();

const searchInput = ref<string>("");
const isSearching = ref<boolean>(false);
const record = ref<LdapComputerRecord | null>(null);
const copiedDnToast = ref<boolean>(false);
const groupFilter = ref<string>("");

const activeHost = computed<string>(() => target.value?.host || "");
const parsedDn = computed(() => parseDistinguishedName(record.value?.distinguishedName || ""));
const uac = computed(() => parseUserAccountControl(record.value?.userAccountControl || 0));
const groups = computed(() => formatGroupList(record.value?.memberOf || []));
const filteredGroups = computed(() => {
  const q = groupFilter.value.trim().toLowerCase();
  return q ? groups.value.filter((g) => g.name.toLowerCase().includes(q)) : groups.value;
});

function loadDataForHost(host: string): void {
  const targetName = host || "srv-dc01";
  const cached = store.get<LdapComputerRecord>(`ldap_${targetName}`);
  if (cached) {
    record.value = cached;
  } else {
    const generated = getMockLdapComputerRecord(targetName);
    record.value = generated;
    void store.set(`ldap_${targetName}`, generated, { persist: "temp" });
  }
  searchInput.value = record.value.cn;
}

loadDataForHost(activeHost.value);
onMounted(() => loadDataForHost(activeHost.value));

watch(
  () => target.value?.host,
  (newHost) => {
    if (newHost) loadDataForHost(newHost);
  },
);

async function handleSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) return;
  isSearching.value = true;
  try {
    await Promise.resolve();
    const result = getMockLdapComputerRecord(query);
    record.value = result;
    await store.set(`ldap_${query}`, result, { persist: "temp" });
  } finally {
    isSearching.value = false;
  }
}

async function copyDn(): Promise<void> {
  if (!record.value?.distinguishedName) return;
  try {
    await navigator?.clipboard?.writeText?.(record.value.distinguishedName);
  } catch {
    // ignore
  }
  copiedDnToast.value = true;
  setTimeout(() => {
    copiedDnToast.value = false;
  }, 1800);
}
</script>

<template>
  <div class="ldap-root" data-testid="ldap-computer-card">
    <!-- Поисковая строка -->
    <div class="search-row">
      <n-input
        v-model:value="searchInput"
        size="small"
        placeholder="CN компьютера в AD..."
        clearable
        class="search-input"
        :input-props="({ 'data-testid': 'ldap-search-input' } as Record<string, unknown>)"
        data-testid="ldap-search-input"
        @keyup.enter="handleSearch"
      >
        <template #prefix>
          <n-icon :component="BusinessOutline" />
        </template>
      </n-input>
      <n-button
        type="primary"
        size="small"
        secondary
        :loading="isSearching"
        data-testid="ldap-search-btn"
        @click="handleSearch"
      >
        <template #icon>
          <n-icon :component="SearchOutline" />
        </template>
        Найти
      </n-button>
      <n-button
        size="small"
        quaternary
        :loading="isSearching"
        data-testid="ldap-refresh-btn"
        title="Обновить данные"
        @click="handleSearch"
      >
        <template #icon>
          <n-icon :component="RefreshOutline" />
        </template>
      </n-button>
    </div>

    <!-- Основной контент карточки -->
    <div v-if="record" class="card-body">
      <!-- Заголовок с именем и статусом -->
      <div class="card-header">
        <div class="cn-title-group">
          <b class="cn-name" data-testid="ldap-computer-name">{{ record.cn }}</b>
          <n-text depth="3" class="dns-subtitle">{{ record.dnsHostName }}</n-text>
        </div>
        <n-space :size="6" align="center">
          <n-tag
            :type="uac.isEnabled ? 'success' : 'error'"
            size="small"
            round
            :bordered="false"
            data-testid="ldap-status-tag"
          >
            {{ uac.isEnabled ? "Включена" : "Отключена" }}
          </n-tag>
          <n-tag size="small" :bordered="false" class="dom-tag">
            {{ parsedDn.domain.toUpperCase() || "CORP.LOCAL" }}
          </n-tag>
        </n-space>
      </div>

      <!-- Детали в виде описаний Naive UI -->
      <n-descriptions
        bordered
        size="small"
        :column="1"
        label-placement="left"
        class="ldap-desc-table"
      >
        <n-descriptions-item label="OU">
          <span data-testid="ldap-ou-path" class="ou-val">
            {{ parsedDn.path || "Root" }}
          </span>
        </n-descriptions-item>

        <n-descriptions-item label="DN">
          <div class="dn-cell">
            <span class="dn-text mono" data-testid="ldap-dn-text">
              {{ record.distinguishedName }}
            </span>
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button
                  size="tiny"
                  quaternary
                  class="copy-dn-btn"
                  @click="copyDn"
                >
                  <template #icon>
                    <n-icon :component="copiedDnToast ? CheckmarkOutline : CopyOutline" />
                  </template>
                  {{ copiedDnToast ? "Скопировано" : "Коп." }}
                </n-button>
              </template>
              <span>Копировать полный Distinguished Name</span>
            </n-tooltip>
          </div>
        </n-descriptions-item>

        <n-descriptions-item label="ОС">
          <span data-testid="ldap-os-name">
            {{ record.operatingSystem }} ({{ record.operatingSystemVersion }})
          </span>
        </n-descriptions-item>

        <n-descriptions-item label="Вход / IP">
          <span data-testid="ldap-last-logon" class="mono">
            {{ record.lastLogonTimestamp.replace("T", " ").slice(0, 16) }} · {{ record.ipv4Address }}
          </span>
        </n-descriptions-item>
      </n-descriptions>

      <!-- Блок групп безопасности -->
      <div class="groups-section">
        <div class="groups-header">
          <div class="groups-title">
            <n-icon :component="ShieldCheckmarkOutline" />
            <span>Группы безопасности ({{ groups.length }}):</span>
          </div>
          <n-input
            v-model:value="groupFilter"
            size="tiny"
            placeholder="Фильтр групп..."
            clearable
            class="group-filter-input"
          />
        </div>

        <div class="groups-chips-list" data-testid="ldap-groups-list">
          <n-tag
            v-for="g in filteredGroups"
            :key="g.raw"
            size="small"
            :bordered="false"
            class="group-chip"
          >
            {{ g.name }}
          </n-tag>
          <n-text v-if="filteredGroups.length === 0" depth="3" class="no-groups">
            Группы не найдены
          </n-text>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ldap-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  height: 100%;
  box-sizing: border-box;
  font-size: 12px;
  color: #e6edf3;
  overflow: hidden;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  flex: 1;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.cn-title-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.cn-name {
  font-size: 14px;
  color: #f0f6fc;
}

.dns-subtitle {
  font-size: 11px;
  font-family: monospace;
}

.dom-tag {
  font-family: monospace;
  font-size: 10px;
}

.ldap-desc-table {
  font-size: 11.5px;
}

.ldap-desc-table :deep(.n-descriptions-table-header) {
  width: 72px;
  color: #8b949e;
  font-size: 11px;
}

.ou-val {
  color: #f0f6fc;
  font-weight: 500;
}

.dn-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.dn-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #c9d1d9;
}

.copy-dn-btn {
  flex-shrink: 0;
}

.mono {
  font-family: "JetBrains Mono", Consolas, monospace;
}

.groups-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.groups-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.groups-title {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #8b949e;
  font-weight: 500;
}

.group-filter-input {
  width: 130px;
}

.groups-chips-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow-y: auto;
  max-height: 100%;
  padding-right: 2px;
}

.group-chip {
  font-size: 11px;
}

.no-groups {
  font-size: 11px;
  font-style: italic;
  padding: 4px 0;
}
</style>
