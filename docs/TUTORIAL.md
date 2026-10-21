# PromptWizard — туториал по использованию

Полное руководство по CLI-инструменту **PromptWizard**: от установки до продвинутых сценариев.

> **Главное:** PromptWizard работает **автономно** — без API-ключей и без интернета.
> Он собирает промты из локальной базы шаблонов (13 шаблонов, 5 типов).
> API-ключ нужен **только** для команды `refine` и флага `--refine` (LLM-доработка).

---

## Содержание

1. [Установка и первая команда](#1-установка-и-первая-команда)
2. [Быстрый старт: 5 минут](#2-быстрый-старт-5-минут)
3. [Основные понятия](#3-основные-понятия)
4. [Команда `generate` — неинтерактивная сборка](#4-команда-generate--неинтерактивная-сборка)
5. [Команда `interactive` — пошаговый мастер](#5-команда-interactive--пошаговый-мастер)
6. [Команды `list-types` и `list-templates`](#6-команды-list-types-и-list-templates)
7. [Команда `doctor` — диагностика окружения](#7-команда-doctor--диагностика-окружения)
8. [Команда `config` — настройка](#8-команда-config--настройка)
9. [Команда `refine` — LLM-доработка (нужен ключ)](#9-команда-refine--llm-доработка-нужен-ключ)
10. [Сценарии по типам промтов](#10-сценарии-по-типам-промтов)
11. [Интеграция со скриптами и пайпами](#11-интеграция-со-скриптами-и-пайпами)
12. [Частые проблемы (FAQ)](#12-частые-проблемы-faq)
13. [Шпаргалка](#13-шпаргалка)

---

## 1. Установка и первая команда

### Требования

- **Node.js 20+** (проверить: `node --version`)
- Windows / macOS / Linux

### Установка из исходников

```powershell
git clone https://github.com/verusdev/promptwizard.git
cd promptwizard
npm install
npm run build
```

После сборки запускайте инструмент так:

```powershell
node dist/index.js --version
# 0.1.0
```

> **Совет.** Чтобы не писать `node dist/index.js` каждый раз, создайте ярлык-функцию:
>
> ```powershell
> function pw { node C:\develop\promtwizard\dist\index.js @args }
> ```
>
> Теперь можно писать просто `pw generate ...`. Все примеры ниже используют `promptwizard` —
> замените его на `pw` или `node dist/index.js`, как вам удобнее.

### Проверка, что всё работает

```powershell
promptwizard doctor
```

Ожидаемый вывод (без ключей): «LLM не настроен, автономный режим работает» и «База шаблонов: 13 шаблонов, все валидны».

---

## 2. Быстрый старт: 5 минут

### Шаг 1. Соберите первый промт

```powershell
promptwizard generate --type image --platform midjourney --subject "a lone lighthouse on a cliff" --style "oil painting"
```

**Вывод:**
```
a lone lighthouse on a cliff, oil painting --ar 16:9 --v 6.1 --stylize 100 --chaos 0
```

Готовый промт для Midjourney — с дефолтными параметрами `--ar`, `--v`, `--stylize`, `--chaos`, подставленными автоматически.

### Шаг 2. Скопируйте в буфер и вставьте в Midjourney

```powershell
promptwizard generate --type image --platform midjourney --subject "neon samurai in rain" --style cinematic --copy
```

Промт оказался в буфере обмена — просто вставьте его (Ctrl+V).

### Шаг 3. Посмотрите, что вообще есть в базе

```powershell
promptwizard list-types
promptwizard list-templates image
```

### Шаг 4. Сохраните промт в файл

```powershell
promptwizard generate --type code --subject "REST API на FastAPI для блога" --out .\prompts\api.md
```

Готово — вы умеете 90% того, что нужно повседневно. Дальше — детали.

---

## 3. Основные понятия

### Типы промтов (5 штук)

| Тип | Что генерирует промт для… | Шаблоны (платформы) |
|-----|---------------------------|---------------------|
| `image` | генерации изображений | Midjourney, DALL-E 3, Stable Diffusion |
| `code` | написания/ревью/рефакторинга кода | Generic LLM (3 шаблона) |
| `text` | статей, копирайтинга, рерайта | Generic LLM (3 шаблона) |
| `video` | генерации видео | Runway, Sora-like |
| `music` | генерации музыки | Suno, Generic |

### Шаблон (template)

Каждый шаблон — это JSON-файл с:
- **слотами** (`slots`) — переменные, которые вы заполняете (`subject`, `style` и т.д.);
- **шаблонной строкой** (`template`) — каркас промта с плейсхолдерами `{subject}`;
- **правилами** (`rules`) — условные добавления (например, «если стиль = anime → добавить …»);
- **дефолтами** (`defaults`) — параметры по умолчанию;
- **примерами** (`examples`).

### Слоты: обязательные и опциональные

В `list-templates` обязательные слоты помечены звёздочкой: `subject*`. Если обязательный слот не заполнен — команда вернёт понятную ошибку, а не «сломанный» промт.

### ⚠️ Enum-слоты — принимают только фиксированные значения

У части слотов `type: "enum"` — это значит, что значение должно быть **ровно одним из списка**, иначе команда откажет с перечислением допустимых. Пример ошибки:

```
Ошибка: Слот "mood" шаблона "dalle": недопустимое значение "calm and warm".
Допустимые: cheerful, mysterious, serene, dramatic, melancholic, professional.
```

Поэтому свободный текст (`--param mood="что-то своё"`) в enum-слот не проходит — выбирайте из списка. Полный список значений любого слота:

```powershell
promptwizard list-templates <тип> --json   # смотрите поле options у слотов с type: enum
```

Например, у `dalle`: `style`, `mood`, `composition` — enum; у `suno`: `tempo`, `vocals` — enum; а вот `subject`, `lighting`, `instruments`, `mood` (у suno) — свободный текст.

---

## 4. Команда `generate` — неинтерактивная сборка

Основная рабочая команда. Флаги:

| Флаг | Назначение |
|------|-----------|
| `-t, --type <type>` | **обязательный** — тип: `image`, `code`, `text`, `video`, `music` |
| `-p, --platform <platform>` | платформа/шаблон: `midjourney`, `stable-diffusion`, `dalle`, `runway`, … |
| `-s, --subject <text>` | сюжет/объект/задача — главный слот |
| `--style <text>` | стиль (слот `style`) |
| `--param <k=v>` | слот или параметр `ключ=значение` (можно повторять) |
| `--negative` | включить негативный блок шаблона |
| `--out <file>` | записать в файл (UTF-8, каталоги создаются сами) |
| `--copy` | скопировать в буфер обмена |
| `--json` | машинный вывод `{prompt, negative?, template, type, platform}` |
| `--stdin` | прочитать subject из stdin (для пайпов) |
| `--refine` | доработать через LLM (нужен ключ; без ключа — предупреждение + локальный промт) |

### Когда `--platform` можно не указывать

Если у типа **одна** уникальная платформа — она выбирается автоматически:

```powershell
# code → единственная платформа «Generic LLM», выбирается сама
promptwizard generate --type code --subject "REST API на FastAPI"
```

Если платформ несколько (например, `image`) — нужно указать `--platform`, иначе получите подсказку:

```
Ошибка: Для типа "image" доступно несколько платформ: DALL-E, Midjourney, Stable Diffusion. Укажите --platform.
```

### Пример: Midjourney с негативом

```powershell
promptwizard generate `
  --type image --platform midjourney `
  --subject "a lone lighthouse on a cliff" `
  --style "oil painting" `
  --param lighting="golden hour" `
  --param camera="aerial view" `
  --negative
```

**Вывод:**
```
a lone lighthouse on a cliff, oil painting, golden hour, aerial view --ar 16:9 --v 6.1 --stylize 100 --chaos 0 --no blurry, low quality, watermark, deformed hands, extra fingers, unreadable text
```

### Пример: Stable Diffusion с негативным блоком

```powershell
promptwizard generate `
  --type image --platform stable-diffusion `
  --subject "cyberpunk city street in the rain" `
  --style cyberpunk `
  --param details="wet asphalt reflections" `
  --negative
```

**Вывод** (SD-формат с блоком `Negative prompt:` и строкой `Steps/Sampler/CFG/Seed`):
```
Negative prompt: blurry, low quality, watermark, deformed, bad anatomy, extra limbs, extra fingers, text, signature, logo, ugly, tiling, out of frame, cropped, lowres, jpeg artifacts

cyberpunk city street in the rain, cyberpunk, wet asphalt reflections, cyberpunk, neon-drenched, futuristic city, moody atmosphere
Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: -1
```

### Как работают `--param`

Значение `--param key=value` умный:
- если `key` — это **слот** шаблона (например `lighting`, `camera`) → заполняет слот;
- иначе → становится **параметром** (например `ar=2:1` → `--ar 2:1` в Midjourney).

```powershell
# aspect/version/stylize — это слоты с param-привязкой в Midjourney-шаблоне
promptwizard generate --type image --platform midjourney `
  --subject "cyberpunk city" --style cinematic `
  --param aspect=21:9 --param version=7 --param stylize=750
```

### Переопределение дефолтов

Дефолты подставляются всегда, но их легко перебить через `--param`:

```powershell
# по умолчанию --ar 16:9, здесь — 9:16 (вертикальный формат)
promptwizard generate --type image --platform midjourney --subject "portrait of a warrior" --param aspect=9:16
```

### Комбинация `--json`

```powershell
promptwizard generate --type text --subject "Why Rust is fast" --json
```

В `stdout` — чистый JSON (удобно парсить), предупреждения идут в `stderr`.

---

## 5. Команда `interactive` — пошаговый мастер

Если не помните флаги — запустите мастер:

```powershell
promptwizard interactive
```

Мастер проведёт по шагам:

1. **Выбор типа** промта (`image` / `code` / `text` / `video` / `music`);
2. **Выбор платформы/шаблона**;
3. **Заполнение слотов** — по одному вопросу на каждый слот (с подсказками и вариантами для enum-слотов);
4. **Предпросмотр** собранного промта;
5. **Действие**: скопировать в буфер / сохранить в файл / вернуться.

> **Важно.** Мастер работает только в настоящем терминале (TTY). Если запустить его в пайпе
> (`echo x | promptwizard interactive`), он корректно откажется с подсказкой
> «используйте generate с флагами» — без зависания.

Отмена в любой момент — `Ctrl+C` (выход без «простыни» stack trace).

---

## 6. Команды `list-types` и `list-templates`

### `list-types` — каталог типов и платформ

```powershell
promptwizard list-types
```

```
ТИП    ПЛАТФОРМЫ                       ШАБЛОНОВ
image  DALL-E, Midjourney, Stable Diffusion  3
code   Generic LLM                     3
text   Generic LLM                     3
video  Runway, Sora-like               2
music  Generic LLM, Suno               2
```

Машинный формат: `promptwizard list-types --json`.

### `list-templates` — шаблоны (все или одного типа)

```powershell
promptwizard list-templates            # все шаблоны, сгруппированные по типам
promptwizard list-templates image      # только image-шаблоны
promptwizard list-templates image --json   # полные JSON-описания (слоты, правила, примеры)
```

В таблице рядом с описанием перечислены слоты; `subject*` — значит **обязательный**.

Полезный трюк — узнать все слоты конкретного шаблона:

```powershell
promptwizard list-templates video --json | ConvertFrom-Json | Where-Object id -eq runway | Select-Object -ExpandProperty slots | Format-Table key, required, type
```

---

## 7. Команда `doctor` — диагностика окружения

Запускайте, если что-то не работает или перед первым использованием:

```powershell
promptwizard doctor
```

Проверяет:
- версию Node.js (нужна ≥ 20);
- найденный файл конфигурации;
- наличие LLM-ключа и провайдера (не ошибка, если нет — «автономный режим работает»);
- **целостность базы шаблонов** (все ли JSON валидны, сколько их);
- наличие ассетов в `dist/`;
- доступность буфера обмена.

Здоровый вывод заканчивается строкой `Всё в порядке: автономный режим работает.` и `exit 0`.

---

## 8. Команда `config` — настройка

Используется **только** для LLM-интеграции (`refine` / `--refine`). Для обычной работы с шаблонами конфиг не нужен.

### `config init` — создать файл конфигурации

```powershell
promptwizard config init
```

Создаёт `.promptwizardrc.json` в текущем каталоге.

### `config set` — задать значение

```powershell
promptwizard config set llm.provider anthropic
promptwizard config set llm.model claude-3-5-sonnet-latest
promptwizard config set llm.apiKey sk-ant-...
promptwizard config set llm.baseUrl https://api.openai.com/v1
```

Доступные ключи: `llm.provider`, `llm.apiKey`, `llm.baseUrl`, `llm.model`.

### `config show` — показать эффективную конфигурацию

```powershell
promptwizard config show
```

Ключ **всегда маскируется** (`sk-***`) — он не утекает ни в вывод, ни в логи.

### Приоритет источников

```
env-переменные  >  rc-файл  >  дефолты
```

Env-переменные:

| Переменная | Что задаёт |
|------------|-----------|
| `PROMPTWIZARD_LLM_API_KEY` | API-ключ |
| `PROMPTWIZARD_LLM_PROVIDER` | `openai` или `anthropic` |
| `PROMPTWIZARD_LLM_BASE_URL` | base URL (для прокси / локальных серверов) |
| `PROMPTWIZARD_LLM_MODEL` | имя модели |

Поддерживаемые файлы конфигурации: `.promptwizardrc.json`, `.promptwizardrc.yaml`, ключ `promptwizard` в `package.json`.

---

## 9. Команда `refine` — LLM-доработка (нужен ключ)

`refine` — **единственная** команда, требующая API-ключ. Она берёт готовый промт и улучшает его через LLM.

### Способы передать текст

```powershell
# 1. Прямо в флаге
promptwizard refine --text "cyberpunk city, cinematic"

# 2. Из файла
promptwizard refine --in .\prompt.txt

# 3. Из пайпа
Get-Content .\prompt.txt | promptwizard refine
```

### Цель доработки

```powershell
promptwizard refine --in .\prompt.txt --goal "make it more cinematic and add camera details" --copy
```

### Куда сохранить результат

```powershell
promptwizard refine --in .\raw.txt --out .\refined.txt
promptwizard refine --in .\raw.txt --copy
promptwizard refine --in .\raw.txt --json
```

### Без ключа — понятная ошибка

```powershell
promptwizard refine --text "some prompt"
# Ошибка: LLM не настроен: задайте PROMPTWIZARD_LLM_API_KEY или задайте ключ через config set llm.apiKey <ключ> ...
# exit ≠ 0
```

Это ожидаемо: `refine` не может работать автономно. Но `generate` — может, поэтому для автономной работы просто не используйте `refine`.

### `--refine` внутри `generate`

```powershell
promptwizard generate --type image --platform midjourney --subject "cyberpunk city" --refine
```

Поведение:
- **есть ключ** → промт проходит LLM-доработку;
- **нет ключа / нет сети** → предупреждение в `stderr` + всё равно выдаётся **локальный** промт, `exit 0`.

Это гарантия автономности: `generate` никогда не «падает» из-за LLM.

---

## 10. Сценарии по типам промтов

### Изображения

```powershell
# Midjourney — вертикальный портрет с высоким stylize
promptwizard generate --type image --platform midjourney `
  --subject "portrait of a samurai, rain" --style "film noir" `
  --param aspect=9:16 --param stylize=750 --negative

# DALL-E 3 — естественный язык (mood/composition — enum-слоты!)
promptwizard generate --type image --platform dalle `
  --subject "a cozy reading nook by a rainy window" `
  --param mood=serene --param composition="rule of thirds" --param style=watercolor

# Stable Diffusion — фотореализм
promptwizard generate --type image --platform stable-diffusion `
  --subject "an elderly watchmaker at his bench" --style photorealistic --negative
```

### Код

```powershell
# Написать код
promptwizard generate --type code --platform generic-llm `
  --subject "REST API для блога с аутентификацией JWT" `
  --param language=TypeScript --param framework="Fastify + Prisma"

# Ревью кода (слот code — основной)
promptwizard generate --type code --platform review `
  --param code="$(Get-Content .\src\app.ts -Raw)" `
  --param language=TypeScript --param focus=performance

# Рефакторинг
promptwizard generate --type code --platform refactor `
  --param code="$(Get-Content .\legacy.js -Raw)" `
  --param goal="перевести на async/await"
```

> **Совет.** Для многострочного содержимого (код, тексты) удобнее пайп + `--stdin`:
> `Get-Content .\legacy.js -Raw | promptwizard generate --type code --platform refactor --stdin`

### Тексты

```powershell
# Статья
promptwizard generate --type text --platform article `
  --subject "Полное руководство по Rust async" `
  --param audience="backend-разработчики" --param tone="дружелюбный, но технический" `
  --param wordcount=2000 --param keywords="tokio, async, await"

# Копирайтинг под площадку
promptwizard generate --type text --platform copywriting `
  --subject "Смарт-часы Chrono X" --param platform=landing `
  --param usp="14 дней без зарядки" --param cta="Заказать со скидкой 20%"

# Рерайт
Get-Content .\draft.txt -Raw | promptwizard generate --type text --platform rewrite --stdin `
  --param goal=упростить --param tone=разговорный
```

### Видео

```powershell
# Runway — кинематографичная сцена
promptwizard generate --type video --platform runway `
  --subject "a lone traveller with a worn backpack" --param action="stops and looks at the horizon" `
  --param scene="endless salt desert at dusk" --param shot="wide shot" `
  --param motion="slow push in" --param lighting="low golden sun" --param atmosphere="quiet hope"

# Sora-like — нарративное описание
promptwizard generate --type video --platform sora-like `
  --param narrative="Медленный облёт заснеженной деревни на рассвете" `
  --param camera="aerial orbit" --param style=cinematic
```

### Музыка

```powershell
# Suno — стиль + структура трека (tempo/vocals — enum-слоты!)
promptwizard generate --type music --platform suno `
  --subject "synthwave о ночной поездке" --param genre="synthwave, retrowave" `
  --param mood="nostalgic, energetic" --param tempo="upbeat 110-130 BPM" `
  --param instruments="analog synths, drum machine" --param vocals="male vocals"

# Generic — бриф для композитора
promptwizard generate --type music --platform generic `
  --subject "саундтрек к сцене погони" --param genre=orchestral --param tempo=fast
```

---

## 11. Интеграция со скриптами и пайпами

### Пайп в файл

```powershell
promptwizard generate --type image --platform midjourney --subject "cyberpunk city" > prompt.txt
```

### Пайп из файла (`--stdin`)

```powershell
Get-Content .\task.txt -Raw | promptwizard generate --type code --platform generic-llm --stdin
echo "REST API на FastAPI" | promptwizard generate --type code --stdin
```

### Машинный вывод `--json` в скриптах

```powershell
$result = promptwizard generate --type text --subject "Why Rust is fast" --json | ConvertFrom-Json
$result.prompt        # текст промта
$result.platform      # платформа
$result.template      # id шаблона
```

### Пакетная генерация (одна задача → несколько промтов)

```powershell
$subjects = @("neon samurai", "rainy tokyo alley", "cyberpunk market")
foreach ($s in $subjects) {
  promptwizard generate --type image --platform midjourney --subject $s --style cinematic --out ".\prompts\$($s -replace ' ','_').txt"
}
```

### Пайплайн «сборка → доработка»

```powershell
promptwizard generate --type image --platform midjourney --subject "cyberpunk city" --out raw.txt
promptwizard refine --in raw.txt --goal "add more atmospheric detail" --out refined.txt
```

---

## 12. Частые проблемы (FAQ)

### «Ошибка: Для типа "image" доступно несколько платформ»

У типа несколько платформ, укажите одну: `--platform midjourney` (или `dalle`, `stable-diffusion`).

### «Ошибка: Неизвестный тип промта "X"»

Опечатка в `--type`. Допустимые: `image, code, text, video, music`. Посмотреть список: `promptwizard list-types`.

### «Не заполнен обязательный слот "subject"»

Не передан главный слот. Передайте `--subject "..."` (или через `--param subject="..."`, или в интерактивном режиме).

### «Шаблон ссылается на неизвестный слот»

Обычно значит, что вы задали `--param` с ключом, которого нет в шаблоне. Посмотрите доступные слоты: `promptwizard list-templates <тип> --json`.

### «Слот "X": недопустимое значение "Y"»

Вы передали в **enum-слот** значение вне списка. Ошибка сразу перечисляет допустимые — скопируйте одно из них. Подробнее — см. раздел 3.

### «Ошибка: LLM не настроен…»

Это про `refine` (или `--refine`) — им нужен ключ. Задайте `PROMPTWIZARD_LLM_API_KEY` или через `config set llm.apiKey`. Для `generate` без `--refine` ключ **не нужен**.

### «Не задан текст промта»

`refine` вызван без источника. Укажите `--text`, `--in <файл>` или передайте текст через пайп.

### Не работает `--copy`

Проверьте буфер: `promptwizard doctor` (строка «Буфер обмена»). На Windows используется PowerShell `Set-Clipboard`. Если запускаете из headless-среды (CI, SSH без сессии) — буфер может быть недоступен; используйте `--out`.

### Кракозябры в старом терминале Windows

Обновите Windows Terminal либо переключите кодировку консоли:
```powershell
chcp 65001
```

### Хочу увидеть подробный stack trace

```powershell
$env:PROMPTWIZARD_DEBUG=1
promptwizard generate --type image --subject x
```

---

## 13. Шпаргалка

```powershell
# Диагностика
promptwizard doctor
promptwizard --version

# Каталог
promptwizard list-types
promptwizard list-templates [type] [--json]

# Сборка промта (автономно, без ключа)
promptwizard generate -t <type> [-p <platform>] [-s <subject>] [--style <s>]
                      [--param k=v ...] [--negative] [--out <file>] [--copy] [--json]
                      [--stdin] [--refine]

# Мастер
promptwizard interactive

# LLM-доработка (нужен ключ)
promptwizard refine [--text <t>] [--in <file>] [--stdin] [--goal <g>] [--out <f>] [--copy] [--json]

# Конфигурация
promptwizard config init
promptwizard config set <key> <value>
promptwizard config show [--json]
```

### Мини-примеры

```powershell
# Изображение (Midjourney, в буфер)
promptwizard generate -t image -p midjourney -s "neon samurai" --style cinematic --copy

# Код (платформа выбирается сама)
promptwizard generate -t code -s "REST API на FastAPI" --out api.md

# Видео (Runway)
promptwizard generate -t video -p runway -s "lone traveller" --param scene="salt desert" --param shot="wide shot"

# Из пайпа
Get-Content task.txt -Raw | promptwizard generate -t text --stdin --out prompt.txt
```

---

## Что дальше

- **Добавить свой шаблон** — просто создайте новый JSON в `src/templates/<тип>/` по образцу существующих и пересоберите (`npm run build`). Код менять не нужно.
- **Проверить валидность базы** — `promptwizard doctor` покажет, если какой-то JSON «сломан».
- **Расширить LLM-сценарии** — настройте `llm.provider`, `llm.model`, `llm.baseUrl` под свой провайдер/прокси.

Приятной сборки промтов! 🧙
