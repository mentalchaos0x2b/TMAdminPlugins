# Руководство по публикации плагинов в TMAdminPlugins

Данная инструкция предназначена для авторов плагинов для **TMAdmin**.

---

## 1. Требования к плагину

Плагин должен быть оформлен в виде архива `plugin.zip` со следующей структурой:

```
plugin.zip
├── plugin.json               # Манифест плагина
├── blocks/                   # Vue 3 SFC компоненты блоков
│   └── MyBlock.vue
├── lib/                      # Вспомогательная TypeScript логика
│   └── helper.ts
└── external/                 # (Опционально) внешние исполняемые файлы (.exe)
    └── tool.exe
```

### 1.1. Манифест `plugin.json`
Файл `plugin.json` в корне архива должен содержать:
- `id`: уникальный идентификатор в нижнем регистре (латиница, дефисы);
- `name`: читаемое имя;
- `version`: версия по SemVer (например, `1.0.0`);
- `author`: имя автора или команды;
- `description`: краткое описание;
- `permissions`: массив только необходимых прав из белого списка:
  - `net.ping` — отправка ICMP/ping запросов
  - `process.exec` — запуск исполняемых файлов
  - `fs.external` — доступ к папке external/ плагина
  - `ldap.query` — выполнение запросов к Active Directory / LDAP
  - `store.write` — сохранение данных в постоянное хранилище
  - `terminal` — интеграция с терминалом PTY
  - `keychain` — безопасное хранение секретов в OS Keychain
- `blocks`: массив описаний блоков с `id`, `title`, `component`, `defaultSize`, `minSize`.

---

## 2. Сборка архива и генерация SHA-256

1. Создайте папку в репозитории:
   `plugins/<id>/<version>/`
2. Сформируйте zip-архив без вложенной корневой папки (содержимое архива должно начинаться прямо с `plugin.json`):
   ```pwsh
   Compress-Archive -Path ./my-plugin/* -DestinationPath ./plugins/<id>/<version>/plugin.zip -Force
   ```
3. Вычислите SHA-256 контрольную сумму:
   ```pwsh
   $hash = (Get-FileHash -Algorithm SHA256 ./plugins/<id>/<version>/plugin.zip).Hash.ToLower()
   "$hash *plugin.zip" | Out-File -Encoding utf8 ./plugins/<id>/<version>/SHA256SUMS
   ```

---

## 3. Регистрация в `index.json`

Добавьте релиз в файл `index.json` в корне репозитория:

```json
{
  "version": "1.0.0",
  "minAppVersion": "0.1.0",
  "releasedAt": "2026-11-10T12:00:00Z",
  "changelog": "Описание изменений...",
  "downloadUrl": "https://raw.githubusercontent.com/mentalchaos0x2b/TMAdminPlugins/main/plugins/<id>/<version>/plugin.zip",
  "sha256": "<хэш-64-символа>",
  "permissions": [
    "net.ping"
  ],
  "blocks": [
    {
      "id": "my-block",
      "title": "My Block",
      "icon": "CubeOutline",
      "defaultSize": { "w": 12, "h": 6 },
      "minSize": { "w": 6, "h": 4 }
    }
  ]
}
```

Не забудьте обновить поля:
- `latestVersion`: укажите последнюю стабильную версию;
- `updatedAt`: укажите текущую дату по UTC в формате ISO 8601.

---

## 4. Проверка и отправка PR

1. Проверьте валидность JSON:
   ```pwsh
   node -e "JSON.parse(require('fs').readFileSync('index.json', 'utf8'))"
   ```
2. Убедитесь, что SHA-256 в `index.json` точно совпадает с хэшем файла `plugin.zip`.
3. Откройте Pull Request в ветку `main`.
4. CI-воркфлоу `.github/workflows/validate.yml` автоматически проверит целостность и корректность схемы.
