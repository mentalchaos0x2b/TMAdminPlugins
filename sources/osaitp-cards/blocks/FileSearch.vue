<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  defineBlock,
  useTarget,
  onTargetConnect,
  onTargetReset,
  useFs,
  useExec,
  useMessage,
  usePluginStore,
} from "@tmadmin/sdk";
import {
  NInput,
  NButton,
  NTable,
  NTag,
  NIcon,
  NEmpty,
  NSpace,
  NSpin,
  NRadioGroup,
  NRadioButton,
  NPopover,
  NSwitch,
} from "naive-ui";
import {
  SearchOutline,
  FolderOpenOutline,
  DocumentOutline,
  OpenOutline,
  CopyOutline,
  DocumentTextOutline,
  FolderOutline,
  TimeOutline,
  SettingsOutline,
} from "@vicons/ionicons5";

defineBlock({
  title: "Быстрый поиск карточек",
  description: "Поиск карточек и документов в папках сетевого хранилища",
  icon: "SearchOutline",
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 8, h: 5 },
});

const target = useTarget();
const { dir } = useFs();
const exec = useExec();
const message = useMessage();
const store = usePluginStore();

const searchPath = ref<string>(store.get<string>("searchPath") ?? "\\\\fs2\\OSAITP");
const autoSyncTarget = ref<boolean>(store.get<boolean>("autoSyncTarget") ?? true);
const searchQuery = ref<string>("");

function handleToggleAutoSyncTarget(val: boolean): void {
  autoSyncTarget.value = val;
  void store.set("autoSyncTarget", val, { persist: "permanent" });
  if (val && target.value?.host?.trim()) {
    searchQuery.value = target.value.host.trim();
  }
}
const isLoading = ref<boolean>(false);
const isOpening = ref<boolean>(false);
const results = ref<Array<{ name: string; path: string; isDir: boolean; size: number }>>([]);
const hasSearched = ref<boolean>(false);

// История поиска
const searchHistory = ref<string[]>(store.get<string[]>("searchHistory") ?? []);
const showHistoryDropdown = ref<boolean>(false);

// Фильтр по типу
const filterType = ref<"all" | "files" | "folders">("all");

// Сортировка
const sortBy = ref<"name" | "size">("name");
const sortOrder = ref<"asc" | "desc">("asc");

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchGeneration = 0;

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Иконка в зависимости от расширения
function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["doc", "docx", "rtf"].includes(ext)) return DocumentTextOutline;
  return DocumentOutline;
}

// Итоговый список с учётом фильтра и сортировки
const displayedResults = computed(() => {
  let list = [...results.value];

  if (filterType.value === "files") {
    list = list.filter((i) => !i.isDir);
  } else if (filterType.value === "folders") {
    list = list.filter((i) => i.isDir);
  }

  list.sort((a, b) => {
    const cmp =
      sortBy.value === "name" ? a.name.localeCompare(b.name) : a.size - b.size;
    return sortOrder.value === "asc" ? cmp : -cmp;
  });

  return list;
});

// Обновление истории поиска
function addToHistory(query: string): void {
  if (!query.trim()) return;
  const clean = query.trim();
  const filtered = searchHistory.value.filter((h) => h.toLowerCase() !== clean.toLowerCase());
  const updated = [clean, ...filtered].slice(0, 10);
  searchHistory.value = updated;
  void store.set("searchHistory", updated, { persist: "permanent" });
}

// Выбор из истории
function onHistorySelect(key: string): void {
  searchQuery.value = key;
  showHistoryDropdown.value = false;
  handleManualSearch();
}

async function executeSearch(): Promise<void> {
  const path = searchPath.value.trim();
  const query = searchQuery.value.trim();

  if (!path) {
    message.warning("Укажите путь к папке (например, \\\\fs2\\OSAITP)");
    return;
  }

  if (!query) {
    searchGeneration++;
    results.value = [];
    hasSearched.value = false;
    isLoading.value = false;
    return;
  }

  const gen = ++searchGeneration;
  isLoading.value = true;
  hasSearched.value = true;

  try {
    const pattern = query.includes("*") ? query : `*${query}*`;

    const res = await dir.search(path, pattern, {
      recursive: true,
      maxDepth: 10,
      maxResults: 1000,
      caseSensitive: false,
      includeDirs: true,
    });

    if (gen !== searchGeneration) return;

    results.value = res.matches;

    if (res.matches.length > 0) {
      addToHistory(query);
    }

    if (res.matches.length === 0) {
      message.info("Ничего не найдено по вашему запросу");
    } else if (res.truncated) {
      message.warning("Найдено много совпадений (показаны первые 1000)");
    }
  } catch (err) {
    if (gen !== searchGeneration) return;

    const msg = err instanceof Error ? err.message : String(err);
    message.error(`Ошибка поиска: ${msg}`);
    results.value = [];
  } finally {
    if (gen === searchGeneration) {
      isLoading.value = false;
    }
  }
}

async function handleOpenFile(item: { name: string; path: string; isDir: boolean }): Promise<void> {
  if (isOpening.value || !item.path || item.path.includes("\0")) return;
  isOpening.value = true;

  try {
    await exec.hostSpawn("explorer.exe", [item.path]);
    message.success(`Открытие: ${item.name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    message.error(`Не удалось открыть: ${msg}`);
  } finally {
    isOpening.value = false;
  }
}

// Открыть папку, содержащую файл
async function handleOpenFolder(item: { name: string; path: string; isDir: boolean }): Promise<void> {
  if (isOpening.value || !item.path || item.path.includes("\0")) return;
  isOpening.value = true;

  try {
    let folderPath = item.path;
    if (!item.isDir) {
      const lastSep = Math.max(item.path.lastIndexOf("\\"), item.path.lastIndexOf("/"));
      if (lastSep > 0) {
        folderPath = item.path.substring(0, lastSep);
      }
    }

    await exec.hostSpawn("explorer.exe", [folderPath]);
    message.success(`Открытие папки: ${folderPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    message.error(`Не удалось открыть папку: ${msg}`);
  } finally {
    isOpening.value = false;
  }
}

async function handleCopyPath(path: string): Promise<void> {
  try {
    await navigator?.clipboard?.writeText?.(path);
    message.success("Путь скопирован");
  } catch {
    message.error("Не удалось скопировать");
  }
}

function toggleSort(column: "name" | "size"): void {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortBy.value = column;
    sortOrder.value = "asc";
  }
}

watch(searchQuery, () => {
  if (debounceTimer) clearTimeout(debounceTimer);

  if (!searchQuery.value.trim()) {
    results.value = [];
    hasSearched.value = false;
    isLoading.value = false;
    return;
  }

  isLoading.value = true;

  debounceTimer = setTimeout(() => {
    void executeSearch();
  }, 2500);
});

function handleManualSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  void executeSearch();
}

function handleReset(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  searchGeneration++;
  searchQuery.value = "";
  results.value = [];
  hasSearched.value = false;
  isLoading.value = false;
  showHistoryDropdown.value = false;
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    handleReset();
    showHistoryDropdown.value = false;
  }
}

watch(searchPath, (newPath) => {
  void store.set("searchPath", newPath.trim(), { persist: "permanent" });
});

watch(
  () => target.value?.host,
  (newHost) => {
    if (!autoSyncTarget.value) return;
    const clean = newHost?.trim() ?? "";
    if (clean !== searchQuery.value) {
      if (debounceTimer) clearTimeout(debounceTimer);
      searchQuery.value = clean;
      if (!clean) {
        results.value = [];
        hasSearched.value = false;
        isLoading.value = false;
      }
    }
  },
  { immediate: true },
);

onTargetConnect((event) => {
  if (!autoSyncTarget.value) return;
  const host = event.host?.trim();
  if (host) {
    if (debounceTimer) clearTimeout(debounceTimer);
    searchQuery.value = host;
    void executeSearch();
  }
});

onTargetReset(({ reason }) => {
  if (!autoSyncTarget.value) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  searchGeneration++;
  results.value = [];
  hasSearched.value = false;
  isLoading.value = false;
  if (reason === "cleared") {
    searchQuery.value = "";
  }
});

onMounted(() => {
  if (autoSyncTarget.value && target.value?.host?.trim()) {
    searchQuery.value = target.value.host.trim();
  }
});

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  searchGeneration++;
});
</script>

<template>
  <div class="file-search-root" @keydown="handleKeyDown">
    <!-- Компактная верхняя панель -->
    <div class="compact-bar">
      <n-input
        v-model:value="searchPath"
        size="small"
        placeholder="Путь к папке"
        class="path-input"
      >
        <template #prefix>
          <n-icon :component="FolderOpenOutline" />
        </template>
      </n-input>

      <!-- Поле поиска с историей (Popover) -->
      <div class="query-wrapper">
        <n-input
          v-model:value="searchQuery"
          size="small"
          placeholder="Имя файла или папки..."
          class="query-input"
          clearable
          @keyup.enter="handleManualSearch"
          @keyup.esc="handleReset"
          @focus="showHistoryDropdown = searchHistory.length > 0 && !searchQuery"
        >
          <template #prefix>
            <n-icon :component="SearchOutline" />
          </template>
          <template #suffix>
            <n-popover
              v-if="searchHistory.length > 0"
              trigger="click"
              placement="bottom-end"
              :show="showHistoryDropdown"
              @update:show="showHistoryDropdown = $event"
            >
              <template #trigger>
                <n-button
                  text
                  size="tiny"
                  title="История поиска"
                  @click.stop
                >
                  <template #icon>
                    <n-icon :component="TimeOutline" />
                  </template>
                </n-button>
              </template>

              <!-- Содержимое истории -->
              <div class="history-list">
                <n-button
                  v-for="item in searchHistory"
                  :key="item"
                  quaternary
                  size="small"
                  block
                  class="history-btn"
                  @click="onHistorySelect(item)"
                >
                  <template #icon>
                    <n-icon :component="TimeOutline" />
                  </template>
                  {{ item }}
                </n-button>
              </div>
            </n-popover>
          </template>
        </n-input>
      </div>

      <n-button
        size="small"
        type="primary"
        :loading="isLoading"
        @click="handleManualSearch"
      >
        Искать
      </n-button>

      <n-popover trigger="click" placement="bottom-end">
        <template #trigger>
          <n-button
            size="small"
            quaternary
            title="Настройки поиска"
            data-testid="cards-settings-btn"
          >
            <template #icon>
              <n-icon :component="SettingsOutline" />
            </template>
          </n-button>
        </template>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0;">
          <span style="font-size: 12px;">Автоподстановка target в поиск</span>
          <n-switch
            :value="autoSyncTarget"
            size="small"
            data-testid="cards-autosync-switch"
            @update:value="handleToggleAutoSyncTarget"
          />
        </div>
      </n-popover>
    </div>

    <!-- Панель фильтров и статистики -->
    <div v-if="hasSearched && results.length > 0" class="filter-bar">
      <n-radio-group v-model:value="filterType" size="tiny">
        <n-radio-button value="all">Все ({{ results.length }})</n-radio-button>
        <n-radio-button value="files">
          Файлы ({{ results.filter((i) => !i.isDir).length }})
        </n-radio-button>
        <n-radio-button value="folders">
          Папки ({{ results.filter((i) => i.isDir).length }})
        </n-radio-button>
      </n-radio-group>

      <n-tag size="tiny" type="info" :bordered="false">
        Найдено: {{ displayedResults.length }}
      </n-tag>
    </div>

    <!-- Таблица результатов -->
    <div class="results-container">
      <div v-if="isLoading" class="loading-state">
        <n-spin size="small" />
        <span style="margin-left: 8px">Поиск...</span>
      </div>

      <n-empty
        v-else-if="hasSearched && displayedResults.length === 0"
        description="Ничего не найдено"
        class="empty-state"
      />

      <n-empty
        v-else-if="!hasSearched && !searchQuery.trim()"
        description="Введите запрос для поиска"
        class="empty-state"
      />

      <n-table
        v-else-if="displayedResults.length > 0"
        size="small"
        bordered
        single-line
        class="result-table"
      >
        <thead>
          <tr>
            <th style="width: 32px; text-align: center;"></th>
            <th style="cursor: pointer;" @click="toggleSort('name')">
              Имя
              <span v-if="sortBy === 'name'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
            </th>
            <th>Путь</th>
            <th style="width: 80px; text-align: right; cursor: pointer;" @click="toggleSort('size')">
              Размер
              <span v-if="sortBy === 'size'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
            </th>
            <th style="width: 156px; text-align: center;">Действия</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in displayedResults" :key="item.path">
            <td style="text-align: center; color: var(--tm-mut, #8b949e);">
              <n-icon :component="item.isDir ? FolderOpenOutline : getFileIcon(item.name)" />
            </td>
            <td>
              <b>{{ item.name }}</b>
              <n-tag v-if="item.isDir" size="tiny" type="info" style="margin-left: 6px">Папка</n-tag>
            </td>
            <td class="mono path-cell" :title="item.path">{{ item.path }}</td>
            <td style="text-align: right; color: var(--tm-mut, #8b949e);">
              {{ item.isDir ? "—" : formatSize(item.size) }}
            </td>
            <td style="text-align: center;">
              <n-space justify="center" :size="4" :wrap="false">
                <n-button
                  size="tiny"
                  secondary
                  type="primary"
                  :loading="isOpening"
                  title="Открыть файл или папку"
                  @click="handleOpenFile(item)"
                >
                  <template #icon>
                    <n-icon :component="OpenOutline" />
                  </template>
                  Открыть
                </n-button>
                <n-button
                  size="tiny"
                  secondary
                  title="Открыть содержащую папку"
                  @click="handleOpenFolder(item)"
                >
                  <template #icon>
                    <n-icon :component="FolderOutline" />
                  </template>
                </n-button>
                <n-button
                  size="tiny"
                  quaternary
                  title="Скопировать путь"
                  @click="handleCopyPath(item.path)"
                >
                  <template #icon>
                    <n-icon :component="CopyOutline" />
                  </template>
                </n-button>
              </n-space>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>
</template>

<style scoped>
.file-search-root {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  height: 100%;
  width: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--tm-tx, #e6edf3);
  overflow: hidden;
}

.compact-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  min-width: 0;
}

.path-input {
  flex: 0 1 185px;
  min-width: 100px;
}

/* Обёртка для поля поиска */
.query-wrapper {
  flex: 1;
  min-width: 120px;
}

.query-input {
  width: 100%;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.results-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: 4px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--tm-mut, #8b949e);
  font-style: italic;
}

.empty-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 12px 0;
}

.result-table {
  width: 100%;
  font-size: 11px;
}

.result-table th {
  font-size: 10.5px;
  color: var(--tm-mut, #8b949e);
  padding: 4px 8px;
  user-select: none;
}

.result-table td {
  padding: 4px 8px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.path-cell {
  font-size: 10px;
  color: var(--tm-mut, #8b949e);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Стили для списка истории */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
}

.history-btn {
  justify-content: flex-start;
}
</style>