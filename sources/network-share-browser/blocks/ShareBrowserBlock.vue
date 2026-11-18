<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { defineBlock, useTarget, useFs, useExec, useMessage } from "@tmadmin/sdk";
import {
  NInput,
  NButton,
  NTable,
  NIcon,
  NEmpty,
  NSpin,
  NDropdown,
  NSpace,
} from "naive-ui";
import {
  FolderOpenOutline,
  FolderOutline,
  DocumentOutline,
  RefreshOutline,
  ArrowUpOutline,
  CopyOutline,
  TerminalOutline,
} from "@vicons/ionicons5";

defineBlock({
  title: "Сетевая папка _WORK",
  description: "Проводник по сетевой папке \\\\pc5700\\_WORK с контекстным меню копирования пути и запуска через PSExec",
  icon: "FolderOpenOutline",
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 8, h: 4 },
});

const target = useTarget();
const fsApi = useFs();
const execApi = useExec();
const message = useMessage();

const currentPath = ref<string>("\\\\pc5700\\_WORK");
const isLoading = ref<boolean>(false);
const items = ref<Array<{ name: string; path: string; isDir: boolean; size?: number; modified?: string }>>([]);

// Context menu state
const showDropdown = ref<boolean>(false);
const dropdownX = ref<number>(0);
const dropdownY = ref<number>(0);
const selectedItem = ref<{ name: string; path: string; isDir: boolean } | null>(null);

const dropdownOptions = [
  {
    label: "Копировать путь",
    key: "copy",
    icon: () => h(NIcon, null, { default: () => h(CopyOutline) }),
  },
  {
    label: "Запустить на удалённом ПК (PSExec)",
    key: "psexec",
    icon: () => h(NIcon, null, { default: () => h(TerminalOutline) }),
  },
];

// Helper to render icon for dropdown options
import { h } from "vue";

interface DirEntryItem {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  modifiedAt?: string;
  modified?: string;
}

async function loadDirectory(pathVal: string) {
  if (!pathVal) return;
  isLoading.value = true;
  try {
    const res = await fsApi.dir.read(pathVal);
    const list = (res.entries || []) as DirEntryItem[];
    items.value = list.map((e) => ({
      name: e.name,
      path: e.path,
      isDir: !!e.isDir,
      size: e.size,
      modified: e.modifiedAt || e.modified,
    }));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    message.error(`Не удалось прочитать директорию: ${errorMsg}`);
    items.value = [];
  } finally {
    isLoading.value = false;
  }
}

function handleRefresh() {
  loadDirectory(currentPath.value);
}

function handleOpenItem(item: { name: string; path: string; isDir: boolean }) {
  if (item.isDir) {
    currentPath.value = item.path;
    loadDirectory(currentPath.value);
  }
}

function handleGoUp() {
  const normalized = currentPath.value.replace(/[/\\]+$/, "");
  // If it's something like \\pc5700\_WORK, parent is \\pc5700
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSlash > 1) {
    let parent = normalized.substring(0, lastSlash);
    if (parent.endsWith(":")) parent += "\\";
    currentPath.value = parent;
    loadDirectory(currentPath.value);
  }
}

function handleContextMenu(e: MouseEvent, item: { name: string; path: string; isDir: boolean }) {
  e.preventDefault();
  selectedItem.value = item;
  showDropdown.value = false;
  nextTick(() => {
    dropdownX.value = e.clientX;
    dropdownY.value = e.clientY;
    showDropdown.value = true;
  });
}

function onClickOutside() {
  showDropdown.value = false;
}

onMounted(() => {
  loadDirectory(currentPath.value);
  document.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
});

async function handleSelectDropdown(key: string) {
  showDropdown.value = false;
  if (!selectedItem.value) return;

  const fullPath = selectedItem.value.path;

  if (key === "copy") {
    try {
      await navigator.clipboard.writeText(fullPath);
      message.success(`Путь скопирован: ${fullPath}`);
    } catch (err) {
      message.error("Не удалось скопировать в буфер обмена");
    }
  } else if (key === "psexec") {
    const host = target.value?.host;
    if (!host) {
      message.warning("Узел (Target) не выбран. Укажите целевой хост в панели управления.");
      return;
    }
    try {
      message.info(`Запуск через PSExec на хосте ${host}...`);
      // psexec.exe \\{host} -i -d "{fullPath}"
      const res = await execApi.hostSpawn("psexec.exe", [`\\\\${host}`, "-i", "-d", fullPath]);
      if (res.success || res.code === 0) {
        message.success(`PSExec успешно запущен на ${host}`);
      } else {
        message.error(`PSExec завершился с кодом ${res.code}: ${res.stderr || res.stdout || 'Ошибка'}`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`Ошибка запуска PSExec: ${errorMsg}`);
    }
  }
}

import { nextTick } from "vue";
</script>

<template>
  <div class="share-browser-block" style="display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px;">
    <!-- Top Bar -->
    <n-space align="center" style="width: 100%;">
      <n-button size="small" @click="handleGoUp" :disabled="isLoading">
        <template #icon><n-icon><ArrowUpOutline /></n-icon></template>
        Наверх
      </n-button>
      <n-input
        v-model:value="currentPath"
        placeholder="Введите UNC-путь (например, \\\\pc5700\\_WORK)"
        size="small"
        style="flex: 1;"
        @keyup.enter="loadDirectory(currentPath)"
      />
      <n-button size="small" type="primary" @click="loadDirectory(currentPath)" :loading="isLoading">
        <template #icon><n-icon><RefreshOutline /></n-icon></template>
        Обновить
      </n-button>
    </n-space>

    <!-- Main Content / Table -->
    <div style="flex: 1; overflow-y: auto; border: 1px solid var(--n-border-color); border-radius: 4px; position: relative;">
      <n-spin :show="isLoading" style="min-height: 150px;">
        <n-table v-if="items.length > 0" :single-line="false" size="small">
          <thead>
            <tr>
              <th style="width: 40px;">Тип</th>
              <th>Имя</th>
              <th style="width: 100px;">Размер</th>
              <th style="width: 160px;">Изменен</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in items"
              :key="item.path"
              @dblclick="handleOpenItem(item)"
              @contextmenu="(e) => handleContextMenu(e, item)"
              style="cursor: pointer;"
              class="browser-row"
            >
              <td style="text-align: center;">
                <n-icon size="18" :color="item.isDir ? '#f0a020' : '#2080f0'">
                  <FolderOutline v-if="item.isDir" />
                  <DocumentOutline v-else />
                </n-icon>
              </td>
              <td>{{ item.name }}</td>
              <td>{{ item.isDir ? '-' : (item.size ? (item.size / 1024).toFixed(1) + ' KB' : '0 KB') }}</td>
              <td>{{ item.modified ? new Date(item.modified).toLocaleString() : '-' }}</td>
            </tr>
          </tbody>
        </n-table>
        <n-empty v-else-if="!isLoading" description="Папка пуста или недоступна" style="margin-top: 40px;" />
      </n-spin>
    </div>

    <!-- Context Menu Dropdown -->
    <n-dropdown
      placement="bottom-start"
      trigger="manual"
      :x="dropdownX"
      :y="dropdownY"
      :show="showDropdown"
      :options="dropdownOptions"
      @select="handleSelectDropdown"
      @clickoutside="showDropdown = false"
    />
  </div>
</template>

<style scoped>
.browser-row:hover {
  background-color: var(--n-color-hover, rgba(0, 0, 0, 0.04));
}
</style>
