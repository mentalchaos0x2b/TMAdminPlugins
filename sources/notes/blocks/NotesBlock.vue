<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { defineBlock, usePluginStore } from "@tmadmin/sdk";
import {
  NInput,
  NButton,
  NTag,
  NIcon,
  NSpace,
  NText,
  NTooltip,
} from "naive-ui";
import {
  DocumentTextOutline,
  CopyOutline,
  CheckmarkOutline,
  TrashOutline,
} from "@vicons/ionicons5";

defineBlock({
  title: "Заметки",
  description: "Полноэкранный блок заметок с постоянным автосохранением и счётчиком символов",
  icon: "DocumentTextOutline",
  defaultSize: { w: 24, h: 10 },
  minSize: { w: 6, h: 4 },
});

const props = defineProps<{
  block?: { id?: string };
}>();

const blockId = computed<string>(() => props.block?.id?.trim() || "");

const storeTitleKey = computed<string>(() => (blockId.value ? `notes_title_${blockId.value}` : "notes_title"));
const storeContentKey = computed<string>(() => (blockId.value ? `notes_content_${blockId.value}` : "notes_content"));
const localTitleKey = computed<string>(() => (blockId.value ? `tmadmin_notes_title_${blockId.value}` : "tmadmin_notes_title"));
const localContentKey = computed<string>(() => (blockId.value ? `tmadmin_notes_content_${blockId.value}` : "tmadmin_notes_content"));

const store = usePluginStore();

const title = ref<string>("");
const content = ref<string>("");
const isSaved = ref<boolean>(true);
const copied = ref<boolean>(false);

const charCount = computed<number>(() => content.value.length);
const wordCount = computed<number>(() => {
  const trimmed = content.value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
});

let isLoading = false;

function loadNotes(): void {
  isLoading = true;
  let savedTitle = store.get<string>(storeTitleKey.value);
  if (!savedTitle) {
    try {
      const val = window.localStorage?.getItem(localTitleKey.value);
      if (typeof val === "string") {
        savedTitle = val;
      }
    } catch {
      /* ignore */
    }
  }
  if (typeof savedTitle === "string") {
    title.value = savedTitle;
  } else {
    title.value = "";
  }

  let savedContent = store.get<string>(storeContentKey.value);
  if (!savedContent) {
    try {
      const val = window.localStorage?.getItem(localContentKey.value);
      if (typeof val === "string") {
        savedContent = val;
      }
    } catch {
      /* ignore */
    }
  }
  if (typeof savedContent === "string") {
    content.value = savedContent;
  } else {
    content.value = "";
  }
  isSaved.value = true;
  setTimeout(() => {
    isLoading = false;
  }, 0);
}

loadNotes();
onMounted(() => {
  loadNotes();
});

watch(
  () => props.block?.id,
  (newId, oldId) => {
    if (newId !== oldId) {
      loadNotes();
    }
  },
);

watch(
  () => store.get<string>(storeContentKey.value),
  (newContent) => {
    if (typeof newContent === "string" && newContent !== content.value) {
      loadNotes();
    }
  },
);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function doSave(): Promise<void> {
  await store.set(storeTitleKey.value, title.value, { persist: "permanent" });
  await store.set(storeContentKey.value, content.value, { persist: "permanent" });
  try {
    window.localStorage?.setItem(localTitleKey.value, title.value);
    window.localStorage?.setItem(localContentKey.value, content.value);
  } catch {
    /* ignore */
  }
  isSaved.value = true;
}

function scheduleSave(): void {
  if (isLoading) {
    return;
  }
  isSaved.value = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    void doSave();
  }, 300);
}

watch([title, content], () => {
  scheduleSave();
});

async function handleCopy(): Promise<void> {
  const fullText = title.value ? `${title.value}\n\n${content.value}` : content.value;
  try {
    await navigator?.clipboard?.writeText?.(fullText);
  } catch {
    // fallback
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1800);
}

function handleClear(): void {
  content.value = "";
  void doSave();
}
</script>

<template>
  <div class="notes-root" data-testid="notes-block">
    <!-- Верхняя панель: заголовок и статус сохранения -->
    <div class="notes-top-bar">
      <div class="title-wrap">
        <n-icon :component="DocumentTextOutline" class="title-icon" />
        <n-input
          v-model:value="title"
          size="small"
          placeholder="Заголовок заметки..."
          class="title-input"
          :input-props="({ 'data-testid': 'notes-title-input' } as Record<string, unknown>)"
        />
      </div>

      <n-space align="center" :size="6" class="top-actions">
        <n-tag
          :type="isSaved ? 'success' : 'warning'"
          size="small"
          round
          :bordered="false"
          data-testid="notes-save-status"
        >
          {{ isSaved ? "Сохранено" : "Изменено" }}
        </n-tag>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="small"
              secondary
              data-testid="notes-copy-btn"
              @click="handleCopy"
            >
              <template #icon>
                <n-icon :component="copied ? CheckmarkOutline : CopyOutline" />
              </template>
              {{ copied ? "Скопировано" : "Копировать" }}
            </n-button>
          </template>
          <span>Скопировать заметку в буфер обмена</span>
        </n-tooltip>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="small"
              quaternary
              data-testid="notes-clear-btn"
              @click="handleClear"
            >
              <template #icon>
                <n-icon :component="TrashOutline" />
              </template>
              Очистить
            </n-button>
          </template>
          <span>Очистить текст заметки</span>
        </n-tooltip>
      </n-space>
    </div>

    <!-- Текстовый редактор на 100% оставшейся высоты -->
    <div class="notes-editor-container">
      <n-input
        v-model:value="content"
        type="textarea"
        placeholder="Введите рабочие заметки, напоминания или инструкции..."
        class="notes-textarea"
        :input-props="({ 'data-testid': 'notes-textarea' } as Record<string, unknown>)"
        :autosize="false"
      />
    </div>

    <!-- Нижняя панель со статистикой -->
    <div class="notes-footer">
      <div class="footer-stats" data-testid="notes-stats">
        <n-text depth="3" class="stat-item">
          Символов: <b data-testid="notes-char-count">{{ charCount }}</b>
        </n-text>
        <span class="stat-divider">·</span>
        <n-text depth="3" class="stat-item">
          Слов: <b data-testid="notes-word-count">{{ wordCount }}</b>
        </n-text>
      </div>
      <n-text depth="3" class="footer-hint">
        Автосохранение в локальное хранилище TMAdmin
      </n-text>
    </div>
  </div>
</template>

<style scoped>
.notes-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  gap: 8px;
  overflow: hidden;
  background: transparent;
  color: #e6edf3;
}

.notes-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: nowrap;
}

.title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.title-icon {
  font-size: 16px;
  color: #58a6ff;
  flex-shrink: 0;
}

.title-input {
  max-width: 340px;
  font-weight: 600;
}

.top-actions {
  flex-shrink: 0;
}

.notes-editor-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.notes-textarea {
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.notes-textarea .n-input__wrapper) {
  height: 100%;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.22);
}

:deep(.notes-textarea .n-input__textarea) {
  height: 100%;
}

:deep(.notes-textarea .n-input__textarea-el) {
  height: 100% !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  box-sizing: border-box;
}

.notes-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  padding-top: 2px;
}

.footer-stats {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-item b {
  color: #f0f6fc;
}

.stat-divider {
  color: #8b949e;
}

.footer-hint {
  font-size: 10.5px;
}
</style>
