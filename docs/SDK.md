# TMAdmin Plugin SDK — Документация разработчика

Официальное руководство по созданию плагинов и блоков для **TMAdmin** (Tauri 2 + Vue 3 + TypeScript + Naive UI).

---

## Оглавление

1. [Введение и модель песочницы](#1-введение-и-модель-песочницы)
2. [Структура плагина](#2-структура-плагина)
3. [Манифест `plugin.json`](#3-манифест-pluginjson)
4. [Разрешения (Permissions)](#4-разрешения-permissions)
5. [Разрешённые импорты в песочнице](#5-разрешённые-импорты-в-песочнице)
6. [Настройки блока (`settingsSchema` и `WorkspaceBlock`)](#6-настройки-блока-settingsschema-и-workspaceblock)
   - [Схема `settingsSchema`](#61-схема-settingsschema)
   - [Получение настроек внутри блока (`:block="block"`)](#62-получение-настроек-внутри-блока-blockblock)
   - [Текущее поведение `BlockSettingsModal` и рекомендации](#63-текущее-поведение-blocksettingsmodal-и-рекомендации)
7. [Справочник API (`@tmadmin/sdk`)](#7-справочник-api-tmadminsdk)
   - [`defineBlock`](#defineblock)
   - [`useTarget`, `onTargetConnect`, `onTargetReset`](#usetarget-ontargetconnect-ontargetreset)
   - [`usePluginStore`](#usepluginstore)
   - [`useSharedStore`](#usesharedstore)
   - [`useExec` и `powershellExec`](#useexec-и-powershellexec)
   - [`useHttp` и `axios`](#usehttp-и-axios)
   - [`useSocket`, `io` и `socket.io-client`](#usesocket-io-и-socketio-client)
   - [`useFs` (`fs.read`, `fs.write`, `dir.read`, `dir.search`)](#usefs-fsread-fswrite-dirread-dirsearch)
   - [`useTerminal`](#useterminal)
   - [`useSecrets`](#usesecrets)
   - [`useMessage`](#usemessage)
   - [`PermissionDeniedError`](#permissiondeniederror)
   - [`Chart.js` (`Chart`, `registerables`)](#chartjs-chart-registerables)
8. [Полный пример плагина](#8-полный-пример-плагина)
9. [Упаковка и публикация в Plugin Market](#9-упаковка-и-публикация-в-plugin-market)
10. [Руководство для ИИ-агентов (AI Plugin Authoring Guide)](#10-руководство-для-ии-агентов-ai-plugin-authoring-guide)

---

## 1. Введение и модель песочницы

Плагины в TMAdmin состоят из **блоков** — независимых Vue 3 Single-File Components (`*.vue`), которые компилируются в рантайме (`@vue/compiler-sfc`), отображаются на 24-колоночной сетке workspace и взаимодействуют с операционной системой и сетью через типизированный SDK `@tmadmin/sdk`.

Ключевые принципы:
- **Изоляция (Sandbox)**: код плагина не имеет прямого доступа к Node.js, произвольным npm-пакетам, внутренним сторам приложения и прямым Tauri IPC вызовам. Разрешены только UI-библиотеки (`vue`, `naive-ui`, `@vicons/ionicons5`, `chart.js`), сетевые клиенты в изолированных scoped-обёртках (`axios`, `socket.io-client`), `@tmadmin/sdk` и локальные модули самого плагина.
- **Принцип наименьших привилегий**: доступ к системным и сетевым операциям (ping, HTTP-запросы, WebSocket/Socket.IO, запуск процессов и PowerShell, чтение/запись файлов, терминал, keychain) открывается только при наличии соответствующего разрешения в массиве `permissions` файла `plugin.json`. При отсутствии права SDK выбрасывает `PermissionDeniedError`.
- **Target-ориентированность**: текущий целевой хост (`target`) задаётся один раз в шапке workspace и доступен любому блоку реактивно через `useTarget()`, а жизненный цикл подключения отслеживается через `onTargetConnect()` и `onTargetReset()`.

---

## 2. Структура плагина

```text
my-plugin/
├── plugin.json             # Манифест плагина (обязательный, валидируется Zod)
├── blocks/                 # Vue 3 SFC-компоненты блоков
│   └── LogViewer.vue
├── lib/                    # Общая TypeScript-логика и утилиты плагина
│   └── logParser.ts
└── external/               # Опционально: сторонние бинарники (.exe / CLI-утилиты)
    └── tool.exe
```

Правила организации кода:
- Один блок = один файл `blocks/<BlockName>.vue` с `<script setup lang="ts">`.
- Повторно используемую логику, парсеры, клиенты и типы выносите в `lib/*.ts` (разрешены импорты из `vue`, `@tmadmin/sdk`, `axios`, `socket.io-client` и относительные импорты внутри плагина).
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
      "minSize": { "w": 6, "h": 5 },
      "settingsSchema": {
        "defaultSubpath": {
          "type": "string",
          "label": "Подпапка логов",
          "default": "c$\\Logs",
          "required": true
        },
        "maxResults": {
          "type": "number",
          "label": "Максимум файлов",
          "default": 20,
          "min": 1,
          "max": 200,
          "step": 1
        }
      }
    }
  ]
}
```

### Поля корневого объекта

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `id` | `string` | Да | Уникальный идентификатор плагина (`[a-z0-9_.-]`, 1–64 символа, без начальных/конечных точек и `..`). Рекомендуется формат `vendor.name` или `kebab-case`. |
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
| `id` | `string` | Да | Уникальный ID блока внутри плагина (`[a-z0-9-_]`, начинается с буквы или цифры). |
| `title` | `string` | Да | Заголовок блока в палитре и на сетке. |
| `entry` | `string` | Да | Относительный путь к SFC-файлу (например, `"blocks/LogViewer.vue"`). |
| `icon` | `string` | Нет | Иконка блока (`@vicons/ionicons5`). |
| `description` | `string` | Нет | Описание назначения блока. |
| `defaultSize` | `{ w: number; h: number }` | Да | Стартовый размер в 24-колоночной сетке (`1 <= w <= 24`, `h >= 1`). Должен быть `>= minSize`. |
| `minSize` | `{ w: number; h: number }` | Да | Минимально допустимый размер блока (`1 <= w <= 24`, `h >= 1`). |
| `settingsSchema` | `BlockSettingsSchemaDef` | Нет | Декларативная схема пользовательских настроек блока. Подробнее — в разделе [Настройки блока](#6-настройки-блока-settingsschema-и-workspaceblock). |

---

## 4. Разрешения (Permissions)

Все защищённые методы SDK и сетевых обёрток проверяют наличие разрешения в массиве `permissions` манифеста `plugin.json`. Если разрешение не указано, выбрасывается `PermissionDeniedError`.

| Разрешение | Какие API открывает | Описание |
|---|---|---|
| `net.ping` | `useExec().pingStart`, `pingStop`, `listenPing` | Запуск и чтение потока ICMP-пинга до целевого хоста. |
| `net.http` | `axios`, `useHttp()`, `axios.create()`, `new axios.Axios()` | Выполнение HTTP/HTTPS-запросов к внешним и локальным REST/Web API. |
| `net.socket` | `socket.io-client`, `useSocket()`, `io`, `connect`, `Manager` | Установка и управление WebSocket / Socket.IO-соединениями. |
| `process.exec` | `useExec().powershellExec`, `powershellExec` (из `@tmadmin/sdk`), `useExec().hostSpawn`, а также `pluginExec` и `pluginSpawn` (совместно с `fs.external`) | Выполнение PowerShell-скриптов (без необходимости `fs.external` и `terminal`), запуск системных/сторонних утилит на хосте и бинарников плагина через Rust-ядро. |
| `fs.external` | `useExec().pluginExec`, `pluginSpawn` (совместно с `process.exec`) | Доступ к исполняемым файлам в директории `external/` плагина. |
| `fs.read` | `useFs().fs.read`, `useFs().dir.read`, `useFs().dir.search` | Чтение текстовых файлов, просмотр содержимого директорий и поиск файлов. |
| `fs.write` | `useFs().fs.write` | Создание, перезапись и дозапись текстовых файлов. |
| `ldap.query` | Доменные запросы Active Directory | Чтение карточек и атрибутов объектов Active Directory. |
| `store.write` | `usePluginStore().set/remove`, `useSharedStore().set/remove` | Запись и удаление данных в персистентном/временном хранилище. Чтение (`get`) и Pub/Sub (`publish`/`subscribe`) доступны без этого права. |
| `terminal` | `useTerminal().spawn`, `write`, `execScript`, `kill`, `listen` | Прямое создание и управление PTY-сессиями встроенного терминала. Методы `runCommand` / `onRunCommand`, свойство `useTerminal().settings` и хук `useTerminalSettings()` работают без `terminal`. |
| `keychain` | `useSecrets().get`, `set`, `delete` | Хранение и чтение паролей/токенов в системном менеджере ключей (OS Keychain). |

---

## 5. Разрешённые импорты в песочнице

В файлах `blocks/*.vue` и `lib/*.ts` резолвер песочницы (`createSandboxedResolver`) разрешает импортировать **только** следующие модули:

- `vue` — Composition API (`ref`, `reactive`, `computed`, `watch`, `onMounted`, `onUnmounted` и др.)
- `@tmadmin/sdk` — все хуки, классы и хелперы TMAdmin SDK (включая `powershellExec`, `useHttp`, `axios`, `useSocket`, `io`, `PermissionDeniedError`)
- `naive-ui` — UI-компоненты Naive UI (также компоненты автоматически доступны в `<template>` блоков, например `<n-button>`, `<n-input>`, `<n-data-table>`)
- `@vicons/ionicons5` — векторные иконки Ionicons 5
- `chart.js` и `chart.js/auto` — построение графиков (также экспортируются из `@tmadmin/sdk`)
- `axios` — HTTP/HTTPS-клиент (поддерживается default-импорт `import axios from "axios"` и именованные импорты, например `AxiosError`, `HttpStatusCode`, `isAxiosError`)
- `socket.io-client` — Socket.IO-клиент (поддерживается default-импорт и именованные импорты `{ io, connect, Manager, Socket }`)
- Относительные пути внутри плагина — `./...`, `../...` (автоматически разрешаются файлы `.ts`, `.js`, `.json`, а также `index.ts` и `index.js`)

### Автоматические scoped-обёртки для `axios` и `socket.io-client`

При импорте `"axios"` или `"socket.io-client"` плагин получает **не глобальный экземпляр пакета**, а изолированную **scoped-обёртку**, привязанную к `PluginContext` данного плагина:

- Импорт `"axios"` подставляет scoped-обёртку, которая перед выполнением каждого запроса (включая дочерние клиенты `axios.create()` и `new axios.Axios()`) проверяет наличие разрешения `net.http` в `plugin.json`.
- Импорт `"socket.io-client"` подставляет scoped-обёртку поверх `io`, `connect` и `Manager`, которая перед созданием или открытием сокета проверяет наличие разрешения `net.socket` в `plugin.json`.
- При отсутствии соответствующего разрешения обе обёртки выбрасывают `PermissionDeniedError`.

Импорт любых других сторонних npm-пакетов или встроенных модулей Node.js (`fs`, `path`, `child_process`, `os`, `http`, `net` и др.) будет немедленно отклонён резолвером песочницы с ошибкой.

---

## 6. Настройки блока (`settingsSchema` и `WorkspaceBlock`)

В TMAdmin предусмотрена декларативная схема пользовательских настроек блока `settingsSchema` (в `plugin.json` и `defineBlock`) и модель экземпляра блока `WorkspaceBlock`, передаваемая блоку через prop `:block="block"`.

### 6.1. Схема `settingsSchema`

`settingsSchema` (`BlockSettingsSchemaDef`) представляет собой объект-словарь `{ [key: string]: BlockSettingField }`.

#### Правила валидации ключей (`BlockSettingKeySchema`)

- Разрешены только латинские буквы, цифры, подчёркивание и дефис: `/^[a-zA-Z0-9_-]+$/`.
- Длина ключа: от `1` до `64` символов.
- Запрещены зарезервированные ключи прототипа: `__proto__`, `constructor`, `prototype`.

#### Поддерживаемые типы полей (`BlockSettingField`)

Схема поддерживает 4 типа полей (`type`): `"string"`, `"number"`, `"boolean"`, `"select"`.

##### 1. Строковое поле (`type: "string"`)

| Свойство | Тип | Описание и ограничения |
|---|---|---|
| `type` | `"string"` | Обязательный дискриминатор типа. |
| `label` | `string` | Отображаемая подпись поля (непустая строка). |
| `description` | `string` | Пояснение / подсказка под полем. |
| `default` | `string` | Значение по умолчанию. Должно укладываться в `[minLength, maxLength]`, если они заданы. |
| `placeholder` | `string` | Текст-заполнитель в пустом инпуте. |
| `format` | `"text" \| "textarea" \| "password" \| "file" \| "directory"` | Семантический формат поля (`BlockSettingStringFormat`). |
| `secret` | `boolean` | Признак чувствительного значения (маскировка ввода). |
| `multiline` | `boolean` | Многострочный ввод. |
| `required` | `boolean` | Обязательность заполнения. |
| `minLength` | `number` | Целое число `>= 0`. |
| `maxLength` | `number` | Целое число `> 0`. Должно быть `>= minLength`. |
| `pattern` | `string` | Регулярное выражение для валидации строки (непустая строка). |

##### 2. Числовое поле (`type: "number"`)

| Свойство | Тип | Описание и ограничения |
|---|---|---|
| `type` | `"number"` | Обязательный дискриминатор типа. |
| `label` | `string` | Отображаемая подпись поля (непустая строка). |
| `description` | `string` | Пояснение к настройке. |
| `default` | `number` | Конечное число по умолчанию. Должно находиться в диапазоне `[min, max]`, если границы заданы. |
| `placeholder` | `string` | Текст-заполнитель. |
| `min` | `number` | Минимальное конечное значение. |
| `max` | `number` | Максимальное конечное значение (`>= min`). |
| `step` | `number` | Шаг изменения (конечное положительное число `> 0`). |
| `required` | `boolean` | Обязательность заполнения. |

##### 3. Логическое поле (`type: "boolean"`)

| Свойство | Тип | Описание и ограничения |
|---|---|---|
| `type` | `"boolean"` | Обязательный дискриминатор типа. |
| `label` | `string` | Отображаемая подпись переключателя (непустая строка). |
| `description` | `string` | Пояснение к настройке. |
| `default` | `boolean` | Значение по умолчанию (`true` / `false`). |

##### 4. Выпадающий список (`type: "select"`)

| Свойство | Тип | Описание и ограничения |
|---|---|---|
| `type` | `"select"` | Обязательный дискриминатор типа. |
| `options` | `Array<string \| { label: string; value: string \| number }>` | **Обязательно** (минимум 1 элемент). Строковые опции и `label` не должны быть пустыми. |
| `default` | `string \| number \| Array<string \| number>` | Значение по умолчанию. Если `multiple: true`, `default` **обязательно должен быть массивом**; если `multiple` не `true`, массив запрещён. |
| `label` | `string` | Отображаемая подпись поля (непустая строка). |
| `description` | `string` | Пояснение к настройке. |
| `placeholder` | `string` | Текст-заполнитель. |
| `multiple` | `boolean` | Множественный выбор значений. |
| `filterable` | `boolean` | Разрешить поиск по опциям. |
| `tag` | `boolean` | Разрешить ввод пользовательских значений (тегов). |
| `required` | `boolean` | Обязательность выбора. |

#### Пример `settingsSchema` в `plugin.json`

```json
{
  "id": "service-monitor",
  "title": "Монитор служб",
  "entry": "blocks/ServiceMonitor.vue",
  "defaultSize": { "w": 12, "h": 6 },
  "minSize": { "w": 6, "h": 4 },
  "settingsSchema": {
    "apiBaseUrl": {
      "type": "string",
      "label": "URL API мониторинга",
      "placeholder": "https://monitor.corp.local/api",
      "format": "text",
      "required": true,
      "pattern": "^https?://"
    },
    "exportDir": {
      "type": "string",
      "label": "Папка выгрузки отчётов",
      "format": "directory",
      "default": "C:\\Reports"
    },
    "pollIntervalSec": {
      "type": "number",
      "label": "Интервал опроса (сек)",
      "default": 15,
      "min": 5,
      "max": 300,
      "step": 5
    },
    "autoRefresh": {
      "type": "boolean",
      "label": "Автообновление",
      "description": "Автоматически запрашивать статус при подключении к ПК",
      "default": true
    },
    "trackedServices": {
      "type": "select",
      "label": "Отслеживаемые службы",
      "multiple": true,
      "filterable": true,
      "tag": true,
      "default": ["Spooler", "W32Time"],
      "options": [
        { "label": "Диспетчер печати (Spooler)", "value": "Spooler" },
        { "label": "Служба времени (W32Time)", "value": "W32Time" },
        "WinRM"
      ]
    }
  }
}
```

#### Пример `settingsSchema` в `defineBlock`

```ts
import { defineBlock, type BlockSettingsSchemaDef } from "@tmadmin/sdk";

const settingsSchema: BlockSettingsSchemaDef = {
  apiBaseUrl: {
    type: "string",
    label: "URL API мониторинга",
    format: "text",
    required: true,
  },
  pollIntervalSec: {
    type: "number",
    label: "Интервал опроса (сек)",
    default: 15,
    min: 5,
    max: 300,
    step: 5,
  },
  autoRefresh: {
    type: "boolean",
    label: "Автообновление",
    default: true,
  },
};

defineBlock({
  title: "Монитор служб",
  description: "Контроль состояния служб Windows на целевом узле",
  icon: "ServerOutline",
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 4 },
  settingsSchema,
});
```

---

### 6.2. Получение настроек внутри блока (`:block="block"`)

При размещении блока на сетке workspace оболочка (`WorkspaceGrid.vue`) передаёт компоненту блока единственный prop `:block="block"` типа `WorkspaceBlock`:

```ts
interface WorkspaceBlock {
  id: string;
  pluginId: string;
  blockId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
  fillAvailable?: boolean;
}
```

Правила работы с `props.block`:
1. **Делайте prop `block` опциональным**: `defineProps<{ block?: WorkspaceBlock }>()`. В режиме предпросмотра (например, в Developer Studio или изолированном стенде) компонент может монтироваться без объекта `WorkspaceBlock`.
2. **Пользовательские настройки читайте из `props.block?.config?.<key>`** с безопасным значением по умолчанию.
3. **Встроенные поля экземпляра `WorkspaceBlock`**:
   - `props.block?.config?.title` / `props.block?.config?.customTitle` (`string`) — пользовательский заголовок блока, заданный в модалке настроек контейнера;
   - `props.block?.fillAvailable` (`boolean | undefined`) — включён ли адаптивный полноразмерный режим («Использовать всё доступное место»).

```ts
import { computed } from "vue";
import type { WorkspaceBlock } from "@tmadmin/sdk";

const props = defineProps<{
  block?: WorkspaceBlock;
}>();

const pollIntervalSec = computed<number>(() => {
  const raw = props.block?.config?.pollIntervalSec;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 15;
});

const isFillAvailable = computed<boolean>(() => Boolean(props.block?.fillAvailable));
```

---

### 6.3. Текущее поведение `BlockSettingsModal` и рекомендации

Важно учитывать текущую реализацию окна настроек блока (`BlockSettingsModal.vue`):

- Сейчас стандартное модальное окно настроек блока отображает:
  - общие настройки контейнера для любого блока: **«Заголовок блока»** (`config.title`) и переключатель **«Использовать всё доступное место»** (`block.fillAvailable`);
  - встроенные секции для отдельных системных блоков (LAPS, `osaitp-cards`, список кнопок для `quick-actions`/`vnc`).
- **Автоматическая генерация полей формы в `BlockSettingsModal` по произвольной `settingsSchema` стороннего плагина на данный момент ещё не подключена в UI модалки** (сама схема `settingsSchema` уже валидируется в `plugin.json` и поддерживается на уровне типов `defineBlock` и контрактов).

#### Как правильно делать настройки в плагине сейчас

Чтобы пользователь мог удобно настраивать ваш плагин уже сейчас, рекомендуется:
1. Хранить пользовательские настройки через `usePluginStore()` (`persist: "permanent"`, требует `store.write` в `plugin.json`) и предусмотреть компактный UI настроек внутри самого блока (например, кнопку с иконкой шестерёнки `SettingsOutline` + `<n-modal>`, `<n-drawer>` или `<n-popover>`).
2. При чтении значения в блоке использовать приоритет: `props.block?.config?.<key>` → `store.get(...)` → значение по умолчанию. Это обеспечит плавную совместимость в будущем, когда оболочка начнёт автоматически рендерить `settingsSchema` в `BlockSettingsModal`.

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NDrawer, NDrawerContent, NForm, NFormItem, NIcon, NInputNumber, NSwitch } from "naive-ui";
import { SettingsOutline } from "@vicons/ionicons5";
import { usePluginStore, useMessage, type WorkspaceBlock } from "@tmadmin/sdk";

const props = defineProps<{ block?: WorkspaceBlock }>();
const store = usePluginStore();
const message = useMessage();

const settingsOpen = ref(false);
const draftInterval = ref<number>(store.get<number>("pollIntervalSec") ?? 15);
const draftAutoRefresh = ref<boolean>(store.get<boolean>("autoRefresh") ?? true);

const pollIntervalSec = computed<number>(() => {
  const fromBlock = props.block?.config?.pollIntervalSec;
  if (typeof fromBlock === "number") return fromBlock;
  return store.get<number>("pollIntervalSec") ?? 15;
});

async function saveSettings(): Promise<void> {
  await store.set("pollIntervalSec", draftInterval.value, { persist: "permanent" });
  await store.set("autoRefresh", draftAutoRefresh.value, { persist: "permanent" });
  settingsOpen.value = false;
  message.success(`Настройки сохранены (интервал: ${pollIntervalSec.value} с)`);
}
</script>

<template>
  <n-button size="tiny" quaternary circle title="Настройки плагина" @click="settingsOpen = true">
    <template #icon><n-icon><SettingsOutline /></n-icon></template>
  </n-button>

  <n-drawer v-model:show="settingsOpen" :width="320" placement="right">
    <n-drawer-content title="Настройки блока">
      <n-form label-placement="top">
        <n-form-item label="Интервал опроса (сек)">
          <n-input-number v-model:value="draftInterval" :min="5" :max="300" :step="5" />
        </n-form-item>
        <n-form-item label="Автообновление">
          <n-switch v-model:value="draftAutoRefresh" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-button type="primary" @click="saveSettings">Сохранить</n-button>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>
```

---

## 7. Справочник API (`@tmadmin/sdk`)

### `defineBlock`

Декларативно описывает метаданные блока внутри `blocks/*.vue`. Используется IDE, Developer Studio и для статической типизации.

```ts
function defineBlock<T = BlockSettingsSchemaDef>(
  definition: BlockDefinition<T>,
): BlockDefinition<T>;

interface BlockSize {
  w: number; // 1..24
  h: number; // >= 1
}

interface BlockDefinition<T = BlockSettingsSchemaDef> {
  title: string;
  description?: string;
  icon?: string;
  category?: string;
  defaultSize: BlockSize;
  minSize?: BlockSize;
  maxSize?: BlockSize;
  settingsSchema?: BlockSettingsSchemaDef | T;
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
  settingsSchema: {
    timeoutSec: {
      type: "number",
      label: "Таймаут (сек)",
      default: 5,
      min: 1,
      max: 60,
    },
  },
});
```

---

### `useTarget`, `onTargetConnect`, `onTargetReset`

Реактивный доступ к целевому хосту в шапке workspace и события жизненного цикла подключения:

- `useTarget()` — возвращает `ComputedRef<Target | undefined>`. При редактировании поля ввода в шапке значение `target.value?.host` обновляется **динамически** со статусом `"idle"` (или `undefined` при очистке поля). Поддерживает override в изолированном симуляторе Developer Studio (`TARGET_OVERRIDE_KEY`).
- `onTargetConnect(callback)` — вызывается при нажатии «Подключиться» (Enter, кнопка молнии или выбор ПК из истории). Идеально для немедленного запуска загрузки данных (например, LAPS-паролей, принтеров/SMB, диагностики, PowerShell-опроса). При вызове внутри `<script setup>` автоматически отписывается в `onUnmounted`.
- `onTargetReset(callback)` — вызывается при изменении целевого узла в поле ввода, очистке или отключении (`reason: "input-changed" | "cleared" | "disconnected"`). Используйте для сброса кэшированных данных предыдущего ПК и остановки локальных процессов/таймеров/графиков.

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

function useTarget(): ComputedRef<Target | undefined>;
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
interface PluginStoreOptions {
  persist?: "permanent" | "temp";
}

interface PluginStoreApi {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T, options?: PluginStoreOptions): Promise<void>;
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

Общее хранилище и шина событий (Pub/Sub) для обмена данными между разными блоками и плагинами. Запись и удаление (`set`, `remove`) требуют разрешения `store.write`; чтение (`get`) и события (`publish`, `subscribe`) доступны без разрешений.

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

### `useExec` и `powershellExec`

Исполнение бинарников плагина, утилит на хосте, PowerShell-скриптов и потокового сетевого ICMP-пинга через Rust-ядро.

```ts
interface PowershellExecOptions {
  /** Позиционные аргументы PowerShell-скрипта (доступны через $args или param(...)). */
  args?: string[];
  /** Рабочая директория выполнения скрипта. */
  cwd?: string;
  /** Таймаут выполнения в мс (1..600_000, по умолчанию 30_000 мс). */
  timeoutMs?: number;
}

interface ExecApi {
  /** Требует `process.exec` + `fs.external`. Выполняет бинарник из external/ и ждёт завершения. */
  pluginExec(relativePath: string, args?: string[]): Promise<ExecResult>;

  /** Требует `process.exec` + `fs.external`. Запускает фоновый процесс из external/ и возвращает PID. */
  pluginSpawn(relativePath: string, args?: string[]): Promise<ExecSpawnResult>;

  /** Требует `process.exec`. Запускает системную или стороннюю утилиту на хосте с опциональной рабочей папкой cwd. */
  hostSpawn(command: string, args?: string[], cwd?: string): Promise<ExecSpawnResult>;

  /** Требует `process.exec`. Выполняет PowerShell-скрипт без создания окна (CREATE_NO_WINDOW). */
  powershellExec(script: string, options?: PowershellExecOptions): Promise<ExecResult>;

  /** Требует `net.ping`. Запускает фоновую сессию пинга и возвращает sessionId. */
  pingStart(target: string): Promise<string>;

  /** Требует `net.ping`. Останавливает сессию пинга. */
  pingStop(id: string): Promise<void>;

  /** Требует `net.ping`. Подписка на события ping://<id>. */
  listenPing(id: string, handler: (payload: PingPayload) => void): Promise<() => void>;
}

/** Прямой экспорт из `@tmadmin/sdk`, использующий активный PluginContext. */
function powershellExec(script: string, options?: PowershellExecOptions): Promise<ExecResult>;
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

#### Подробно о `powershellExec(script, options?)`

Метод `useExec().powershellExec(...)` и верхнеуровневый хелпер `powershellExec(...)` из `@tmadmin/sdk` предназначены для безопасного выполнения PowerShell-скриптов и однострочников с получением структурированного результата (`stdout`, `stderr`, `exit_code`, `success`).

Ключевые особенности и ограничения:
- **Разрешение**: требует **только `process.exec`** в `plugin.json` (разрешения `fs.external` и `terminal` **не требуются**).
- **Скрытый запуск (`CREATE_NO_WINDOW`)**: на Windows процесс запускается с флагом `CREATE_NO_WINDOW` (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass`), без всплывающих окон консоли.
- **Передача аргументов (`$args` и `param(...)`)**: скрипт и `options.args` передаются через UTF-8 JSON в stdin и запускаются через `& ([scriptblock]::Create($payload.script)) @psArgs`. Поэтому внутри скрипта работают как позиционный массив `$args` (`$args[0]`, `$args[1]`), так и объявление параметров `param([string]$HostName, [int]$Count = 1)`.
- **Кодировки UTF-8 и CP866**: bootstrap-обёртка принудительно переключает `[Console]::InputEncoding`, `[Console]::OutputEncoding` и `$OutputEncoding` на UTF-8 (без BOM), а Rust-ядро декодирует вывод с поддержкой UTF-8 и русской OEM-кодировки Windows CP866 (а также очищает служебную XML-разметку `#< CLIXML` из `stderr`).
- **Лимиты и валидация**:
  - `script`: непустая строка, без null-байтов (`\0`), максимальная длина — **`65 536` символов**.
  - `options.args`: массив строк без null-байтов (`\0`).
  - `options.cwd`: непустой путь к существующей директории, без `\0`.
  - `options.timeoutMs`: целое число от `1` до **`600 000` мс** (10 минут); по умолчанию **`30 000` мс** (30 секунд). При превышении таймаута процесс принудительно завершается, а промис отклоняется с ошибкой таймаута.

#### Пример `powershellExec` и остальных методов `useExec`

```ts
import { powershellExec, useExec, useTarget, useMessage, PermissionDeniedError } from "@tmadmin/sdk";

const exec = useExec();
const target = useTarget();
const message = useMessage();

// 1. Выполнение PowerShell-скрипта с param(...) и выводом JSON (требует только process.exec)
async function getRemoteServices(computerName: string): Promise<void> {
  const script = `
    param([string]$Computer)
    $ErrorActionPreference = 'Stop'
    Get-Service -ComputerName $Computer |
      Select-Object -First 10 Name, DisplayName, Status |
      ConvertTo-Json -Compress
  `;

  try {
    const res = await powershellExec(script, {
      args: [computerName],
      timeoutMs: 15_000,
    });

    if (!res.success) {
      message.error(res.stderr || `PowerShell завершился с кодом ${res.exit_code}`);
      return;
    }

    const services = JSON.parse(res.stdout || "[]");
    console.log("Службы:", services);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      message.error(`Нет права ${err.permission} в plugin.json`);
      return;
    }
    message.error(err instanceof Error ? err.message : String(err));
  }
}

// 2. Запуск утилиты из external/ с ожиданием вывода (нужны process.exec + fs.external)
const res = await exec.pluginExec("laps.exe", ["--computer", target.value?.host ?? ""]);
if (!res.success) {
  message.error(res.stderr || "Ошибка выполнения утилиты");
}

// 3. Запуск сторонней утилиты на хосте с рабочей папкой (нужен process.exec)
await exec.hostSpawn("C:\\Tools\\Sysinternals\\procexp64.exe", [], "C:\\Tools\\Sysinternals");

// 4. Потоковый ping (нужен net.ping)
const pingId = await exec.pingStart("192.168.1.10");
const unlisten = await exec.listenPing(pingId, (tick) => {
  console.log(`#${tick.seq} ${tick.ip}: ${tick.ms ?? "timeout"} ms`);
});
// Не забудьте остановить в onUnmounted:
// unlisten(); await exec.pingStop(pingId);
```

---

### `useHttp` и `axios`

HTTP/HTTPS-клиент для взаимодействия с REST API, корпоративными сервисами, мониторингом и внешними веб-хуками. Требует разрешения **`net.http`** в `plugin.json`.

Доступны два полностью эквивалентных способа использования:

1. **Прямой импорт из `"axios"`** (удобно при переносе готового кода или библиотек):
   ```ts
   import axios, { AxiosError, HttpStatusCode } from "axios";
   ```
   Резолвер песочницы автоматически подставляет scoped-обёртку для текущего плагина.
2. **Импорт из `"@tmadmin/sdk"`** (`useHttp()` или ленивый прокси `axios`):
   ```ts
   import { useHttp, axios, AxiosError, HttpStatusCode, PermissionDeniedError } from "@tmadmin/sdk";
   ```

Возможности scoped-обёртки:
- Поддержка всех стандартных методов (`axios(...)`, `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `postForm`, `putForm`, `patchForm`, `request`).
- Поддержка `axios.create(config)` — дочерние экземпляры также автоматически проверяют `net.http` при каждом запросе.
- Поддержка `interceptors.request`, `interceptors.response`, `defaults`, `new axios.Axios(...)`, а также утилит `axios.isAxiosError(...)`, `axios.isCancel(...)`, `AxiosHeaders`, `CanceledError`, `HttpStatusCode`.
- Проверка `net.http` выполняется перед каждым HTTP-запросом; при отсутствии разрешения выбрасывается `PermissionDeniedError`.

#### Пример запроса к API с `axios.create()`, перехватчиком и обработкой ошибок

```ts
import axios, { type AxiosInstance } from "axios";
import { useHttp, PermissionDeniedError, useMessage } from "@tmadmin/sdk";

const message = useMessage();

// Можно использовать как `axios` из "axios", так и `useHttp()` из "@tmadmin/sdk"
const http = useHttp();

const apiClient: AxiosInstance = http.create({
  baseURL: "https://cmdb.corp.local/api/v1",
  timeout: 10_000,
  headers: {
    Accept: "application/json",
  },
});

// Перехватчик запросов (например, добавление токена из useSecrets)
apiClient.interceptors.request.use((config) => {
  config.headers.set("X-Client", "TMAdmin-Plugin");
  return config;
});

interface AssetInfo {
  hostname: string;
  owner: string;
  serialNumber: string;
}

async function fetchAsset(hostname: string): Promise<AssetInfo | null> {
  try {
    const response = await apiClient.get<AssetInfo>(`/assets/${encodeURIComponent(hostname)}`);
    return response.data;
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      message.error(`Добавьте "${err.permission}" в permissions файла plugin.json`);
      return null;
    }
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      message.error(`Ошибка API (${status ?? "network"}): ${err.message}`);
      return null;
    }
    message.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}
```

---

### `useSocket`, `io` и `socket.io-client`

WebSocket / Socket.IO-клиент для стриминга событий в реальном времени, телеметрии и чатов/уведомлений. Требует разрешения **`net.socket`** в `plugin.json`.

Доступны два способа использования:

1. **Прямой импорт из `"socket.io-client"`**:
   ```ts
   import { io, connect, Manager, Socket } from "socket.io-client";
   ```
   Резолвер песочницы автоматически подставляет scoped-обёртку, проверяющую разрешение `net.socket`.
2. **Импорт из `"@tmadmin/sdk"`** (`useSocket()`, `io`, `connect`, `Manager`, `Socket`):
   ```ts
   import { useSocket, io, PermissionDeniedError } from "@tmadmin/sdk";
   ```

#### Важное отличие `useSocket()` от прямого `io()`

- При вызове **`useSocket()` внутри `<script setup>`** (когда активен Vue-инстанс компонента) SDK отслеживает все созданные через возвращённый клиент сокеты (`io(...)`, `connect(...)`, `manager.socket(...)`) и менеджеры (`new Manager(...)`), и **автоматически закрывает их (`disconnect()` / `_close()`) в `onUnmounted`** при закрытии блока или удалении его с сетки.
- При использовании прямого импорта `io` (из `"socket.io-client"` или `{ io } from "@tmadmin/sdk"`) без `useSocket()` обязательно отключайте сокет вручную в `onUnmounted(() => socket.disconnect())`.

```ts
interface ScopedSocketIoFunction {
  (opts?: Partial<ManagerOptions & SocketOptions>): Socket;
  (uri?: string, opts?: Partial<ManagerOptions & SocketOptions>): Socket;
  Manager: typeof Manager;
  Socket: typeof Socket;
  io: ScopedSocketIoFunction;
  connect: ScopedSocketIoFunction;
}

interface ScopedSocketIo {
  io: ScopedSocketIoFunction;
  connect: ScopedSocketIoFunction;
  Manager: typeof Manager;
}
```

#### Пример подключения к Socket.IO-серверу

```ts
import { ref, onMounted } from "vue";
import { useSocket, useMessage, PermissionDeniedError, type Socket } from "@tmadmin/sdk";

const { io } = useSocket(); // Автоматически отключит все сокеты в onUnmounted
const message = useMessage();

const connected = ref(false);
const events = ref<string[]>([]);
let socket: Socket | null = null;

onMounted(() => {
  try {
    socket = io("https://telemetry.corp.local", {
      path: "/socket.io",
      transports: ["websocket"],
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      connected.value = true;
      socket?.emit("subscribe", { channel: "alerts" });
    });

    socket.on("alert", (payload: { text: string }) => {
      events.value.unshift(payload.text);
    });

    socket.on("disconnect", () => {
      connected.value = false;
    });

    socket.on("connect_error", (err) => {
      message.warning(`Socket.IO ошибка подключения: ${err.message}`);
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      message.error(`Добавьте "${err.permission}" в permissions файла plugin.json`);
      return;
    }
    message.error(err instanceof Error ? err.message : String(err));
  }
});
```

---

### `useFs` (`fs.read`, `fs.write`, `dir.read`, `dir.search`)

Безопасный доступ к текстовым файлам и директориям через Rust IPC (`fs_read`, `fs_write`, `dir_read`, `dir_search`). Также доступны верхнеуровневые экспорты `fs` и `dir` из `@tmadmin/sdk`.

Требуемые разрешения в `plugin.json`:
- `fs.read` — для `fs.read(...)`, `dir.read(...)`, `dir.search(...)`
- `fs.write` — для `fs.write(...)`

Правила безопасности путей (валидируются Zod на клиенте и в Rust-ядре):
- Запрещены пустые пути, null-байты (`\0`) и сегменты обхода директорий (`..`, например `../secret` или `logs\..\etc`).
- Ограничения по умолчанию и максимумы:
  - `maxBytes`: до `50 * 1024 * 1024` (50 MiB)
  - `maxEntries`: до `20 000` записей в `dir.read`
  - `maxDepth`: `0..50` уровней вложенности в `dir.search`
  - `maxResults`: до `5 000` совпадений в `dir.search`

#### Интерфейс API

```ts
interface FsApi {
  fs: {
    /** Прочитать текстовый файл. Требует `fs.read`. IPC: `fs_read`. */
    read(path: string, options?: { maxBytes?: number }): Promise<FsReadResult>;

    /** Записать или дозаписать текстовый файл. Требует `fs.write`. IPC: `fs_write`. */
    write(
      path: string,
      content: string,
      options?: { append?: boolean; createDirs?: boolean },
    ): Promise<FsWriteResult>;
  };

  dir: {
    /** Прочитать список файлов и папок в директории. Требует `fs.read`. IPC: `dir_read`. */
    read(
      path: string,
      options?: { recursive?: boolean; maxEntries?: number },
    ): Promise<DirReadResult>;

    /** Найти файлы/папки по шаблону (glob или подстрока). Требует `fs.read`. IPC: `dir_search`. */
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

Работа со встроенным PTY-терминалом workspace и чтение настроек его внешнего вида.

Важное разделение:
- **Отправка команды в терминал workspace** (`runCommand`, `sendTerminalCommand`) работает через Pub/Sub шину (`terminal:run_command`) и **не требует** разрешения `terminal`. Это рекомендуемый способ интеграции с терминалом из других блоков (кнопки диагностики, скрипты PSExec/PowerShell).
- **Настройки внешнего вида терминала** (`useTerminal().settings` и отдельный хук `useTerminalSettings()`) **не требуют** разрешения `terminal` и возвращают `ComputedRef<TerminalAppearanceSettings>` с актуальными параметрами из настроек TMAdmin (`fontSize`, `fontFamily`, `theme`, `isDark`, `accent`). Чтение выполняется безопасно: если активный Pinia store недоступен (например, в изолированных unit-тестах), возвращаются значения по умолчанию из `DEFAULT_SETTINGS`.
- **Прямое управление PTY-сессией** (`spawn`, `write`, `execScript`, `kill`, `listen`) требует разрешения `terminal` в `plugin.json`.

```ts
import type { ComputedRef } from "vue";

type ThemeMode = "light" | "dark" | "auto";

interface TerminalAppearanceSettings {
  fontSize: number;
  fontFamily: string;
  theme: ThemeMode;
  isDark: boolean;
  accent: string;
}

interface TerminalRunCommandOptions {
  target?: string;
  immediate?: boolean; // По умолчанию true
  asScript?: boolean;  // По умолчанию false
  description?: string;
  title?: string;
}

interface TerminalRunCommandPayload {
  command: string;
  target?: string;
  immediate?: boolean;
  asScript?: boolean;
  description?: string;
  title?: string;
}

interface TerminalApi {
  /** Без permission. Реактивные настройки внешнего вида терминала из TMAdmin. */
  settings: ComputedRef<TerminalAppearanceSettings>;

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

/**
 * Без permission. Самостоятельный реактивный хук для чтения настроек внешнего вида
 * терминала без необходимости вызова `useTerminal()` / наличия `PluginContext`.
 */
function useTerminalSettings(): ComputedRef<TerminalAppearanceSettings>;
```

Пример отправки команды в терминал и синхронизации внешнего вида блока с настройками TMAdmin:

```ts
import { computed } from "vue";
import { useTerminal, useTerminalSettings, useTarget } from "@tmadmin/sdk";

const terminal = useTerminal();
const target = useTarget();

// Можно использовать как terminal.settings, так и отдельный хук useTerminalSettings()
const appearance = useTerminalSettings();
const consoleStyle = computed(() => ({
  fontSize: `${terminal.settings.value.fontSize}px`,
  fontFamily: appearance.value.fontFamily,
  accentColor: appearance.value.accent,
}));

function runCheck(): void {
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

### `PermissionDeniedError`

Класс ошибки, который выбрасывается любым защищённым методом SDK или scoped-обёрткой (`axios`, `socket.io-client`), если в `plugin.json` отсутствует нужное разрешение.

```ts
class PermissionDeniedError extends Error {
  readonly pluginId: string;
  readonly permission: PluginPermission;
  readonly operation: string;
}
```

```ts
import { PermissionDeniedError, useMessage } from "@tmadmin/sdk";

const message = useMessage();

try {
  // вызов защищённого API
} catch (err) {
  if (err instanceof PermissionDeniedError) {
    message.error(
      `Плагину ${err.pluginId} требуется право "${err.permission}" для ${err.operation}`,
    );
  }
}
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

## 8. Полный пример плагина

Ниже приведён рабочий пример плагина **`acme.log-inspector`**, который использует `lib/logParser.ts`, опциональный prop `block?: WorkspaceBlock`, `useTarget()`, `usePluginStore()`, `useFs()` (`dir.search`, `fs.read`, `fs.write`) и `useMessage()`.

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
  type WorkspaceBlock,
} from "@tmadmin/sdk";
import { NButton, NInput, NSpace, NTag, NText, NList, NListItem } from "naive-ui";
import { SearchOutline, DownloadOutline } from "@vicons/ionicons5";
import { extractErrors, type ParsedLogLine } from "../lib/logParser";

const props = defineProps<{
  block?: WorkspaceBlock;
}>();

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

const initialSubpath =
  (typeof props.block?.config?.defaultSubpath === "string"
    ? props.block.config.defaultSubpath
    : undefined) ??
  store.get<string>("subpath") ??
  "c$\\Logs";

const folderSubpath = ref<string>(initialSubpath);
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

## 9. Упаковка и публикация в Plugin Market

1. Проверьте, что в корне архива `plugin.zip` лежат `plugin.json`, `blocks/`, при необходимости `lib/` и `external/` (без лишней вложенной папки-обёртки).
2. Вычислите контрольную сумму `SHA-256` для `plugin.zip` (64 hex-символа).
3. Опубликуйте релиз в репозитории реестра **TMAdminPlugins** согласно спецификации [docs/MARKET.md](./MARKET.md).
4. Для локальной установки без публикации используйте **Plugin Market → Добавить локальный плагин** (выбор папки с `plugin.json` или `.zip`-архива) либо кнопку **«Установить в TMAdmin»** в Developer Studio — оба варианта сохраняют плагин на диск с меткой «Локальный».

---

## 10. Руководство для ИИ-агентов (AI Plugin Authoring Guide)

Этот раздел предназначен для ИИ-ассистентов и автономных агентов (LLM), которым поручено разработать или модифицировать плагин для TMAdmin.

### Краткий контекст платформы
- **TMAdmin** — десктопная оболочка для системных администраторов на базе **Tauri 2 (Rust) + Vue 3 + TypeScript + Naive UI**.
- Плагины компилируются **в рантайме** (`@vue/compiler-sfc`) внутри изолированной песочницы.
- **Один блок = один файл `blocks/<Name>.vue`** с `<script setup lang="ts">`. Вспомогательная логика выносится в `lib/*.ts`.

### Жёсткие ограничения песочницы (MUST FOLLOW)
1. **Разрешённые импорты**: только `vue`, `@tmadmin/sdk`, `naive-ui`, `@vicons/ionicons5`, `chart.js`, `chart.js/auto`, `axios`, `socket.io-client` и относительные пути (`./`, `../`) внутри папки плагина.
2. **Запрещено**: `fs`, `path`, `child_process`, `os`, `http`, `net`, прямые вызовы Tauri API (`@tauri-apps/api`), `window.__TAURI_INTERNALS__`, `eval`, доступ к внутренним store оболочки (`@/stores/*`). Все системные и сетевые операции выполняются **только через `@tmadmin/sdk` или scoped-обёртки `axios` / `socket.io-client`**.
3. **Разрешения в `plugin.json`**: любая защищённая операция проверяет `permissions` в рантайме. Матрица соответствия:
   - `useExec().powershellExec` / `powershellExec` → `["process.exec"]` (без `fs.external` и `terminal`)
   - `useExec().hostSpawn` → `["process.exec"]`
   - `useExec().pluginExec` / `pluginSpawn` → `["process.exec", "fs.external"]`
   - `useExec().pingStart` / `pingStop` / `listenPing` → `["net.ping"]`
   - `axios` / `useHttp()` / `axios.create()` → `["net.http"]`
   - `socket.io-client` / `io` / `connect` / `Manager` / `useSocket()` → `["net.socket"]`
   - `useFs().fs.read` / `dir.read` / `dir.search` → `["fs.read"]`
   - `useFs().fs.write` → `["fs.write"]`
   - `usePluginStore().set` / `remove`, `useSharedStore().set` / `remove` → `["store.write"]`
   - `useSecrets().get` / `set` / `delete` → `["keychain"]`
   - `useTerminal().spawn` / `write` / `execScript` / `kill` / `listen` → `["terminal"]` (`runCommand`, `settings` и `useTerminalSettings()` работают без прав)
4. **Prop блока и настройки**:
   - Объявляйте `defineProps<{ block?: WorkspaceBlock }>()` (опциональным, чтобы работал предпросмотр в Developer Studio).
   - Учитывайте, что `BlockSettingsModal` пока не генерирует UI по произвольной `settingsSchema` — для пользовательских настроек добавляйте собственный UI внутри блока на базе Naive UI + `usePluginStore()` и читайте `props.block?.config?.<key>` с fallback на `usePluginStore()`.

### Обязательный шаблон жизненного цикла блока
```vue
<script setup lang="ts">
import { ref } from "vue";
import { NButton, NEmpty, NSpace, NTag } from "naive-ui";
import {
  useTarget,
  onTargetConnect,
  onTargetReset,
  useMessage,
  type WorkspaceBlock,
} from "@tmadmin/sdk";

const props = defineProps<{ block?: WorkspaceBlock }>();

const target = useTarget();
const message = useMessage();
const loading = ref(false);
const result = ref<string | null>(null);

async function loadData(host?: string): Promise<void> {
  const targetHost = (host ?? target.value?.host)?.trim();
  if (!targetHost) return;
  loading.value = true;
  try {
    // Вызов useExec / powershellExec / useHttp / useFs / useSecrets ...
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
- Для сокетов внутри `<script setup>` предпочитайте `useSocket()` (автоматически вызывает `disconnect()` в `onUnmounted`).
- Идентификаторы `id` в `plugin.json` — в `kebab-case` или `vendor.name` (`[a-z0-9_.-]`), `version` — строгий SemVer (`1.0.0`).
