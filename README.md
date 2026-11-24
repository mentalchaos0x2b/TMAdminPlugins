# TMAdmin Plugins (`TMAdminPlugins`)

Официальный репозиторий плагинов и обновлений для **TMAdmin** (Tauri 2 · Vue 3 · TypeScript · Naive UI).

---

## 📁 Структура

```text
├── index.json         # Каталог плагинов, версий, прав и SHA-256
├── app/latest.json    # Манифест автообновления TMAdmin Desktop
├── docs/
│   ├── SDK.md         # Документация @tmadmin/sdk + гайд для ИИ-агентов
│   └── PUBLISHING.md  # Инструкция по публикации в маркет
├── scripts/
│   └── build-plugins.ps1  # Автоматическая сборка .zip, SHA256SUMS и index.json
├── sources/<id>/      # Исходные коды плагинов
└── plugins/<id>/      # Собранные пакеты (plugin.zip + SHA256SUMS)
```

---

## 📚 Документация

- [TMAdmin Plugin SDK](docs/SDK.md) — API (`@tmadmin/sdk`), структура плагина, `permissions` и [руководство для ИИ-агентов](docs/SDK.md#9-руководство-для-ии-агентов-ai-plugin-authoring-guide).
- [Руководство по публикации](docs/PUBLISHING.md) — упаковка `plugin.zip`, `SHA256SUMS` и регистрация в `index.json`.

> Актуальный список всех доступных плагинов и их версий всегда находится в [`index.json`](index.json) и в разделе **Plugin Market** внутри TMAdmin.

---

## 📦 Сборка и публикация

1. Разместите исходники плагина в `sources/<plugin-id>/` (`plugin.json`, `blocks/*.vue`, при необходимости `lib/*.ts` и `external/`).
2. Запустите скрипт сборки:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-plugins.ps1
   ```
   Скрипт автоматически соберёт `plugins/<id>/<version>/plugin.zip`, посчитает `SHA256SUMS` и обновит `index.json`.
3. Отправьте изменения в репозиторий (`git push origin main`).
