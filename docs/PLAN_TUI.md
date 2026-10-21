# PLAN_TUI.md — Полноэкранный многопанельный TUI на базе Ink

> **Тип проекта:** BACKEND / CLI (терминальная утилита)  
> **Рабочая директория:** `C:\develop\promtwizard`  
> **Окружение:** Windows / PowerShell, Node.js 20+, TypeScript strict, ESM  
> **Режим:** PLANNING (только план, код не пишется)  
> **Текущий статус:** MVP готов (212 тестов зелёные, lint/tsc/build чистые). Существующий план: `docs/PLAN.md`  
> **Новая фича:** Отдельная команда `promptwizard tui` на базе **Ink** (React для терминала). Команда `interactive` (`@inquirer/prompts`) **останется без изменений**.

---

## 1. Цель и требования

### 1.1 Цель
Добавить полноэкранный многопанельный TUI-интерфейс как **отдельную** команду `promptwizard tui`. TUI должен переиспользовать всю существующую логику сборки промтов, не дублируя её.

### 1.2 Функциональные требования
| Требование | Описание |
|------------|----------|
| **Библиотека** | Ink (React-подход, рендер в терминале) |
| **Полноэкранный многопанельный UI** | Например: слева — список типов/платформ, справа/по центру — форма заполнения слотов, снизу — живой предпросмотр собираемого промта |
| **Навигация** | Клавиатура только (стрелки/Tab/Enter/Esc), без мыши |
| **Переиспользование логики** | Не дублировать валидацию/сборку — использовать существующие модули |
| **Не-TTY** | Понятный отказ с подсказкой (как в `src/commands/interactive.ts:35-41`) |
| **Ctrl+C** | Тихий выход без stack trace (аналогично `src/cli.ts:51-66`, нужен свой обработчик через `useInput`) |

### 1.3 Переиспользуемые модули (обязательные)
| Модуль | Назначение | Примечание |
|--------|------------|------------|
| `src/lib/templates/registry.ts` | `loadRegistry()`, `findTemplate()`, `platformsForType()`, `getTemplatesByType()` | Реестр резолвится от `import.meta.url` (критично для Windows) |
| `src/lib/engine/builder.ts` | `buildPrompt(template, input) → PromptResult` | Детерминированный движок, без сети/ФС |
| `src/lib/clipboard.ts` | `copyToClipboard(text)` | Кросс-платформенный (win32 → `powershell.exe Set-Clipboard` через stdin) |
| `src/lib/output.ts` | `writeOutputFile(path, content)`, `emitPrompt/emitText` | UTF-8, создание родительских каталогов |
| `src/lib/schemas.ts` | `Slot`, `Template`, `PromptType`, `PROMPT_TYPES`, `platformSlug` | Единые типы/схемы |
| `src/lib/engine/errors.ts` | `PromptWizardError`, `ValidationError`, `BuildError`, etc. | Единый подход к ошибкам |

### 1.4 Вынос валидации слотов
Как в `src/commands/interactive.ts:162-173` есть `validateTextSlot(slot, raw)`. Эту логику **нужно вынести** в переиспользуемый модуль валидации слотов, чтобы `interactive` и `tui` её **разделяли**.

**Предлагаемый модуль:** `src/lib/validation/slots.ts` (новый). Он должен содержать функции валидации для типов слотов `string|number|enum|boolean` с человекочитаемыми сообщениями об ошибках (без stack trace).

---

## 2. Границы доменов (строго соблюдать)

| Агент | Область ответственности | Запреты |
|-------|--------------------------|---------|
| **`backend-specialist`** | Вся логика TUI (новые файлы в `src/commands/tui/`, `src/lib/tui/`, `src/lib/validation/`), интеграция в CLI (`src/cli.ts`, `package.json`) | Не трогать `tests/**` |
| **`test-engineer`** | **Только** тестовые файлы (`tests/**`, `**/*.test.ts`). Создание/правка TUI-тестов. | Не править исходники в `src/` |
| **frontend/mobile** | **Не используются** | TUI — CLI/backend-домен |

**Команда `interactive` (`src/commands/interactive.ts`) — БЕЗ ИЗМЕНЕНИЙ.** При рефакторинге вынесения `validateTextSlot` в общий модуль нужно обновить `interactive.ts` для **импорта** из нового модуля, но **сохранить поведение полностью**.

---

## 3. Ограничения проекта (обязательные к соблюдению)

| Ограничение | Требование | Как обеспечить |
|-------------|------------|----------------|
| **Автономность (S1)** | Работает без API-ключей и сети. LLM-доработка только опционально с graceful fallback. | TUI использует только `loadRegistry()` + `buildPrompt()` + `copyToClipboard()` + `writeOutputFile()`. Никаких сетевых вызовов по умолчанию. |
| **Нет секретов в выводе** | Ключи/токены никогда не отображаются | Следовать подходу как в `src/commands/config.ts` (маскирование) |
| **Zod-валидация** | Весь ввод через Zod, человекочитаемые ошибки без stack trace | Валидация флагов команды `tui` через Zod (по аналогии с `generate.ts`), валидация слотов через вынесенный модуль |
| **Windows/PowerShell совместимость** | Пути через `node:path`, ассеты от `import.meta.url`, не от `cwd` | Как в `src/lib/templates/registry.ts:24-25`. Буфер через `clipboard.ts` (уже есть) |
| **Тесты** | Без реальных сетевых запросов, интеграционные CLI-тесты спавнят `dist/index.js` | Следовать паттерну из `tests/cli/*.test.ts`, `tests/setup.ts` (фетч-заглушка) |
| **Сборка** | `npm run build` должен включать Ink-код в `dist/`. `copy-assets.mjs` копирует только `templates/` — Ink-код копируется `tsc` | `tsconfig.json` компилирует `src` в `dist`. Нужно настроить JSX для Ink/React. |

---

## 4. Анализ текущей структуры (реальные файлы)

### 4.1 Ключевые файлы для изучения
```
src/
├── cli.ts                        # регистрация команд (добавить registerTuiCommand)
├── index.ts                      # точка входа
├── commands/
│   ├── generate.ts               # паттерн парсинга флагов, валидации, fallback
│   ├── interactive.ts            # не-TTY проверка, Ctrl+C обработка, логика fillSlots/validateTextSlot
│   ├── list-types.ts, list-templates.ts, refine.ts, config.ts, doctor.ts
└── lib/
    ├── schemas.ts                # Slot, Template, PromptType, PROMPT_TYPES
    ├── templates/registry.ts     # loadRegistry, findTemplate, platformsForType
    ├── engine/builder.ts         # buildPrompt
    ├── engine/errors.ts          # типизированные ошибки
    ├── output.ts                 # writeOutputFile
    ├── clipboard.ts              # copyToClipboard
    └── config.ts, llm/*          # опционально не используется в TUI
```

### 4.2 package.json (текущее состояние)
- `"type": "module"`, `"bin": {"promptwizard": "dist/index.js"}`
- Зависимости: `@inquirer/prompts`, `chalk`, `commander`, `cosmiconfig`, `ora`, `yaml`, `zod`
- DevDependencies: TypeScript 5.7.2, Vitest 3.2.7, @types/node 20.x

### 4.3 tsconfig.json (текущее)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "jsx": null, // НЕ НАСТРОЕНО
    ...
  },
  "include": ["src"]
}
```
**Проблема:** Для Ink с React нужен JSX. В ESM + TypeScript strict нужно правильно настроить `"jsx"` и типы.

### 4.4 Сборка
`"build": "npm run typecheck && tsc && node scripts/copy-assets.mjs"` — `tsc` компилирует из `src/` в `dist/`, `copy-assets.mjs` копирует только `src/templates/**` → `dist/templates/**`. **Ink-компоненты в `src/` будут скомпилированы `tsc` в `dist/` автоматически** (если попадают под `include: ["src"]`).

---

## 5. Зависимости для Ink (план установки)

### 5.1 Production зависимости
| Пакет | Версия (ориентир) | Назначение |
|-------|-------------------|------------|
| `ink` | `^5.x` | React для терминала, полноэкранный рендер |
| `react` | `^18.x` | Peer dependency Ink |

### 5.2 Dev зависимости
| Пакет | Версия (ориентир) | Назначение |
|-------|-------------------|------------|
| `@types/react` | `^18.x` | Типы React для TS strict |
| `ink-testing-library` | `^4.x` | Тестирование Ink-компонентов (опционально, но полезно). **Тесты создаёт только `test-engineer`** |

**Примечание по ESM:** Ink v5 совместим с ESM. Нужно убедиться в корректности импортов.

---

## 6. Изменения в конфигурации

### 6.1 `tsconfig.json` (изменить)
**Требуется добавить:**
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",        // Новый JSX transform (React 17+)
    "esModuleInterop": true,   // Уже есть
    // types может потребовать добавления "react" если типы конфликтуют
    // но с @types/react в devDependencies и "types": ["node"] может быть достаточно
  }
}
```

**Важные моменты:**
- `"jsx": "react-jsx"` — не требует `import React from 'react'` в каждом файле (современный подход)
- Ink использует React, поэтому типы нужны
- В ESM с NodeNext проблем обычно нет, если правильно настроено

### 6.2 `package.json` (изменить)
- Добавить зависимости: `"ink"`, `"react"` в `dependencies`
- Добавить devDependencies: `"@types/react"`, при желании `"ink-testing-library"`
- **НЕ трогать** `bin`, `scripts` (кроме возможно не требуется), `files`

### 6.3 `tsconfig.test.json` (проверить)
Уже включает `["src", "tests", "vitest.config.ts"]` — должно подойти для тестов с JSX.

---

## 7. Структура новых файлов

### 7.1 Команда TUI
```
src/commands/
└── tui.ts                    # Регистрация команды 'tui' в Commander
```

### 7.2 TUI приложение (Ink-компоненты, хуки, утилиты)
```
src/lib/tui/
├── app.tsx                   # Корневой Ink App компонент
├── index.tsx                 # Точка входа TUI (render(<App/>) с cleanup)
├── theme.ts                  # Цветовая схема (chalk-совместимая, минималистичная)
├── types.ts                  # TUI-специфичные типы
├── hooks/
│   ├── useRegistry.ts        # Загрузка реестра шаблонов
│   ├── useWizard.ts          # Состояние мастера (тип/платформа/слоты)
│   └── useKeyboard.ts        # Обработчики клавиатуры (опционально)
└── components/
    ├── Layout.tsx            # Многопанельный layout (split view)
    ├── Header.tsx            # Заголовок с навигацией
    ├── TypeList.tsx          # Список типов промтов (левая панель)
    ├── PlatformList.tsx      # Список платформ для выбранного типа
    ├── SlotForm.tsx          # Форма заполнения слотов (центр/правая панель)
    ├── PreviewPanel.tsx      # Живой предпросмотр собираемого промта (нижняя панель)
    ├── StatusBar.tsx         # Статус-бар с подсказками клавиш
    ├── ActionsMenu.tsx       # Меню действий (копировать/сохранить/выход)
    └── ErrorView.tsx         # Отображение ошибок
```

### 7.3 Переиспользуемая валидация слотов
```
src/lib/validation/
└── slots.ts                  # Вынесенная логика validateTextSlot + валидация для всех типов слотов
```

**Обновить:** `src/commands/interactive.ts` — импортировать `validateTextSlot` из `src/lib/validation/slots.js` (сохранить поведение)

---

## 8. Архитектура TUI

### 8.1 Поток работы
```
┌─────────────────────────────────────────────────────────────┐
│                    promptwizard tui                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Проверка TTY (process.stdin.isTTY && process.stdout.isTTY)│
│    → при не-TTY: ValidationError с подсказкой                │
├─────────────────────────────────────────────────────────────┤
│ 2. Загрузка реестра: loadRegistry()                          │
├─────────────────────────────────────────────────────────────┤
│ 3. Ink App рендер: <App registry={registry} />                │
│    Многопанельный интерфейс с состоянием мастера             │
├─────────────────────────────────────────────────────────────┤
│ 4. Пользователь выбирает: тип → платформа → заполняет слоты   │
│    Живой предпросмотр: buildPrompt(template, {slots})         │
├─────────────────────────────────────────────────────────────┤
│ 5. Действия: копировать (copyToClipboard) / сохранить (writeOutputFile) / выйти │
│    Ctrl+C через useInput → тихий выход без stack trace        │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Состояние мастера (UI-слой)
```typescript
type WizardStep = 'type' | 'platform' | 'slots' | 'preview' | 'actions';
interface WizardState {
  step: WizardStep;
  type?: PromptType;
  platform?: string;
  template?: Template;
  slots: Record<string, string>;
  result?: PromptResult;
}
```

### 8.3 Живой предпросмотр
При заполнении слотов в режиме `slots`/`preview` нужно пересчитывать `buildPrompt(template, { slots, flags: { negative: false } })` для показа превью. **Только для отображения** — при финальном действии использовать тот же вызов.

### 8.4 Обработка Ctrl+C
В Ink нужно использовать `useInput`:
```typescript
useInput((input, key) => {
  if (key.ctrl && input === 'c') {
    // Тихий выход
    process.exit(0); // или cleanup + exit
  }
});
```
**Важно:** Не бросать исключение, которое уйдёт в `cli.ts` обработчик `ExitPromptError` (у Ink свои механизмы). Нужно аккуратно обработать выход.

### 8.5 Не-TTY обработка
В `src/commands/tui.ts` (или в action) делать проверку как в `interactive.ts:35-41`:
```typescript
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new ValidationError(
    'TUI-интерфейсу нужен интерактивный терминал (TTY)... ' +
    'Используйте: promptwizard generate --type ...',
  );
}
```

---

## 9. Разбивка задач

### Milestone MT1 — Подготовка инфраструктуры
| ID | Агент | Файлы | INPUT→OUTPUT→VERIFY |
|----|-------|-------|---------------------|
| **MT01** | `backend-specialist` | `package.json`, `tsconfig.json`, `tsconfig.test.json` (проверка) | **INPUT:** Текущие конфиги. **OUTPUT:** Добавлены `ink`, `react` в dependencies, `@types/react` (и при необходимости `ink-testing-library`) в devDependencies. `tsconfig.json` настроен `"jsx": "react-jsx"`. **VERIFY:** `npm install` проходит, `npx tsc --noEmit` проходит с новыми типами, нет конфликтов. |
| **MT02** | `backend-specialist` | `src/lib/validation/slots.ts`, `src/commands/interactive.ts` (обновить импорт) | **INPUT:** Логика `validateTextSlot` из `interactive.ts:162-173`. **OUTPUT:** Вынесен в `src/lib/validation/slots.ts` с экспортом `validateTextSlot` и при необходимости `validateSlotValueForInput`. `interactive.ts` импортирует из нового модуля, **поведение идентично**. **VERIFY:** `npx tsc --noEmit` ок, интерактивный флоу не изменился (логически), существующие тесты `interactive` не сломаны. |

### Milestone MT2 — Команда TUI и базовый каркас
| ID | Агент | Файлы | INPUT→OUTPUT→VERIFY |
|----|-------|-------|---------------------|
| **MT03** | `backend-specialist` | `src/commands/tui.ts`, `src/cli.ts` | **INPUT:** Паттерн команд из `generate.ts`/`interactive.ts`. **OUTPUT:** Команда `tui` зарегистрирована в `src/cli.ts` через `registerTuiCommand`. В `tui.ts` есть проверка TTY, загрузка реестра, запуск Ink-приложения. **VERIFY:** `node dist/index.js --help` показывает `tui`, `node dist/index.js tui --help` работает, в не-TTY среде даёт понятный отказ. |
| **MT04** | `backend-specialist` | `src/lib/tui/types.ts`, `src/lib/tui/theme.ts`, `src/lib/tui/app.tsx`, `src/lib/tui/index.tsx` | **INPUT:** Требования к UI. **OUTPUT:** Базовый Ink App, точка входа для рендера, типы состояния, тема. **VERIFY:** Компиляция `tsc` проходит, компоненты типизированы строго. |

### Milestone MT3 — UI компоненты (многопанельный интерфейс)
| ID | Агент | Файлы | INPUT→OUTPUT→VERIFY |
|----|-------|-------|---------------------|
| **MT05** | `backend-specialist` | `src/lib/tui/components/Layout.tsx`, `src/lib/tui/components/Header.tsx`, `src/lib/tui/components/StatusBar.tsx` | **INPUT:** Дизайн многопанельного layout. **OUTPUT:** Layout с панелями, header, status bar с подсказками клавиш. **VERIFY:** Рендерится без ошибок, адаптируется к размеру терминала (минимальная логика). |
| **MT06** | `backend-specialist` | `src/lib/tui/components/TypeList.tsx`, `src/lib/tui/components/PlatformList.tsx` | **INPUT:** `PROMPT_TYPES`, `platformsForType()`. **OUTPUT:** Навигация по типам/платформам стрелками/Enter, выбор шаблона через `findTemplate()`. **VERIFY:** Корректный переход между шагами. |
| **MT07** | `backend-specialist` | `src/lib/tui/components/SlotForm.tsx`, `src/lib/tui/hooks/useWizard.ts` | **INPUT:** `Template.slots`, `validateTextSlot` из `src/lib/validation/slots.ts`. **OUTPUT:** Форма для slot-ов (input/select/confirm по типу). Валидация как в интерактиве. **VERIFY:** Валидация enum/number/boolean/string работает корректно. |
| **MT08** | `backend-specialist` | `src/lib/tui/components/PreviewPanel.tsx`, `src/lib/tui/hooks/useRegistry.ts` | **INPUT:** `buildPrompt()`. **OUTPUT:** Живой предпросмотр — пересчёт при изменении слотов, отображение `result.prompt`. **VERIFY:** Предпросмотр обновляется, использует `buildPrompt()` без дублирования логики. |

### Milestone MT4 — Действия, выход, интеграция
| ID | Агент | Файлы | INPUT→OUTPUT→VERIFY |
|----|-------|-------|---------------------|
| **MT09** | `backend-specialist` | `src/lib/tui/components/ActionsMenu.tsx`, `src/lib/tui/components/ErrorView.tsx` | **INPUT:** `copyToClipboard()`, `writeOutputFile()`. **OUTPUT:** Меню действий (копировать/сохранить/назад/выход), обработка ошибок с человекочитаемым выводом. **VERIFY:** Копирование через `copyToClipboard()` работает, сохранение через `writeOutputFile()`. |
| **MT10** | `backend-specialist` | `src/lib/tui/app.tsx` (интеграция), `src/commands/tui.ts` (запуск) | **INPUT:** Все компоненты. **OUTPUT:** Полный флоу работает. Ctrl+C обрабатывается через `useInput` (тихий выход). Возврат к предыдущим шагам (Esc/назад). **VERIFY:** Можно пройти полный путь от выбора типа до копирования/сохранения. Ctrl+C не даёт stack trace. |
| **MT11** | `backend-specialist` | `package.json` (финальная проверка), `src/cli.ts` | **INPUT:** Все изменения. **OUTPUT:** Интеграция завершена, `tui` команда доступна. **VERIFY:** `npm run build` успешен, `dist/` содержит скомпилированные `.js` и `.jsx` файлы TUI, `dist/templates/` скопированы. |

### Milestone MT5 — Тесты и регресс (только test-engineer)
| ID | Агент | Файлы | INPUT→OUTPUT→VERIFY |
|----|-------|-------|---------------------|
| **MT12** | `test-engineer` | `tests/validation/slots.test.ts` | **INPUT:** `src/lib/validation/slots.ts`. **OUTPUT:** Тесты вынесенной валидации (string/number/enum/boolean, required/optional), соответствующие поведению из `interactive.ts`. **VERIFY:** `npm test` зелёный. |
| **MT13** | `test-engineer` | `tests/cli/tui.test.ts` | **INPUT:** Команда `tui`. **OUTPUT:** Интеграционный тест CLI (spawn `dist/index.js tui` в не-TTY — должен дать понятный отказ). Тест помощи `--help`. **VERIFY:** Тесты проходят, сеть не используется. |
| **MT14** | `test-engineer` | `tests/tui/` (опционально: `app.test.tsx` с `ink-testing-library`) | **INPUT:** TUI компоненты. **OUTPUT:** Smoke-тесты базовых компонентов (минимальные). Если `ink-testing-library` не установлен — ограничиться CLI smoke-тестами. **VERIFY:** Не ломают покрытие, работают в node-окружении. |
| **MT15** | `backend-specialist` + `test-engineer` | `src/**` (исправления по находкам) | **INPUT:** Результаты MT12-MT14. **OUTPUT:** Исправления только в исходниках, тесты правит **только test-engineer**. **VERIFY:** `npm run lint && npx tsc --noEmit && npm test && npm run build` — все зелёные. Существующие 212 тестов не сломаны. |

---

## 10. Тестируемость Ink-компонентов

### 10.1 Подходы
| Подход | Когда использовать | Описание |
|--------|-------------------|----------|
| **CLI интеграционные тесты** | Всегда (обязательно) | Spawn `dist/index.js tui` с мокированным stdin/stdout. Проверка не-TTY отказа, `--help`, обработка ошибок. Как в `tests/cli/generate.test.ts`. |
| **ink-testing-library** | По желанию (если установлен) | Рендер компонентов в тесте, проверка вывода. Работает в Node. Требует `@types/react`. |
| **Юнит-тесты хуков/утилит** | Рекомендуется | Тестировать логику хуков (`useWizard`) отдельно от рендера, если возможно. |

### 10.2 Рекомендация
- **Минимум:** CLI-интеграционные тесты для команды `tui` (не-TTY, help) — как требует тестовый паттерн проекта
- **Желательно:** Тесты вынесенной валидации в `tests/validation/slots.test.ts`
- **Опционально:** `ink-testing-library` для smoke-тестов компонентов. Если сложновато ввести без поломок — не критично

**Важно:** Все тестовые файлы создаются **только `test-engineer`**.

---

## 11. Поведение в не-TTY и минимальных терминалах

| Сценарий | Ожидаемое поведение |
|----------|---------------------|
| **Запуск в пайпе** (`echo x \| node dist/index.js tui`) | Понятный отказ с подсказкой использовать `generate` (как в `interactive.ts`) |
| **CI без TTY** | То же самое, exit code != 0 |
| **Маленький терминал** | Ink адаптируется, но UI должен быть читаемым. Layout должен быть простым (не излишне сложные колонки) |
| **Windows Terminal / cmd / PowerShell** | Должен работать (как весь CLI). Копирование через `clipboard.ts` уже работает |
| **Ctrl+C** | Тихий выход, без stack trace. Консоль возвращается в нормальное состояние |

---

## 12. Риски и митигации

| # | Риск | Вероятность/Влияние | Митигация |
|---|------|---------------------|-----------|
| **R-TUI1** | **Ink + ESM + TypeScript strict** — проблемы с JSX/импортами | Среднее/Высокое | Настроить `"jsx": "react-jsx"`, проверить с `npx tsc --noEmit`. Использовать `.js` расширения в импортах как в проекте. |
| **R-TUI2** | **Размер бандла зависимостей** (ink + react) | Среднее/Среднее | Это CLI-инструмент, приемлемо. Проверить после установки. |
| **R-TUI3** | **Производительность перерисовки** в большом терминале | Низкое/Среднее | Минимум ре-рендеров, простой layout. Живой предпросмотр пересчитывать только при изменении слотов. |
| **R-TUI4** | **Windows-терминалы** — проблемы с рендером | Среднее/Среднее | Тестировать в PowerShell/Windows Terminal. Ink хорошо работает в современных терминалах Windows. |
| **R-TUI5** | **Конфликт с существующими тестами** (212 тестов) | Низкое/Критическое | Не менять `interactive`, не трогать `tests/**`. Тщательная проверка `npm test` после каждого milestone. |
| **R-TUI6** | **Сборка** — Ink-код не попадает в dist | Низкое/Критическое | `tsc` компилирует весь `src/` (включая `.tsx` при правильном jsx). `build` скрипт не меняется. Проверить `dist/lib/tui/` после сборки. |
| **R-TUI7** | **Ctrl+C/очистка терминала** | Среднее/Среднее | Правильный обработчик `useInput` + `process.exit(0)`. Ink должен корректно очистить экран. |
| **R-TUI8** | **Дублирование логики валидации/сборки** | Низкое/Критическое | Строго использовать `buildPrompt()`, `loadRegistry()`, вынести `validateTextSlot` в общий модуль. Code review по использованию. |

---

## 13. Граф зависимостей

```
MT01 (зависимости + tsconfig)
 │
 ├──► MT02 (валидация слотов)
 │     │
 │     └──► MT07 (SlotForm использует validateTextSlot)
 │
 ├──► MT03 (команда tui + cli.ts)
 │     │
 │     └──► MT10 (интеграция)
 │
 └──► MT04 (базовый каркас)
       │
       ├──► MT05 (Layout/Header/StatusBar)
       │     │
       │     └──► MT10
       │
       ├──► MT06 (TypeList/PlatformList)
       │     │
       │     └──► MT07, MT08
       │
       ├──► MT07 (SlotForm + useWizard)
       │     │
       │     └──► MT08
       │
       ├──► MT08 (PreviewPanel + useRegistry)
       │     │
       │     └──► MT09, MT10
       │
       └──► MT09 (ActionsMenu/ErrorView)
             │
             └──► MT10

MT10 ──► MT11 (сборка + финальная проверка)

MT11 ──► MT12, MT13, MT14 (тесты, только test-engineer)
         │
         └──► MT15 (регресс + фиксы)
```

**Критический путь:** MT01 → MT04 → MT06/MT07 → MT08 → MT09 → MT10 → MT11 → MT15

**Параллельные ветки:** MT02 можно делать параллельно с MT03/MT04. MT05 можно делать после MT04 параллельно с MT06.

---

## 14. Milestones

| Milestone | Задачи | Definition of Done |
|-----------|--------|-------------------|
| **MT1 — Инфраструктура** | MT01-MT02 | Зависимости установлены, JSX настроен, валидация слотов вынесена, `interactive` работает как раньше |
| **MT2 — Команда и каркас** | MT03-MT04 | `promptwizard tui --help` работает, базовый Ink App компилируется |
| **MT3 — UI** | MT05-MT08 | Многопанельный интерфейс с навигацией, формой слотов, живым предпросмотром через `buildPrompt()` |
| **MT4 — Интеграция** | MT09-MT11 | Полный флоу, копирование/сохранение через существующие модули, Ctrl+C тихий выход, не-TTY отказ, `npm run build` успешен |
| **MT5 — Тесты и регресс** | MT12-MT15 | Тесты добавлены `test-engineer`, все 212 существующих тестов зелёные, `lint/tsc/test/build` чистые |

---

## 15. Проверка соответствия требованиям

| Требование | Статус в плане | Место реализации |
|------------|----------------|-------------------|
| **Ink (React для терминала)** | ✅ | `dependencies: ink, react`, `.tsx` компоненты |
| **Полноэкранный многопанельный** | ✅ | `Layout.tsx` с панелями (типы/платформы, форма, превью) |
| **Клавиатура только (стрелки/Tab/Enter/Esc)** | ✅ | `useInput` в компонентах |
| **Переиспользование логики** | ✅ | `loadRegistry()`, `buildPrompt()`, `copyToClipboard()`, `writeOutputFile()`, `schemas` |
| **Вынести валидацию слотов** | ✅ | `src/lib/validation/slots.ts`, используется в `interactive` и `tui` |
| **Не-TTY отказ с подсказкой** | ✅ | `src/commands/tui.ts` проверка как в `interactive.ts` |
| **Ctrl+C тихий выход** | ✅ | `useInput` обработка в Ink |
| **Отдельная команда `tui`** | ✅ | `src/commands/tui.ts`, регистрация в `src/cli.ts` |
| **`interactive` без изменений** | ✅ | Только импорт из нового модуля валидации |
| **Автономность без ключей/сети** | ✅ | Только локальные модули |
| **Windows/PowerShell совместимость** | ✅ | `node:path`, `import.meta.url`, существующий `clipboard.ts` |
| **Тесты только test-engineer** | ✅ | MT12-MT14 назначены `test-engineer` |
| **Границы доменов соблюдены** | ✅ | backend-specialist для кода, test-engineer для тестов |

---

## 16. Команды для верификации (после реализации)

```bash
# Сборка и статический анализ
npm install
npm run lint
npx tsc --noEmit
npm run build

# Проверка команды
node dist/index.js --help | grep tui
node dist/index.js tui --help

# Не-TTY проверка (должен дать понятный отказ)
echo "x" | node dist/index.js tui
echo "x" | node dist/index.js interactive  # для сравнения

# Существующие тесты должны остаться зелёными
npm test
```

---

## Приложение A: Список реальных файлов для переиспользования

| Файл | Экспортируемые сущности | Использование в TUI |
|------|--------------------------|---------------------|
| `src/lib/templates/registry.ts` | `loadRegistry()`, `findTemplate()`, `platformsForType()`, `getTemplatesByType()`, `TemplateRegistry` | Загрузка шаблонов, навигация тип→платформа |
| `src/lib/engine/builder.ts` | `buildPrompt()`, `BuildInput`, `PromptResult` | Сборка промта и живой предпросмотр |
| `src/lib/schemas.ts` | `PROMPT_TYPES`, `PromptType`, `Slot`, `Template`, `platformSlug` | Типы, константы, валидация |
| `src/lib/clipboard.ts` | `copyToClipboard()` | Копирование в буфер обмена |
| `src/lib/output.ts` | `writeOutputFile()` | Сохранение в файл |
| `src/lib/engine/errors.ts` | `ValidationError`, `BuildError`, `PromptWizardError` | Обработка ошибок |
| `src/commands/interactive.ts` | `validateTextSlot` (будет перемещён) | Валидация слотов (общий модуль) |

---

**Готово к реализации.** План следует стилю `docs/PLAN.md`, не содержит кода, перечисляет реальные файлы, учитывает все требования и ограничения проекта.