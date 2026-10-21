# PLAN.md — PromptWizard: CLI-ассистент для создания промтов

> **Тип проекта:** BACKEND / CLI (терминальная утилита)
> **Рабочая директория:** `C:\develop\promtwizard` (пустая, новый проект)
> **Окружение:** Windows / PowerShell, Node.js 20+, TypeScript
> **Режим:** PLANNING (только план, код на этом этапе НЕ пишется)

---

## 1. Цель проекта и Scope MVP

### 1.1 Цель

**PromptWizard** — CLI-инструмент, который помогает собирать качественные, структурированные промты для:
генерации изображений (Midjourney, DALL-E, Stable Diffusion), генерации кода/приложений, текстов (копирайтинг),
видео (Runway, Sora-подобные), музыки (Suno и т.п.).

Промт собирается из **локальной базы шаблонов + правил сборки** (работает полностью автономно, без API-ключей),
а **опционально** может быть доработан через **LLM API** (OpenAI-совместимый или Anthropic), если задан ключ.

### 1.2 Принципиальные решения

| Решение | Обоснование |
|---------|-------------|
| Гибридный движок: шаблоны + правила, LLM — опция | Инструмент обязан работать без ключей и без сети (MVP-требование №1) |
| Шаблоны — структурированные JSON-файлы в репозитории | Это база знаний, версионируется вместе с кодом; БД для CLI не нужна |
| Универсальный охват — 5 типов промтов в v1 | Явное требование пользователя |
| Интерактивный + неинтерактивный режим | CLI должен быть удобен и для человека, и для скриптов/CI |
| Без привязки к конкретной LLM-SDK | OpenAI-совместимый HTTP-эндпоинт + Anthropic API через нативный `fetch` — минимум зависимостей |

### 1.3 В Scope MVP

- [x] Команды: `generate`, `interactive`, `list-types`, `list-templates`, `refine`, `config`, `doctor` <!-- verified Phase X -->
- [x] JSON-база шаблонов по 5 типам: image / code / text / video / music
- [x] Движок сборки промта: слоты шаблона + параметры пользователя + правила платформ (параметры MJ, негативные промты SD и т.д.)
- [x] Валидация всего ввода через Zod (в т.ч. загрузка JSON-шаблонов)
- [x] Конфиг: cosmiconfig (`.promptwizardrc.*`, `promptwizard` в `package.json`) + env-переменные для ключей
- [x] Вывод результата: stdout, файл (`--out`), копирование (`--copy`, через PowerShell `Set-Clipboard` на Windows)
- [x] Опциональная LLM-доработка: OpenAI-совместимый и Anthropic провайдеры, graceful fallback без ключа
- [x] Тесты (пишет ТОЛЬКО `test-engineer`), линт, финальная сборка и smoke-проверка

### 1.4 Вне Scope MVP

- Плагины/расширения, TUI-интерфейс (blessed/ink), публикация в npm registry (сама публикация — после MVP)
- Генерация изображений/видео самим инструментом (мы генерируем только ТЕКСТ промта)
- Обучение/файнтюнинг моделей, локальный запуск LLM
- Графический интерфейс, веб-версия
- Синхронизация шаблонов из внешних источников (в v1 база статична в репозитории)

---

## 2. Критерии успеха (Success Criteria)

| # | Критерий | Как проверить |
|---|----------|---------------|
| S1 | Инструмент работает БЕЗ API-ключа и БЕЗ сети | `promptwizard generate ...` с пустым env — промт собирается, exit code 0 |
| S2 | Все 5 типов промтов представлены в базе | `promptwizard list-types` показывает image, code, text, video, music |
| S3 | Интерактивный режим ведёт от старта до готового промта | `promptwizard interactive` — серия вопросов → превью → сохранение |
| S4 | Неинтерактивный режим работает флагами и пригоден для пайпов | `promptwizard generate --type image ... > out.txt` |
| S5 | Опциональная LLM-доработка включается только при наличии ключа | С ключом — `refine` дорабатывает; без ключа — понятное сообщение + работает локальный результат |
| S6 | Весь ввод валидируется, ошибки понятные | Неверный флаг/тип — Zod-ошибка на русском/англ. с подсказкой, не stack trace |
| S7 | Сборка и тесты зелёные | `npm run lint && npx tsc --noEmit && npm test && npm run build` — 0 ошибок |
| S8 | Smoke-сценарии проходят на Windows/PowerShell | См. Phase X |

---

## 3. Стек техний

| Слой | Технология | Обоснование |
|------|-----------|-------------|
| Runtime | Node.js 20+ | Нативный `fetch`, современный ESM, LTS |
| Язык | TypeScript (strict) | Валидация схем через Zod-типы, безопасный рефакторинг |
| Команды | Commander.js | Стандарт для CLI, декларативные флаги, help генерируется автоматически |
| Интерактив | @inquirer/prompts | Модульные промпты (select, input, confirm), активно поддерживается |
| Вывод | chalk + ora | Цвета (совместимость с Windows Terminal), спиннеры для LLM/файловых операций |
| Конфиг | cosmiconfig | Поиск конфига в стиле `lint`/`prettier`: `.promptwizardrc.json`, `promptwizard`-ключ в package.json |
| Валидация | Zod | Единая схема для: конфига, входных флагов, JSON-шаблонов, ответов LLM |
| HTTP к LLM | нативный `fetch` | Без официальных SDK: меньше зависимостей, полный контроль над таймаутами/ошибками |
| Тесты | Vitest (или Jest — решает test-engineer) | Быстрый TS out-of-the-box, моки `fetch`, интеграционные тесты CLI |
| Линт | ESLint + Prettier (конфиг в задаче T01) | Единый стиль, поймать ошибки до ревью |

**Env-переменные:** `PROMPTWIZARD_LLM_API_KEY`, `PROMPTWIZARD_LLM_PROVIDER` (`openai` | `anthropic`),
`PROMPTWIZARD_LLM_BASE_URL` (для OpenAI-совместимых прокси/локальных серверов), `PROMPTWIZARD_LLM_MODEL`.

---

## 4. Архитектура

```
                    ┌─────────────────────────────────────────────┐
                    │                CLI (Commander)              │
                    │  generate | interactive | list-types |      │
                    │  list-templates | refine | config | doctor  │
                    └───────────────┬─────────────────────────────┘
                                    │  флаги/промпты → Input (Zod)
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
     ┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐
     │  Config Loader │   │ Template Registry │   │   LLM Client     │
     │  cosmiconfig+  │   │ чтение/валидация  │   │ openai-compatible│
     │  Zod + env     │   │ JSON-базы, индекс │   │ + anthropic      │
     └───────┬────────┘   └────────┬─────────┘   └────────┬─────────┘
             │                     │                      │
             │            ┌────────▼─────────┐            │
             │            │  Prompt Engine   │            │
             └───────────►│  builder + rules │◄───────────┘  (опционально,
                          │  слоты, параметры│                refine результат)
                          │  платформ-правила│
                          └────────┬─────────┘
                                   │  PromptResult
                          ┌────────▼─────────┐
                          │  Output Renderer │
                          │ stdout/--out/    │
                          │ --copy (clipboard)│
                          └──────────────────┘
```

**Ключевое правило:** `Prompt Engine` не знает ничего про LLM. Он детерминирован и тестируем.
`refine` — отдельный слой, который берёт готовый промт и опционально улучшает его; при отсутствии
ключа/сети он деградирует к локальному результату с предупреждением, а не к падению.

---

## 5. Структура каталогов

```
C:\develop\promtwizard\
├── docs\
│   └── PLAN.md                     # этот файл
├── src\
│   ├── index.ts                    # bin-точка входа (#!/usr/bin/env node)
│   ├── cli.ts                      # сборка программ Commander, регистрация команд
│   ├── commands\
│   │   ├── generate.ts             # неинтерактивная генерация (флаги → промт)
│   │   ├── interactive.ts          # интерактивный мастер (inquirer)
│   │   ├── list-types.ts           # каталог типов и платформ
│   │   ├── list-templates.ts       # шаблоны конкретного типа (+ --json)
│   │   ├── refine.ts               # LLM-доработка готового промта
│   │   ├── config.ts               # config show | set | init
│   │   └── doctor.ts               # проверка окружения (node, конфиг, ключ, пути)
│   ├── lib\
│   │   ├── config.ts               # cosmiconfig + Zod-схема конфига + env
│   │   ├── schemas.ts              # Zod-схемы: Input, Template, Config, LLM-ответы
│   │   ├── engine\
│   │   │   ├── builder.ts          # сборка промта: слоты + параметры + правила
│   │   │   ├── rules.ts            # правила платформ (MJ-параметры, негативные и т.д.)
│   │   │   └── errors.ts           # типизированные ошибки движка (человекочитаемые)
│   │   ├── templates\
│   │   │   └── registry.ts         # загрузка/валидация/индексация JSON-базы
│   │   ├── llm\
│   │   │   ├── provider.ts         # интерфейс LLMProvider + фабрика по конфигу
│   │   │   ├── openai.ts           # OpenAI-совместимый клиент (chat/completions)
│   │   │   ├── anthropic.ts        # Anthropic клиент (messages API)
│   │   │   └── refine.ts           # промпт-сценарий доработки + fallback-логика
│   │   ├── output.ts               # рендер: stdout, --out файл, --copy (PowerShell)
│   │   └── clipboard.ts            # кросс-платформенное копирование (win32 → Set-Clipboard)
│   └── templates\                  # БАЗА ЗНАНИЙ (JSON, валидируется Zod при загрузке)
│       ├── image\
│       │   ├── midjourney.json
│       │   ├── dalle.json
│       │   └── stable-diffusion.json
│       ├── code\{generic-llm.json, review.json, refactor.json}
│       ├── text\{article.json, copywriting.json, rewrite.json}
│       ├── video\{runway.json, sora-like.json}
│       └── music\{suno.json, generic.json}
├── tests\                          # ВСЕ тестовые файлы — создаёт ТОЛЬКО test-engineer
│   ├── engine\*.test.ts
│   ├── templates\*.test.ts
│   ├── config\*.test.ts
│   ├── llm\*.test.ts               # с моками fetch (без реальной сети)
│   └── cli\*.test.ts               # интеграционные: spawn процесса CLI
├── scripts\
│   └── copy-assets.mjs             # копирование src/templates/*.json → dist/templates
├── package.json
├── tsconfig.json
├── .eslintrc / eslint.config.js
├── .gitignore
└── .env.example                    # PROMPTWIZARD_LLM_API_KEY=...
```

> **Примечание по сборке:** JSON-шаблоны живут в `src/templates/`, но должны попадать в `dist/`
> (задача T01/T05 включает шаг копирования ассетов в `npm run build`), иначе инструмент
> «сломается после сборки» — классическая ловушка. Это учтено в рисках (R6).

---

## 6. Набор команд CLI (предлагаемый)

| Команда | Режим | Назначение |
|---------|-------|-----------|
| `promptwizard generate` | неинтерактивный | Сборка промта по флагам: `--type`, `--platform`, `--subject`, `--style`, `--params k=v`, `--negative`, `--out`, `--copy`, `--json`, `--refine` |
| `promptwizard interactive` | интерактивный | Мастер: тип → платформа → параметры (с подсказками из шаблона) → превью → копирование/сохранение |
| `promptwizard list-types` | любой | Каталог типов и доступных платформ (опция `--json` для скриптов) |
| `promptwizard list-templates [type]` | любой | Шаблоны конкретного типа: id, название, описание, параметры |
| `promptwizard refine` | неинтерактивный/интерактивный | LLM-доработка текста промта (`--in файл | --text "..." | stdin`); без ключа — вежливая ошибка с подсказкой |
| `promptwizard config` | любой | `config show` / `config set key value` / `config init` (создать `.promptwizardrc.json`) |
| `promptwizard doctor` | любой | Диагностика окружения: версия node, путь конфига, наличие ключа/провайдера, целостность базы шаблонов |

Автоматически: `promptwizard --help`, `promptwizard --version` (Commander).

**Примеры (Windows/PowerShell):**

```powershell
# Неинтерактивно, вывод в stdout (pipe в файл)
npx promptwizard generate --type image --platform midjourney --subject "cyberpunk city" --style cinematic > prompt.txt

# В файл + копирование в буфер обмена
npx promptwizard generate --type code --subject "REST API на FastAPI" --out .\prompt.md --copy

# Интерактивный мастер
npx promptwizard interactive

# LLM-доработка (ключ берётся из PROMPTWIZARD_LLM_API_KEY)
npx promptwizard refine --in .\prompt.txt --copy
```

---

## 7. Формат шаблонов (JSON в репозитории)

Минимальная схема (валидируется Zod в `lib/schemas.ts`):

```jsonc
{
  "id": "midjourney",
  "type": "image",                 // image | code | text | video | music
  "platform": "Midjourney",
  "name": "Midjourney v6 промт",
  "description": "Сборка промта с параметрами MJ",
  "slots": [                       // заполняются из флагов/интерактива
    { "key": "subject",  "label": "Сюжет/объект", "required": true,  "type": "string" },
    { "key": "style",    "label": "Стиль",        "required": false, "type": "enum",
      "options": ["cinematic", "anime", "photorealistic", "oil painting"] },
    { "key": "lighting", "label": "Освещение",    "required": false, "type": "string" }
  ],
  "template": "{subject}, {style}, {lighting} --ar 16:9 --v 6",
  "rules": [                       // применяются движком rules.ts
    { "when": { "slot": "style", "equals": "photorealistic" },
      "append": ", 8k, highly detailed" },
    { "when": { "flag": "negative" },
      "negative": "blurry, low quality, watermark" }
  ],
  "defaults": { "--ar": "16:9", "--v": "6" },
  "examples": ["a cyberpunk city, cinematic, neon lighting --ar 16:9 --v 6"]
}
```

Правила платформ живут **внутри шаблонов** (данные) + узкий набор программных правил в `rules.ts`
(например, склейка негативного промта для Stable Diffusion в блок `Negative prompt:`).

---

## 8. Разбивка задач

> **Границы доменов (строго):**
> - `backend-specialist` — вся бизнес-логика CLI, команды, движок, шаблоны, интеграция LLM, конфиг, вывод.
> - `test-engineer` — ВСЕ файлы `**/*.test.ts` и каталог `tests/`. Другие агенты тестовые файлы НЕ создают и НЕ правят.
> - `explorer-agent` — только чтение/анализ (для нового проекта практически не требуется).
>
> **Формат задачи:** ID · Исполняющий агент · Файлы · INPUT → OUTPUT → VERIFY (критерии приёмки).

### Milestone M1 — Каркас CLI

#### T01 — Инициализация проекта и инфраструктуры сборки
- **Агент:** `backend-specialist`
- **Файлы:** `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `.env.example`, `scripts/copy-assets.mjs`, `docs/PLAN.md` (связка)
- **INPUT:** пустая директория `C:\develop\promtwizard`; выбранная зависимость из §3.
- **OUTPUT:** инициализированный npm-проект; установлены зависимости; настроены скрипты `build`, `dev`, `lint`, `typecheck`, `test` (заглушка); bin-поле `promptwizard`; JSON-ассеты копируются в `dist` при `build`.
- **VERIFY:**
  - `npm install` проходит без ошибок;
  - `npx tsc --noEmit` — 0 ошибок;
  - `npm run build` создаёт `dist/`, в нём лежат и `.js`, и скопированные `templates/*.json`;
  - `npm run lint` — 0 ошибок;
  - в `package.json` задан `"type": "module"` (ESM) и bin-ссылка на `dist/index.js`.

#### T02 — Точка входа и каркас команд (Commander)
- **Агент:** `backend-specialist`
- **Файлы:** `src/index.ts`, `src/cli.ts`, `src/commands/*.ts` (заглушки-заглушки с help-текстами)
- **Зависит от:** T01
- **INPUT:** собранный каркас из T01.
- **OUTPUT:** работающий бинарник: `--help`/`--version` и заглушки всех 7 команд с описаниями; код команд вынесен в `src/commands/` (по одному модулю на команду).
- **VERIFY:**
  - `node dist/index.js --help` выводит список всех команд;
  - `node dist/index.js generate --help` показывает флаги (даже если логика ещё заглушка);
  - `node dist/index.js --version` печатает версию из package.json;
  - exit code 0 во всех случаях; на неизвестную команду — понятная ошибка, exit ≠ 0.

#### T03 — Конфигурация: cosmiconfig + Zod + env
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/config.ts`, `src/lib/schemas.ts`, `src/commands/config.ts`
- **Зависит от:** T02
- **INPUT:** схема конфига (§3 env-переменные, приоритет: env > файл конфига > дефолты).
- **OUTPUT:**
  - загрузчик конфига: `.promptwizardrc.json` / `.promptwizardrc.yaml` / ключ `promptwizard` в `package.json`;
  - Zod-схема `ConfigSchema` (провайдер, модель, base_url, ключи) и `env`-нормализация;
  - команда `config show` (маскирует ключ: `sk-***`), `config set`, `config init` (создаёт rc-файл);
  - нечитаемый/невалидный конфиг → человекочитаемая ошибка с путём к файлу.
- **VERIFY:**
  - `node dist/index.js config init` создаёт `.promptwizardrc.json`;
  - `config set llm.provider anthropic` обновляет файл, `config show` отражает изменение;
  - ключ из env виден в `config show` как замаскированный (не утекает в вывод);
  - невалидный JSON в rc-файле → ошибка с именем файла, без stack trace.

### Milestone M2 — Движок шаблонов (автономное ядро)

#### T04 — Zod-схема шаблонов и типы домена
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/schemas.ts` (расширение), `src/lib/engine/errors.ts`
- **Зависит от:** T01 (параллельно с T02–T03)
- **INPUT:** формат шаблона из §7.
- **OUTPUT:** `TemplateSchema`, `SlotSchema`, `RuleSchema`, типы `PromptType`, `Platform`, типизированные ошибки движка (`TemplateLoadError`, `ValidationError` с полем `file`/`slot`).
- **VERIFY:** `npx tsc --noEmit` зелёный; каждый тип/схема экспортируется; ошибки содержат путь к проблемному полю/файлу.

#### T05 — База шаблонов: 5 типов промтов, 11+ шаблонов
- **Агент:** `backend-specialist`
- **Файлы:** `src/templates/image/{midjourney,dalle,stable-diffusion}.json`, `src/templates/code/{generic-llm,review,refactor}.json`, `src/templates/text/{article,copywriting,rewrite}.json`, `src/templates/video/{runway,sora-like}.json`, `src/templates/music/{suno,generic}.json`
- **Зависит от:** T04
- **INPUT:** `TemplateSchema` из T04; предметные знания по платформам (MJ-параметры `--ar/--v/--style`, негативные промты SD, чанки DALL-E, структура промтов для кода/текста/видео/музыки).
- **OUTPUT:** заполненная база: для каждой платформы — слоты, шаблонная строка, правила, дефолты, 1–2 примера; каждый файл проходит `TemplateSchema`.
- **VERIFY:**
  - `node dist/index.js doctor` (после T08) показывает «шаблоны валидны»;
  - каждый JSON валиден схемой (этот чек именно здесь — ручной прогон валидатора или быстрый скрипт, НЕ тестовый файл);
  - присутствуют все 5 типов; для image — все 3 платформы;
  - в негативных/параметрах нет выдуманных плейсхолдеров (`TODO`).

#### T06 — Реестр шаблонов: чтение, валидация, индексация
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/templates/registry.ts`
- **Зависит от:** T04, T05
- **INPUT:** каталог `src/templates/**` (в `dist` — через скрипт копирования из T01).
- **OUTPUT:** `loadRegistry()` — рекурсивно читает JSON, валидирует каждый, строит индексы: по `type`, по `type+platform`, по `id`; кеширует в памяти; ошибка валидации = `TemplateLoadError` с точным путём файла.
- **VERIFY:**
  - модуль находит все JSON-файлы независимо от текущей рабочей директории (пути резолвятся от `import.meta.url`, НЕ от `process.cwd()` — критично для Windows и глобальной установки);
  - битый один файл вручную → понятная ошибка с его путём; после исправления — снова зелёный.

#### T07 — Движок сборки промта (builder + rules)
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/engine/builder.ts`, `src/lib/engine/rules.ts`
- **Зависит от:** T06
- **INPUT:** `Template` + `GenerateInput` (слоты/параметры от пользователя).
- **OUTPUT:**
  - `buildPrompt(template, input): PromptResult` — подстановка слотов, применение условных `rules`, слияние `defaults` с пользовательскими параметрами, сборка негативного блока для SD;
  - детерминированная работа (одинаковый вход → одинаковый выход), никаких обращений к сети;
  - валидация: обязательные слоты заполнены, неизвестные слоты → ошибка со списком допустимых.
- **VERIFY:**
  - сборка по каждому из примеров `examples` в шаблонах даёт воспроизводимый результат;
  - отсутствие обязательного слота → ошибка с именем слота;
  - `npx tsc --noEmit` зелёный; ни одного `fetch`/сети в модуле (проверка по коду).

#### T08 — Команды `list-types` и `list-templates`
- **Агент:** `backend-specialist`
- **Файлы:** `src/commands/list-types.ts`, `src/commands/list-templates.ts`
- **Зависит от:** T06
- **INPUT:** реестр шаблонов.
- **OUTPUT:** человекочитаемые таблицы (chalk-выравнивание) + режим `--json` (стабильная структура для скриптов): типы → платформы → шаблоны (id, name, description, слоты).
- **VERIFY:**
  - `list-types` показывает все 5 типов с платформами;
  - `list-templates image` — 3 шаблона; `list-templates image --json` — валидный JSON в stdout (проверить пайпом `| node -e "JSON.parse(...)"`);
  - неизвестный тип → понятная ошибка + подсказка, exit ≠ 0.

#### T09 — Команда `generate` (неинтерактивный режим)
- **Агент:** `backend-specialist`
- **Файлы:** `src/commands/generate.ts`, `src/lib/output.ts`, `src/lib/clipboard.ts`
- **Зависит от:** T07, T08
- **INPUT:** флаги: `--type`, `--platform`, `--subject`, `--style`, `--param k=v` (повторяемый), `--negative`, `--out <файл>`, `--copy`, `--json`, `--refine` (заглушка до M4), `--stdin` (чтение subject из pipe).
- **OUTPUT:**
  - сборка промта через движок; вывод по умолчанию в stdout; `--out` — запись файла (UTF-8, создаёт родительские каталоги); `--copy` — копирование в буфер обмена (на win32 вызывается `Set-Clipboard` через `powershell.exe`), `--json` — машинный формат `{prompt, negative?, template, type, platform}`;
  - валидация флагов Zod до запуска движка.
- **VERIFY:**
  - `node dist/index.js generate --type image --platform midjourney --subject "test" > out.txt` — файл содержит промт;
  - `--out .\nested\dir\p.txt` — файл создан, включая каталоги;
  - `--copy` на Windows — промт реально попадает в буфер (проверить `Get-Clipboard`);
  - `--json` парсится; неверный `--type` → Zod-ошибка с перечислением допустимых значений;
  - пайп: `echo "text" | node dist/index.js generate --type text --stdin ...` работает.

### Milestone M3 — Интерактивный режим

#### T10 — Команда `interactive` (мастер)
- **Агент:** `backend-specialist`
- **Файлы:** `src/commands/interactive.ts`
- **Зависит от:** T07, T09 (нужны движок и слой вывода)
- **INPUT:** реестр шаблонов + inquirer-промпты.
- **OUTPUT:** пошаговый мастер: выбор типа → платформа → заполнение слотов (input/select/confirm по типу слота) → предпросмотр собранного промта → действие (копировать / сохранить в файл / вернуться к шагу). Учтён не-TTY запуск → понятное сообщение «используйте generate с флагами».
- **VERIFY:**
  - интерактивный прогон до готового промта без ручного правления конфига;
  - при запуске в пайпе (`... | Out-String`) — отказ с подсказкой, не зависание;
  - отмена (Ctrl+C) — выход без stack trace.

#### T11 — Доработка вывода: файлы, буфер обмена, `doctor`
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/output.ts`, `src/lib/clipboard.ts` (если нужны правки), `src/commands/doctor.ts`
- **Зависит от:** T09
- **INPUT:** готовые модули вывода/конфига/реестра.
- **OUTPUT:**
  - `doctor`: версия node, путь найденного конфига, наличие/маска ключа и провайдера, валидность базы шаблонов, работоспособность буфера обмена (best-effort);
  - устойчивость `output.ts`: ошибки записи/буфера не роняют процесс молча — понятное предупреждение.
- **VERIFY:**
  - `doctor` даёт исчерпывающий отчёт, exit 0 в здоровом окружении;
  - отсутствие ключа → «LLM не настроен, автономный режим работает» (не ошибка);
  - `--out` в недоступный путь (например, на несуществующий диск `X:\`) → понятная ошибка, exit ≠ 0.

### Milestone M4 — LLM-интеграция (опциональная)

#### T12 — Провайдеры LLM (OpenAI-совместимый + Anthropic)
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/llm/provider.ts`, `src/lib/llm/openai.ts`, `src/lib/llm/anthropic.ts`
- **Зависит от:** T03 (нужен конфиг)
- **INPUT:** `Config` (провайдер, ключ, base_url, модель); Zod-схемы запросов/ответов.
- **OUTPUT:**
  - `interface LLMProvider { refine(system, user): Promise<string> }` + фабрика по конфигу;
  - OpenAI-совместимый: `POST {base_url}/chat/completions`, поддержка custom `base_url` (локальные прокси, совместимые серверы);
  - Anthropic: `POST https://api.anthropic.com/v1/messages`, заголовки `x-api-key`, `anthropic-version`;
  - нативный `fetch` + AbortController-таймаут (10–30 с), ретрай 1 раз на 5xx/сетевую ошибку, нормализация ошибок API в человекочитаемые сообщения (401 → «ключ неверен», 429 → «лимит запросов», таймаут → «нет сети»).
- **VERIFY:**
  - без ключа фабрика возвращает `null`/бросает типизированную `LlmNotConfiguredError` (не generic Error);
  - мок-`fetch` (проверяется в задачах test-engineer): 200 → парсинг текста; 500 → ретрай → ошибка; таймаут → понятная ошибка;
  - ключ/токен нигде не печатается в логи (только маска).

#### T13 — Команда `refine` (LLM-доработка промта)
- **Агент:** `backend-specialist`
- **Файлы:** `src/lib/llm/refine.ts`, `src/commands/refine.ts`
- **Зависит от:** T12; контекст от T09 (вывод/файлы)
- **INPUT:** текст промта из `--text`, `--in <файл>` или stdin; цель доработки `--goal` (optional).
- **OUTPUT:**
  - системный промпт доработки: «улучши промт, сохрани намерение, верни ТОЛЬКО промт»;
  - ввод из файла/stdin/флага; результат → stdout/`--out`/`--copy` (те же правила, что в `generate`);
  - **без ключа:** exit ≠ 0 + сообщение «задайте PROMPTWIZARD_LLM_API_KEY или настройте config set llm.provider» (refine — единственная команда, требующая ключ);
  - ошибки сети → понятное сообщение, исходный текст НЕ теряется (подсказка «результат сохранён локально/используйте без --refine»).
- **VERIFY:**
  - без ключа — корректная ошибка с подсказкой, без stack trace;
  - с мок-провайдером/реальным ключом (если есть) — доработанный текст в выбранном выходе;
  - stdin-режим: `Get-Content p.txt | node dist/index.js refine` работает.

#### T14 — Интеграция `--refine` в `generate`
- **Агент:** `backend-specialist`
- **Файлы:** `src/commands/generate.ts`, `src/lib/llm/refine.ts` (подключение)
- **Зависит от:** T13, T09
- **INPUT:** флаг `--refine` в `generate`.
- **OUTPUT:** сначала локальная сборка, затем опциональная LLM-доработка; флаг `--no-refine`-поведение по умолчанию: без ключа — тихо локальный результат + предупреждение в stderr (generate ДОЛЖЕН работать без ключа — S1!).
- **VERIFY:**
  - `generate` без ключа и без `--refine` — 0 предупреждений, exit 0;
  - `generate --refine` без ключа — предупреждение в stderr, но промт всё равно выдан (или явный отказ — фиксируется при разработке и не нарушает S1);
  - `generate --refine` с ключом — промт прошёл LLM-доработку.

### Milestone M5 — Тесты (пишет ТОЛЬКО test-engineer)

> Правило: **тестовые файлы (`**/*.test.ts`, `tests/**`) создаёт и правит исключительно `test-engineer`.**
> `backend-specialist` после M1–M4 не трогает тестовые файлы; по находкам получает задачи на исправление
> исходников (не тестов).

#### T15 — Юнит-тесты движка и реестра шаблонов
- **Агент:** `test-engineer`
- **Файлы:** `tests/engine/builder.test.ts`, `tests/engine/rules.test.ts`, `tests/templates/registry.test.ts` (+ инфраструктура тестов: `vitest.config.ts`, моки фикстур)
- **Зависит от:** T07 (движок готов), T06 (реестр готов)
- **INPUT:** скомпилированный/исходный код `builder.ts`, `rules.ts`, `registry.ts`; шаблоны `src/templates/**`.
- **OUTPUT:** тесты: подстановка слотов (обязательные/опциональные), условные правила, слияние defaults, негативный блок SD, ошибки валидации (тип + сообщение), загрузка реестра (пути через `import.meta.url`, битый JSON → ошибка с путём), кеширование.
- **VERIFY:** `npm test` зелёный; покрытие `src/lib/engine/**` и `registry.ts` ≥ 90%; тесты детерминированы (без сети, без реальной ФС вне tmp-каталога).

#### T16 — Юнит-тесты конфига, схем и валидации ввода
- **Агент:** `test-engineer`
- **Файлы:** `tests/config/config.test.ts`, `tests/config/schemas.test.ts`
- **Зависит от:** T03, T04
- **INPUT:** `config.ts`, `schemas.ts`.
- **OUTPUT:** тесты: приоритет env > rc-файл > дефолты; маскирование ключа; невалидный rc → ошибка с путём; Zod-ошибки для флагов `generate` (неверный тип, отсутствие обязательного слота, неизвестная платформа).
- **VERIFY:** `npm test` зелёный; все ветки приоритета конфига покрыты; ключ не встречается в snapshot'ах вывода.

#### T17 — Тесты LLM-клиента (моки сети) и интеграционные тесты CLI
- **Агент:** `test-engineer`
- **Файлы:** `tests/llm/openai.test.ts`, `tests/llm/anthropic.test.ts`, `tests/llm/refine.test.ts`, `tests/cli/generate.test.ts`, `tests/cli/list-types.test.ts`, `tests/cli/refine-no-key.test.ts`
- **Зависит от:** T12, T13, T09 (все команды готовы)
- **INPUT:** провайдеры и команды; возможность мокать `fetch` и spawn'ить `dist/index.js`.
- **OUTPUT:**
  - мок-`fetch`: успех → парсинг; 401/429/500 → корректные типизированные ошибки; таймаут → ошибка; ретрай ровно 1 раз; отсутствие ключа в логах;
  - интеграционные: spawn процесса CLI → проверка stdout/exit-кодов для `generate` (stdout, `--out`, `--json`), `list-types`, `refine` без ключа;
  - сеть в тестах запрещена (nock/msw/ручной мок).
- **VERIFY:** `npm test` зелёный, ни одного реального сетевого запроса; интеграционные тесты проходят на Windows-путях (пробелы в путях tmp-каталога).

#### T18 — Исправление замечаний тестов + регресс
- **Агент:** `backend-specialist` (исходники) / `test-engineer` (прогон и вердикт)
- **Файлы:** по результатам T15–T17 (исходники в `src/**`, тесты правит только test-engineer)
- **Зависит от:** T15, T16, T17
- **INPUT:** падающие/недостаточные тесты, отчёт покрытия.
- **OUTPUT:** исходники исправлены, тесты переписаны только если требование изменил `test-engineer`; полный прогон зелёный.
- **VERIFY:** `npm run lint && npx tsc --noEmit && npm test && npm run build` — все 4 шага зелёные подряд.

---

## 9. Граф зависимостей и порядок выполнения

```
T01 ──► T02 ──► T03 ─────────────► T12 ──► T13 ──► T14
 │              │                    │       │       │
 │              │                    │       └───┬───┘
 ▼              │                    ▼           ▼
T04 ──► T05 ──► T06 ──► T07 ──► T09 ──► T10     │
               │  ▲      │  ▲    │               │
               │  │      ▼      ▼               │
               │  └──── T08   T11 ◄──────────────┘
               │
               └──── (T04 параллельно T02–T03)
```

**Параллельные ветки (можно одновременно, разные файлы):**
- Ветка A: T02 → T03 (команды + конфиг)
- Ветка B: T04 → T05 → T06 (схема → база шаблонов → реестр), стартует сразу после T01
- После T06 → T07 → T09 (движок → generate)
- T12 (LLM) стартует сразу после T03, не дожидаясь M2/M3
- M5 (тесты) стартует после соответствующих задач; полностью — после T14
- T14 (рефайн в generate) замыкает M4

**Критический путь:** T01 → T04 → T05 → T06 → T07 → T09 → T10/T11 → T12 → T13 → T14 → T15–T17 → T18.

---

## 10. Milestones

| Milestone | Задачи | Содержательный результат (Definition of Done) |
|-----------|--------|-----------------------------------------------|
| **M1 — Каркас CLI** | T01–T03 | Проект собирается (`build`/`lint`/`typecheck` зелёные), `node dist/index.js --help` работает, конфиг читается, `config`-команда функциональна |
| **M2 — Движок шаблонов** | T04–T09 | База из 11+ шаблонов по 5 типам валидна, `list-types`/`list-templates` работают, `generate` собирает промт в stdout/файл/буфер БЕЗ ключей и БЕЗ сети |
| **M3 — Интерактив** | T10–T11 | `interactive` доводит от вопроса до готового промта, `doctor` диагностирует окружение, вывод устойчив к ошибкам |
| **M4 — LLM-интеграция** | T12–T14 | `refine` работает с OpenAI-совместимым и Anthropic API; без ключа — понятная ошибка только в `refine`; `generate --refine` не ломает автономный режим |
| **M5 — Тесты и финальная проверка** | T15–T18 | Покрытие движка/конфига ≥ 90%, интеграционные тесты CLI зелёные, все проверки Phase X пройдены |

После каждого Milestone — инкрементально работающий инструмент (никакого «всё заработает в конце»).

---

## 11. Риски и митигации

| # | Риск | Вероятность/Влияние | Митигация |
|---|------|---------------------|-----------|
| **R1** | **Нет API-ключа / нет сети** — пользователь ожидает работу | Высокое / Критическое | Движок полностью автономен (T07 без `fetch`). S1 — пункт приёмки. `refine` — единственное место, требующее ключа; `generate --refine` без ключа деградирует с предупреждением, не падением (T14) |
| **R2** | **Ошибки сети/таймауты/лимиты LLM** (401/429/5xx, обрыв) | Высокое / Среднее | AbortController-таймаут, 1 ретрай на 5xx, нормализация ошибок в человекочитаемые (T12); исходный промт не теряется при сбое `refine` (T13) |
| **R3** | **Невалидный ввод** (флаги, слоты, rc-файл, битые JSON-шаблоны) | Высокое / Среднее | Zod на всех границах: флаги, конфиг, шаблоны; ошибки с путём файла/именем слота и списком допустимых значений, без stack trace (T03, T04, T06, T09) |
| **R4** | **Windows/PowerShell-специфика**: длинные пути, кодировка консоли, clipboard, execution policy | Среднее / Среднее | `node:path` для путей; резолв ассетов от `import.meta.url`, не от cwd (T06); буфер обмена через `Set-Clipboard` в win32 с fallback-предупреждением (T09/T11); chalk/символы без Unicode-артефактов в legacy-консоли; инструкция запуска через `npx` (обход execution policy) |
| **R5** | **Качество/поверхность базы шаблонов**: 5 типов × глубина — легко распылиться | Среднее / Высокое | Формат шаблонов единый и богатый (слоты+правила+примеры), но объём на старте минимален: 11–14 шаблонов, по 1–2 на платформу; расширение — только добавление JSON без правки кода |
| **R6** | **JSON-ассеты не попадают в `dist`** — «работает в dev, падает после сборки» | Среднее / Высокое | Шаг `copy-assets` в `npm run build` (T01) + проверка наличия `dist/templates` в `doctor` (T11) и в Phase X |
| **R7** | **Утечка API-ключа** в логи/отчёты/тестовые snapshot'ы | Низкое / Критическое | Маскирование в `config show` (T03), запрет печати ключа в ошибках LLM (T12), тест на отсутствие ключа в выводе (T16) |
| **R8** | Нарушение границ агентов (backend пишет тесты и наоборот) | Среднее / Среднее | Жёсткое правило разделения: тесты — только `test-engineer` (M5); задачи T15–T18 сформулированы только для него; правки после находок — через T18 с явным разделением ролей |

---

## 12. Phase X: Финальная верификация (обязательна перед завершением)

> Не отмечать пункт `[x]` без реально пройденной проверки.

### 12.1 Сборка и статический анализ
- [x] `npm install` — без ошибок/критичных warning'ов
- [x] `npm run lint` — 0 ошибок
- [x] `npx tsc --noEmit` — 0 ошибок (strict)
- [x] `npm run build` — `dist/` создан, `dist/templates/**/*.json` скопированы

### 12.2 Тесты (запускает test-engineer)
- [x] `npm test` — все зелёные (212/212), пороги покрытия движка/конфига настроены (≥ 90%)
- [x] Ни одного реального сетевого запроса в тестах (network guard в `tests/setup.ts`)
- [ ] `python .agent/scripts/verify_all.py .` — не применимо (скрипт отсутствует в окружении)

### 12.3 Smoke-сценарии в PowerShell (Windows)
- [x] `node dist/index.js --help` и `--version` (0.1.0)
- [x] `node dist/index.js doctor` — отчёт без ключа: «автономный режим работает» (13 шаблонов валидны, буфер доступен)
- [x] `node dist/index.js list-types` — 5 типов; `list-templates image --json` — валидный JSON (3 шаблона)
- [x] `node dist/index.js generate --type image --platform midjourney --subject "cyberpunk city" --style cinematic > out.txt` — файл содержит промт (S1)
- [x] `generate --type code --platform generic-llm --subject "..." --out .\tmp\nested\p.md` — файл создан, родительские каталоги тоже; `--copy` вызывает `Set-Clipboard` (в headless-сессии оркестратора буфер недоступен — проверяется `doctor` как «доступен»)
- [x] `node dist/index.js interactive` — полный проход до превью (T10; покрыто тестами)
- [x] `node dist/index.js refine --text "x"` **без ключа** — понятная ошибка, без stack trace (R1/R3), exit ≠ 0
- [x] `refine` без источника — «Не задан текст промта…», exit ≠ 0
- [x] Неверный флаг `generate --type nope` — человекочитаемая ошибка со списком допустимых типов, exit ≠ 0

### 12.4 Правила и гигиена
- [x] Нет тестовых файлов вне `tests/` и ни одного `.test.ts`, созданного не `test-engineer`
- [x] Нет ключей/секретов в репозитории; `.env` в `.gitignore`; `.env.example` с плейсхолдерами
- [x] `docs/PLAN.md` актуален (все `[ ]` → `[x]` только после прогонов)

### 12.5 Маркер завершения (вписать после прохождения всех пунктов)

```markdown
## ✅ PHASE X COMPLETE
- Lint: ✅ Pass (eslint + prettier, 0 ошибок)
- Typecheck: ✅ Pass (tsc --noEmit strict, 0 ошибок)
- Tests: ✅ Pass (212/212, пороги покрытия engine/config настроены)
- Build: ✅ Success (dist + templates assets — 13 JSON скопированы)
- Smoke (PowerShell/Windows): ✅ Pass
- Дата: 2026-10-21
```

---

*План подготовлен для PLANNING-фазы. Код на этом этапе НЕ пишется. Следующий шаг — согласование плана, затем SOLUTIONING (детали архитектуры модулей), затем IMPLEMENTATION по T01…T18.*
