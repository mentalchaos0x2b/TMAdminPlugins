# TMAdmin Plugin SDK — Документация разработчика

Официальное руководство по созданию плагинов и блоков для **TMAdmin** (Tauri 2 + Vue 3 + TypeScript + Naive UI).

---

## Оглавление

1. [Введение и модель песочницы](#1-введение-и-модель-песочницы)
2. [Структура плагина](#2-структура-плагина)
3. [Манифест `plugin.json`](#3-манифест-pluginjson)
4. [Разрешения (Permissions)](#4-разрешения-permissions)
5. [Разрешённые импорты в песочнице](#5-разрешённые-импорты-в-песочнице)
6. [Справочник API (`@tmadmin/sdk`)](#6-справочник-api-tmadminsdk)
   - [defineBlock](#defineblock)
   - [useTarget, onTargetConnect, onTargetReset](#usetarget-ontargetconnect-ontargetreset)
   - [usePluginStore](#usepluginstore)
   - [useSharedStore](#usesharedstore)
   - [useExec](#useexec)
   - [useFs (`fs.read`, `fs.write`, `dir.read`, `dir.search`)](#usefs-fsread-fswrite-dirread-dirsearch)
   - [useTerminal](#useterminal)
   - [useSecrets](#usesecrets)
   - [useMessage](#usemessage)
   - [Chart.js (`Chart`, `registerables`)](#chartjs-chart-registerables)
7. [Полный пример плагина (`blocks/*.vue` + `lib/*.ts`)](#7-полный-пример-плагина-blocks-vue--lib-ts)
8. [Упаковка и публикация в Plugin Market](#8-упаковка-и-публикация-в-plugin-market)
9. [Руководство для ИИ-агентов (AI Plugin Authoring Guide)](#9-руководство-для-ии-агентов-ai-plugin-authoring-guide)

---

## 1. Введение и модель песочницы

Плагины в TMAdmin состоят из **блоков** — независимых Vue 3 Single-File Components (`*.vue`), которые компилируются в рантайме, отображаются на 24-колоночной сетке workspace и взаимодействуют с операционной системой исключительно через типизированный SDK `@tmadmin/sdk`.

Ключевые принципы:
- **Изоляция (Sandbox)**: код плагина не имеет прямого доступа к Node.js, произвольным npm-пакетам и внутренним сторам приложения. Разрешены только UI-библиотеки (`vue`, `naive-ui`, `@vicons/ionicons5`, `chart.js`), `@tmadmin/sdk` и локальные модули самого плагина.
- **Принцип наименьших привилегий**: доступ к системным операциям (ping, запуск процессов, чтение/запись файлов, терминал, keychain) открывается только при наличии соответствующего разрешения в массиве `permissions` файла `plugin.json`. При отсутствии права SDK выбрасывает `PermissionDeniedError`.
- **Target-ориентированность**: текущий целевой хост (`target`) задаётся один раз в шапке workspace и доступен любому блоку реактивно через `useTarget()`.

---

## 2. Структура плагина

```text
my-plugin/
├── plugin.json             # Манифест плагина (обязательный, валидируется Zod)
├── blocks/                 # Vue 3 SFC-компоненты блоков
│   └── LogMonitor.vue
├── lib/                    # Общая TypeScript-логика и утилиты плагина
│   └── logParser.ts
└── external/               # Опционально: сторонние бинарники (.exe / CLI-утилиты)
    └── tool.exe
```

Правила организации кода:
- Один блок = один файл `blocks/<BlockName>.vue` с `<script setup lang="ts">`.
- Повторно используемую логику, парсеры и типы выносите в `lib/*.ts` (разрешены `ref`, `reactive`, `computed`, импорты из `@tmadmin/sdk` и относительные импорты).
- Исполняемые файлы, поставляемые вместе с плагином, размещайте строго в `external/`.

---

## 3. Манифест `plugin.json`

Манифест проходит строгую рантайм-валидацию через Zod (`PluginManifestSchema`).

### Пример `plugin.json`

```json
{
  "id": "acme.log-inspector",
  "name": "Log Inspector",
  "version": "1.0.0",
  "author": "ACME Infra Team",
  "description": "Просмотр и поиск системных логов на целевых серверах",
  "icon": "DocumentTextOutline",
  "permissions": [
    "fs.read",
    "fs.write",
    "store.write"
  ],
  "blocks": [
    {
      "id": "log-viewer",
      "title": "Просмотр логов",
      "entry": "blocks/LogViewer.vue",
      "icon": "DocumentTextOutline",
      "description": "Поиск и чтение журналов событий на целевом хосте",
      "defaultSize": { "w": 12, "h": 8 },
      "minSize": { "w": 6, "h": 5 }
    }
  ]
}
```

### Поля корневого объекта

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `id` | `string` | Да | Уникальный идентификатор плагина (`[a-z0-9_.-]`, до 64 символов, без начальных/конечных точек и `..`). Рекомендуется формат `vendor.name`. |
| `name` | `string` | Да | Отображаемое имя плагина. |
| `version` | `string` | Да | Версия по SemVer 2.0.0 (`1.0.0`, `1.2.0-beta.1`). |
| `author` | `string` | Да | Автор или команда. |
| `description` | `string` | Нет | Краткое описание плагина (по умолчанию `""`). |
| `icon` | `string` | Да | Идентификатор иконки из `@vicons/ionicons5` (например, `"PulseOutline"`). |
| `permissions` | `PluginPermission[]` | Нет | Список запрашиваемых разрешений (по умолчанию `[]`). |
| `blocks` | `PluginBlockManifest[]` | Да | Массив блоков плагина (минимум 1 блок). |

### Поля элемента `blocks[]`

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `id` | `string` | Да | Уникальный ID блока внутри плагина (`[a-z0-9-_]`). |
| `title` | `string` | Да | Заголовок блока в палитре и на сетке. |
| `entry` | `string` | Да | Относительный путь к SFC-файлу (например, `"blocks/LogViewer.vue"`). |
| `icon` | `string` | Нет | Иконка блока (`@vicons/ionicons5`). |
| `description` | `string` | Нет | Описание назначения блока. |
| `defaultSize` | `{ w: number; h: number }` | Да | Стартовый размер в 24-колоночной сетке (`1 <= w <= 24`, `h >= 1`). Должен быть `>= minSize`. |
| `minSize` | `{ w: number; h: number }` | Да | Минимально допустимый размер блока (`1 <= w <= 24`, `h >= 1`). |
| `settingsSchema` | `Record<string, unknown>` | Нет | Схема пользовательских настроек блока. |

---

## 4. Разрешения (Permissions)

| Разрешение | Какие API открывает | Описание |
|---|---|---|
| `net.ping` | `useExec().pingStart`, `pingStop`, `listenPing` | Запуск и чтение потока ICMP-пинга до целевого хоста. |
| `process.exec` | `useExec().hostSpawn`, а также `pluginExec`, `pluginSpawn` (вместе с `fs.external`) | Запуск утилит на хосте и бинарников плагина через Rust-ядро. |
| `fs.external` | `useExec().pluginExec`, `pluginSpawn` | Доступ к исполняемым файлам в директории `external/` плагина. |
| `fs.read` | `useFs().fs.read`, `useFs().dir.read`, `useFs().dir.search` | Чтение текстовых файлов, просмотр содержимого директорий и поиск файлов. |
| `fs.write` | `useFs().fs.write` | Создание, перезапись и дозапись текстовых файлов. |
| `ldap.query` | Доменные запросы Active Directory | Чтение карточек и атрибутов объектов Active Directory. |
| `store.write` | `usePluginStore().set/remove`, `useSharedStore().set/remove` | Запись и удаление данных в персистентном/временном хранилище. Чтение (`get`) и Pub/Sub (`publish`/`subscribe`) доступны без этого права. |
| `terminal` | `useTerminal().spawn`, `write`, `execScript`, `kill`, `listen` | Прямое создание и управление PTY-сессиями встроенного терминала. Метод `runCommand` (отправка команды в терминал по шине) доступен без `terminal`. |
| `keychain` | `useSecrets().get`, `set`, `delete` | Хранение и чтение паролей/токенов в системном менеджере ключей (OS Keychain). |

---

## 5. Разрешённые импорты в песочнице

В `blocks/*.vue` и `lib/*.ts` разрешены только следующие модули:

- `vue` — Composition API (`ref`, `reactive`, `computed`, `watch`, `onMounted`, `onUnmounted` и др.)
- `@tmadmin/sdk` — все хуки и хелперы TMAdmin SDK
- `naive-ui` — UI-компоненты Naive UI (также автоматически зарегистрированы в `<template>` блоков, например `<n-button>`, `<n-input>`, `<n-data-table>`)
- `@vicons/ionicons5` — векторные иконки Ionicons 5
- `chart.js` и `chart.js/auto` — построение графиков (также экспортируются из `@tmadmin/sdk`)
- Относительные пути внутри плагина — `./...`, `../lib/...` (`.ts`, `.js`, `.json`)

Импорт любых других пакетов или встроенных модулей Node.js будет отклонён резолвером песочницы.

---

## 6. Справочник API (`@tmadmin/sdk`)

### `defineBlock`

Декларативно описывает метаданные блока внутри `blocks/*.vue`. Используется IDE/Developer Studio и для статической типизации.

```ts
function defineBlock<T = Record<string, unknown>>(
  definition: BlockDefinition<T>,
): BlockDefinition<T>;

interface BlockDefinition<T = Record<string, unknown>> {
  title: string;
  description?: string;
  icon?: string;
  category?: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  settingsSchema?: Record<string, unknown> | T;
}
```

```ts
import { defineBlock } from "@tmadmin/sdk";

defineBlock({
  title: "Диагностика узла",
  description: "Базовые метрики и доступность",
  icon: "PulseOutline",
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 4 },
});
```

---

### `useTarget`

Возвращает реактивный `ComputedRef<Target | undefined>` текущего целевого узла активного workspace (или override-цели, если блок закреплён на конкретный хост).

```ts
function useTarget(): ComputedRef<Target | undefined>;

interface Target {
  raw: string;
  host: string;
### `useTarget`, `onTargetConnect`, `onTargetReset`

Реактивный доступ к целевому хосту в шапке workspace и события жизненного цикла подключения:

- `useTarget()` — возвращает `ComputedRef<Target | undefined>`. При редактировании поля ввода в шапке значение `target.value?.host` обновляется **динамически** со статусом `"idle"` (или `undefined` при очистке поля).
- `onTargetConnect(callback)` — вызывается при нажатии «Подключиться» (Enter, кнопка молнии или выбор ПК из истории). Идеально для немедленного запуска загрузки данных (например, LAPS-паролей, принтеров/SMB, диагностики). При вызове внутри `<script setup>` автоматически отписывается в `onUnmounted`.
- `onTargetReset(callback)` — вызывается при изменении целевого узла в поле ввода или его очистке (`reason: "input-changed" | "cleared" | "disconnected"`). Используйте для сброса кэшированных данных предыдущего ПК и остановки локальных процессов/графиков.

```ts
interface Target {
  raw: string;
  host: string;
  ip?: string;
  status: "idle" | "resolving" | "online" | "offline" | "error";
  responseTimeMs?: number;
  lastChecked?: string;
  errorMessage?: string;
}

interface TargetConnectEvent {
  host: string;
  raw: string;
  ip?: string;
  timestamp: string;
}

interface TargetResetEvent {
  reason: "input-changed" | "cleared" | "disconnected";
}

function onTargetConnect(callback: (event: TargetConnectEvent) => void): () => void;
function onTargetReset(callback: (event: TargetResetEvent) => void): () => void;
```

```ts
import { ref, watch } from "vue";
import { useTarget, onTargetConnect, onTargetReset } from "@tmadmin/sdk";

const target = useTarget();
const deviceData = ref<string | null>(null);

// Динамическая реакция на ввод нового узла
watch(
  () => target.value?.host,
  (host) => {
    console.log("Текущий узел в шапке:", host ?? "не задан");
  },
  { immediate: true },
);

// Немедленная загрузка при нажатии «Подключиться»
onTargetConnect(async ({ host }) => {
  deviceData.value = await loadSomethingFor(host);
});

// Очистка состояния при изменении или стирании узла
onTargetReset(() => {
  deviceData.value = null;
});
```

---

### `usePluginStore`

Изолированное реактивное хранилище данных конкретного плагина (ключи автоматически изолируются префиксом `plugin:<pluginId>:`):

- `get<T>(key)` — чтение (без permissions).
- `set<T>(key, value, options?)` — запись (требует `store.write`).
  - `persist: "permanent"` — сохраняется на диск между перезапусками TMAdmin.
  - `persist: "temp"` (по умолчанию) — живёт в рамках текущей сессии.
- `remove(key)` — удаление (требует `store.write`).
- `entries` — реактивный `ComputedRef<Record<string, unknown>>` со всеми записями текущего плагина.

```ts
interface PluginStoreApi {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T, options?: { persist?: "permanent" | "temp" }): Promise<void>;
  remove(key: string): Promise<void>;
  entries: ComputedRef<Record<string, unknown>>;
}
```

```ts
import { usePluginStore } from "@tmadmin/sdk";

const store = usePluginStore();
const savedPath = store.get<string>("last_log_path") ?? "C:\\Logs";

await store.set("last_log_path", "D:\\Logs", { persist: "permanent" });
```

---

### `useSharedStore`

Общее хранилище и шина событий (Pub/Sub) для обмена данными между разными блоками и плагинами.

```ts
interface SharedStoreApi {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T, persist?: "permanent" | "temp"): Promise<void>;
  remove(key: string): Promise<void>;
  publish<T = unknown>(topic: string, data: T): void;
  subscribe<T = unknown>(topic: string, callback: (data: T) => void): () => void;
}
```

```ts
import { onUnmounted } from "vue";
import { useSharedStore } from "@tmadmin/sdk";

const shared = useSharedStore();

const unsubscribe = shared.subscribe<{ host: string }>("audit:completed", (payload) => {
  console.log("Завершён аудит для:", payload.host);
});

shared.publish("audit:completed", { host: "srv-app01" });

onUnmounted(() => {
  unsubscribe();
});
```

---

### `useExec`

Исполнение бинарников, сторонних утилит на хосте и потоковый сетевой ping через Rust-ядро.

```ts
interface ExecApi {
  /** Требует `process.exec` + `fs.external`. Выполняет бинарник из external/ и ждёт завершения. */
  pluginExec(relativePath: string, args?: string[]): Promise<ExecResult>;

  /** Требует `process.exec` + `fs.external`. Запускает фоновый процесс из external/ и возвращает PID. */
  pluginSpawn(relativePath: string, args?: string[]): Promise<ExecSpawnResult>;

  /** Требует `process.exec`. Запускает системную или стороннюю утилиту на хосте с опциональной рабочей папкой cwd. */
  hostSpawn(command: string, args?: string[], cwd?: string): Promise<ExecSpawnResult>;

  /** Требует `net.ping`. Запускает фоновую сессию пинга и возвращает sessionId. */
  pingStart(target: string): Promise<string>;

  /** Требует `net.ping`. Останавливает сессию пинга. */
  pingStop(id: string): Promise<void>;

  /** Требует `net.ping`. Подписка на события ping://<id>. */
  listenPing(id: string, handler: (payload: PingPayload) => void): Promise<() => void>;
}
```

Типы ответов:

```ts
interface ExecResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
}

interface ExecSpawnResult {
  pid: number;
}

interface PingPayload {
  seq: number;
  ms: number | null; // null при таймауте пакета
  ip: string;
}
```

Пример запуска бинарника из `external/` и системного пинга:

```ts
import { useExec, useTarget, useMessage } from "@tmadmin/sdk";

const exec = useExec();
const target = useTarget();
const message = useMessage();

// 1. Запуск утилиты из external/ с ожиданием вывода (нужны process.exec + fs.external)
const res = await exec.pluginExec("laps.exe", ["--computer", target.value?.host ?? ""]);
if (!res.success) {
  message.error(res.stderr || "Ошибка выполнения утилиты");
}

// 2. Запуск сторонней утилиты на хосте с рабочей папкой (нужен process.exec)
await exec.hostSpawn("C:\\Tools\\Sysinternals\\procexp64.exe", [], "C:\\Tools\\Sysinternals");

// 3. Потоковый ping (нужен net.ping)
const pingId = await exec.pingStart("192.168.1.10");
const unlisten = await exec.listenPing(pingId, (tick) => {
  console.log(`#${tick.seq} ${tick.ip}: ${tick.ms ?? "timeout"} ms`);
});
// Не забудьте остановить в onUnmounted:
// unlisten(); await exec.pingStop(pingId);
```

---

### `useFs` (`fs.read`, `fs.write`, `dir.read`, `dir.search`)

Безопасный доступ к текстовым файлам и директориям через Rust IPC (`fs_read`, `fs_write`, `dir_read`, `dir_search`).

Требуемые разрешения в `plugin.json`:
- `fs.read` — для `fs.read(...)`, `dir.read(...)`, `dir.search(...)`
- `fs.write` — для `fs.write(...)`

Правила безопасности путей (валидируются Zod на клиенте и в Rust-ядре):
- Запрещены пустые пути, null-байты (`\0`) и сегменты обхода директорий (`..`, например `../secret` или `logs\\..\\etc`).
- Ограничения по умолчанию и максимумы:
  - `maxBytes`: до `50 * 1024 * 1024` (50 MiB)
  - `maxEntries`: до `20 000` записей в `dir.read`
  - `maxDepth`: `0..50` уровней вложенности в `dir.search`
  - `maxResults`: до `5 000` совпадений в `dir.search`

#### Интерфейс API

```ts
interface FsApi {
  fs: {
    /**
     * Прочитать текстовый файл. Требует `fs.read`.
     * IPC: `fs_read`.
     */
    read(path: string, options?: { maxBytes?: number }): Promise<FsReadResult>;

    /**
     * Записать или дозаписать текстовый файл. Требует `fs.write`.
     * IPC: `fs_write`.
     */
    write(
      path: string,
      content: string,
      options?: { append?: boolean; createDirs?: boolean },
    ): Promise<FsWriteResult>;
  };

  dir: {
    /**
     * Прочитать список файлов и папок в директории. Требует `fs.read`.
     * IPC: `dir_read`.
     */
    read(
      path: string,
      options?: { recursive?: boolean; maxEntries?: number },
    ): Promise<DirReadResult>;

    /**
     * Найти файлы/папки по шаблону (glob или подстрока). Требует `fs.read`.
     * IPC: `dir_search`.
     */
    search(
      path: string,
      pattern: string,
      options?: {
        recursive?: boolean;
        maxDepth?: number;
        maxResults?: number;
        caseSensitive?: boolean;
        includeDirs?: boolean;
      },
    ): Promise<DirSearchResult>;
  };
}
```

#### Типы данных `useFs`

```ts
interface FsReadResult {
  content: string;
  size: number;
  path: string;
}

interface FsWriteResult {
  bytesWritten: number;
  path: string;
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  size: number;
  modifiedMs?: number | null;
}

interface DirReadResult {
  entries: DirEntry[];
  truncated: boolean;
}

interface DirSearchResult {
  matches: DirEntry[];
  truncated: boolean;
}
```

#### Пример использования `useFs`

```ts
import { useFs, useMessage } from "@tmadmin/sdk";

const { fs, dir } = useFs();
const message = useMessage();

// Поиск всех .log файлов в папке (до 3 уровней вглубь, макс. 200 результатов)
const searchRes = await dir.search("C:\\ProgramData\\App\\Logs", "*.log", {
  recursive: true,
  maxDepth: 3,
  maxResults: 200,
  caseSensitive: false,
});

// Чтение первого найденного файла (ограничим размер чтения 2 MiB)
if (searchRes.matches.length > 0) {
  const fileData = await fs.read(searchRes.matches[0].path, {
    maxBytes: 2 * 1024 * 1024,
  });
  console.log(`Прочитано ${fileData.size} байт из ${fileData.path}`);
}

// Листинг директории без рекурсии
const listing = await dir.read("C:\\ProgramData\\App\\Logs", {
  recursive: false,
  maxEntries: 500,
});

// Экспорт отчёта с автоматическим созданием директорий (требует fs.write)
const writeRes = await fs.write(
  "exports/audit-summary.txt",
  `Найдено файлов: ${listing.entries.length}\n`,
  { append: false, createDirs: true },
);
message.success(`Сохранено ${writeRes.bytesWritten} байт в ${writeRes.path}`);
```

---

### `useTerminal`

Работа со встроенным PTY-терминалом workspace.

Важное разделение:
- **Отправка команды в терминал workspace** (`runCommand`, `sendTerminalCommand`) работает через Pub/Sub шину и **не требует** разрешения `terminal`. Это рекомендуемый способ интеграции с терминалом из других блоков (кнопки диагностики, скрипты PSExec/PowerShell).
- **Прямое управление PTY-сессией** (`spawn`, `write`, `execScript`, `kill`, `listen`) требует разрешения `terminal` в `plugin.json`.

```ts
interface TerminalApi {
  /** Требует `terminal`. Создать новую PTY-сессию. */
  spawn(options?: {
    shell?: "powershell" | "pwsh" | "cmd" | "sh" | "bash";
    cwd?: string;
    target?: string;
  }): Promise<{ id: string }>;

  /** Требует `terminal`. Записать строку в stdin PTY. */
  write(id: string, data: string): Promise<void>;

  /** Требует `terminal`. Выполнить скрипт (bat/ps1) в активной PTY-сессии. */
  execScript(id: string, script: string): Promise<void>;

  /** Требует `terminal`. Завершить PTY-сессию. */
  kill(id: string): Promise<void>;

  /** Требует `terminal`. Подписаться на поток вывода pty://<id>. */
  listen(
    id: string,
    handler: (payload: { seq: number; data: string; stream: "stdout" | "stderr" | "system" }) => void,
  ): Promise<() => void>;

  /** Без permission. Отправить команду на выполнение в активный блок терминала workspace. */
  runCommand(command: string, options?: TerminalRunCommandOptions): void;

  /** Подписаться на входящие команды запуска (для блоков-терминалов). */
  onRunCommand(handler: (payload: TerminalRunCommandPayload) => void): () => void;
}
```

```ts
import { useTerminal, useTarget } from "@tmadmin/sdk";

const terminal = useTerminal();
const target = useTarget();

function runIpconfig(): void {
  const host = target.value?.host;
  if (!host) return;
  terminal.runCommand(`Test-Connection -ComputerName ${host} -Count 4`, {
    target: host,
    immediate: true,
    title: "Проверка доступности (PowerShell)",
  });
}
```

---

### `useSecrets`

Чтение, сохранение и удаление паролей/токенов в системном хранилище ключей (Windows Credential Manager / macOS Keychain / Secret Service). Требует разрешения `keychain`.

Ключи автоматически привязываются к плагину (`<pluginId>.<key>`), а `get(key)` дополнительно поддерживает fallback на общий ключ и пользовательские настройки (`settings.custom[key]`).

```ts
interface SecretsApi {
  get(key: string): Promise<string | null>;
  set(key: string, secret: string): Promise<void>;
  delete(key: string): Promise<boolean>;
}
```

```ts
import { useSecrets } from "@tmadmin/sdk";

const secrets = useSecrets();

await secrets.set("api_token", "secret-token-value");
const token = await secrets.get("api_token");
```

---

### `useMessage`

Всплывающие уведомления (toast) на базе Naive UI `useMessage()` с безопасным fallback вне дерева компонентов. Не требует дополнительных разрешений.

```ts
interface PluginMessageApi {
  info(content: string, options?: PluginMessageOptions): void;
  success(content: string, options?: PluginMessageOptions): void;
  warning(content: string, options?: PluginMessageOptions): void;
  error(content: string, options?: PluginMessageOptions): void;
  loading(content: string, options?: PluginMessageOptions): void;
}

interface PluginMessageOptions {
  duration?: number;
  closable?: boolean;
  keepAliveOnHover?: boolean;
}
```

```ts
import { useMessage } from "@tmadmin/sdk";

const message = useMessage();
message.success("Конфигурация применена", { duration: 3000 });
```

---

### `Chart.js` (`Chart`, `registerables`)

Встроенная библиотека для построения графиков в реальном времени. Доступна как через `@tmadmin/sdk`, так и через прямой импорт `chart.js` / `chart.js/auto`.

```ts
import { onMounted, onUnmounted, ref } from "vue";
import { Chart, registerables } from "@tmadmin/sdk";

Chart.register(...registerables);

const canvasRef = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

onMounted(() => {
  if (!canvasRef.value) return;
  chart = new Chart(canvasRef.value, {
    type: "line",
    data: {
      labels: ["1", "2", "3"],
      datasets: [{ label: "RTT (ms)", data: [12, 15, 11] }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
});

onUnmounted(() => {
  chart?.destroy();
});
```

---

## 7. Полный пример плагина (`blocks/*.vue` + `lib/*.ts`)

Ниже приведён рабочий пример плагина **`acme.log-inspector`**, который использует `lib/logParser.ts`, `useTarget()`, `usePluginStore()`, `useFs()` (`dir.search`, `fs.read`, `fs.write`) и `useMessage()`.

### `lib/logParser.ts`

```ts
export interface ParsedLogLine {
  lineNumber: number;
  level: "ERROR" | "WARN" | "INFO";
  text: string;
}

export function extractErrors(content: string, maxLines = 100): ParsedLogLine[] {
  const lines = content.split(/\r?\n/);
  const result: ParsedLogLine[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/error|exception|fail/i.test(line)) {
      result.push({ lineNumber: i + 1, level: "ERROR", text: line });
    } else if (/warn/i.test(line)) {
      result.push({ lineNumber: i + 1, level: "WARN", text: line });
    }
    if (result.length >= maxLines) break;
  }

  return result;
}
```

### `blocks/LogViewer.vue`

```vue
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  defineBlock,
  useTarget,
  usePluginStore,
  useFs,
  useMessage,
} from "@tmadmin/sdk";
import { NButton, NInput, NSpace, NTag, NText, NList, NListItem } from "naive-ui";
import { SearchOutline, DownloadOutline } from "@vicons/ionicons5";
import { extractErrors, type ParsedLogLine } from "../lib/logParser";

defineBlock({
  title: "Просмотр логов",
  description: "Поиск ошибок в логах на целевом узле",
  icon: "DocumentTextOutline",
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 5 },
});

const target = useTarget();
const store = usePluginStore();
const { fs, dir } = useFs();
const message = useMessage();

const folderSubpath = ref<string>(store.get<string>("subpath") ?? "c$\\Logs");
const loading = ref(false);
const findings = ref<ParsedLogLine[]>([]);

const targetBasePath = computed<string>(() => {
  const host = target.value?.host;
  return host ? `\\\\${host}\\${folderSubpath.value}` : "";
});

watch(folderSubpath, (val) => {
  void store.set("subpath", val, { persist: "permanent" });
});

async function scanLogs(): Promise<void> {
  if (!targetBasePath.value) {
    message.warning("Укажите целевой ПК в шапке workspace");
    return;
  }

  loading.value = true;
  findings.value = [];

  try {
    const searchRes = await dir.search(targetBasePath.value, "*.log", {
      recursive: true,
      maxDepth: 2,
      maxResults: 20,
    });

    if (searchRes.matches.length === 0) {
      message.info("Файлы *.log не найдены");
      return;
    }

    const latestFile = searchRes.matches[0];
    if (!latestFile) return;

    const fileContent = await fs.read(latestFile.path, { maxBytes: 1024 * 1024 });
    findings.value = extractErrors(fileContent.content);
    message.success(`Проанализирован файл ${latestFile.name}: найдено ${findings.value.length} записей`);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

async function exportFindings(): Promise<void> {
  if (findings.value.length === 0) return;
  const host = target.value?.host ?? "unknown";
  const report = findings.value
    .map((item) => `[L${item.lineNumber}] [${item.level}] ${item.text}`)
    .join("\n");

  try {
    const res = await fs.write(`exports/${host}-errors.txt`, `${report}\n`, {
      createDirs: true,
    });
    message.success(`Отчёт сохранён (${res.bytesWritten} байт): ${res.path}`);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}
</script>

<template>
  <div class="log-viewer">
    <n-space align="center" justify="space-between" style="margin-bottom: 8px">
      <n-text depth="3">Путь: {{ targetBasePath || "не выбран target" }}</n-text>
      <n-space>
        <n-input v-model:value="folderSubpath" size="small" placeholder="c$\Logs" style="width: 160px" />
        <n-button size="small" type="primary" :loading="loading" @click="scanLogs">
          <template #icon><SearchOutline /></template>
          Сканировать
        </n-button>
        <n-button size="small" :disabled="findings.length === 0" @click="exportFindings">
          <template #icon><DownloadOutline /></template>
          Экспорт
        </n-button>
      </n-space>
    </n-space>

    <n-list bordered size="small" class="log-list">
      <n-list-item v-for="item in findings" :key="item.lineNumber">
        <n-space align="center" :wrap="false">
          <n-tag :type="item.level === 'ERROR' ? 'error' : 'warning'" size="small">
            {{ item.level }}
          </n-tag>
          <n-text code>#{{ item.lineNumber }}</n-text>
          <n-text>{{ item.text }}</n-text>
        </n-space>
      </n-list-item>
    </n-list>
  </div>
</template>

<style scoped>
.log-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.log-list {
  flex: 1;
  overflow: auto;
}
</style>
```

---

## 8. Упаковка и публикация в Plugin Market

1. Проверьте, что в корне архива `plugin.zip` лежат `plugin.json`, `blocks/`, при необходимости `lib/` и `external/` (без лишней вложенной папки-обёртки).
2. Вычислите контрольную сумму `SHA-256` для `plugin.zip` (64 hex-символа).
3. Опубликуйте релиз в репозитории реестра **TMAdminPlugins** согласно спецификации [docs/MARKET.md](./MARKET.md).
4. Для локальной установки без публикации используйте **Plugin Market → Добавить локальный плагин** (выбор папки с `plugin.json` или `.zip`-архива) либо кнопку **«Установить в TMAdmin»** в Developer Studio — оба варианта сохраняют плагин на диск с меткой «Локальный».

---

## 9. Руководство для ИИ-агентов (AI Plugin Authoring Guide)

Этот раздел предназначен для ИИ-ассистентов и автономных агентов (LLM), которым поручено разработать или модифицировать плагин для TMAdmin.

### Краткий контекст платформы
- **TMAdmin** — десктопная оболочка для системных администраторов на базе **Tauri 2 (Rust) + Vue 3 + TypeScript + Naive UI**.
- Плагины компилируются **в рантайме** (`@vue/compiler-sfc`) внутри изолированной песочницы.
- **Один блок = один файл `blocks/<Name>.vue`** с `<script setup lang="ts">`. Вспомогательная логика выносится в `lib/*.ts`.

### Жёсткие ограничения песочницы (MUST FOLLOW)
1. **Разрешённые импорты**: только `vue`, `naive-ui`, `@vicons/ionicons5`, `chart.js`, `@tmadmin/sdk` и относительные пути (`./`, `../`) внутри папки плагина.
2. **Запрещено**: `fs`, `path`, `child_process`, `os`, `fetch` к локальному API Tauri напрямую (`@tauri-apps/api`), `window.__TAURI_INTERNALS__`, `eval`, доступ к внутренним store оболочки (`@/stores/*`). Все системные операции выполняются **только через `@tmadmin/sdk`**.
3. **Разрешения в `plugin.json`**: любая операция SDK проверяет `permissions` в рантайме. Матрица соответствия:
   - `useExec().pluginExec / pluginSpawn` → `["process.exec", "fs.external"]`
   - `useExec().hostSpawn` → `["process.exec"]`
   - `useExec().pingStart / pingStop / listenPing` → `["net.ping"]`
   - `useFs().fs.read / dir.read / dir.search` → `["fs.read"]`
   - `useFs().fs.write` → `["fs.write"]`
   - `usePluginStore().set / remove`, `useSharedStore().set / remove` → `["store.write"]`
   - `useSecrets().get / set / delete` → `["keychain"]`
   - `useTerminal().spawn / write / execScript / kill / listen` → `["terminal"]` (`runCommand` работает без прав)

### Обязательный шаблон жизненного цикла блока
```vue
<script setup lang="ts">
import { ref } from "vue";
import { NButton, NCard, NEmpty, NSpace, NTag } from "naive-ui";
import { useTarget, onTargetConnect, onTargetReset, useMessage } from "@tmadmin/sdk";

const target = useTarget();
const message = useMessage();
const loading = ref(false);
const result = ref<string | null>(null);

async function loadData(host?: string): Promise<void> {
  const targetHost = (host ?? target.value?.host)?.trim();
  if (!targetHost) return;
  loading.value = true;
  try {
    // Вызов useExec / useFs / useSecrets ...
    result.value = `OK: ${targetHost}`;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

// 1. Автозагрузка при нажатии «Подключиться» в шапке
onTargetConnect(({ host }) => {
  void loadData(host);
});

// 2. Мгновенный сброс при изменении или очистке узла в шапке
onTargetReset(() => {
  result.value = null;
  loading.value = false;
});
</script>
```

### Правила UI для ИИ-агентов
- Всегда используйте компоненты **Naive UI** (`n-button`, `n-input`, `n-tag`, `n-space`, `n-empty`, `n-spin`, `n-select`, `n-data-table`), а не самописные аналоги.
- Используйте CSS-переменные темы (`var(--tm-tx)`, `var(--tm-mut)`, `var(--tm-accent)`, `var(--tm-panel)`, `var(--tm-line)`) — не хардкодьте цвета фона/текста, чтобы блок работал в светлой и тёмной темах и поверх кастомного фона.
- Блок рендерится внутри изменяемого контейнера 24-колоночной сетки: задавайте корневому элементу `height: 100%; width: 100%; min-width: 0; min-height: 0; overflow: hidden;` и прокручиваемую внутреннюю область при необходимости.
- Идентификаторы `id` в `plugin.json` — только в `kebab-case` (`my-custom-plugin`), `version` — строгий SemVer (`1.0.0`).
