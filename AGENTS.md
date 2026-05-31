# Crazy Durak — правила для агентов

## Терминология

Используй эти термины последовательно во всём коде, комментариях, сообщениях событий и подсказках UI.

| Термин | Значение |
|---|---|
| **рука** | карты, которые держит игрок (не видны сопернику) |
| **стол** | карты, разыгранные в текущем бою |
| **атака / атакующий** | действие подкидывания карты; роль игрока, который атакует |
| **защита / защищающийся** | действие отбивания карты; роль игрока, который отбивается |
| **подкидывание** | добавление атакующей карты на стол после первой атаки |
| **перевод** | передача атаки сопернику картой того же ранга |
| **взятие** | защищающийся не может отбиться и берёт все карты со стола в руку |
| **бой** | один раунд: от первой атаки до взятия или отбоя (бой уходит в бито) |
| **колода** | карты, ещё не розданные в руки |
| **бито** | стопка карт, сыгранных в завершённых боях |

## Архитектура

```
src/
  game/         — чистая игровая логика (нет DOM, нет side-effects)
    rules.js    — canThrowIn, canBeat, canTransfer, getDropTargets и др.
    game.js     — DurakGame: методы хода, применение эффектов, переходы
    effects.js  — EFFECT_IDS, EFFECT_DEFINITIONS, EFFECT_APPLIERS
    session.js  — createEmptyState, cloneState, rebuildBattleEffectState
    turn-order.js — startNextBattle, swapRoles, shouldAiAct
    card-model.js — canCardBeatAttack, модель карты
  ui/
    drag.js     — DragController: pointer events, ghost, анимация возврата
    render.js   — GameRenderer: обновление DOM по состоянию
    transitions.js — очередь анимаций переходов карт
styles/
  main.css
index.html      — единственный HTML, без сборки
tests/
  rules.test.js — тесты на node:test, запускаются через `node --test`
```

## Ключевые паттерны

- **Состояние неизменяемо между ходами**: `game.js` мутирует `this.state`, но методы возвращают `{ ok, state }` — вызывающий код всегда проверяет `ok` перед применением.
- **Эффекты карт**: каждый эффект — объект в `EFFECT_DEFINITIONS` + функция в `EFFECT_APPLIERS`. Применяются через `applyCardEffect()` в `game.js`. Возвращают `{ applied, message, pulseIds, spawnedCard? }`.
- **`spawnedCard`**: если эффект порождает карту (например, Двойник), он возвращает `spawnedCard` в outcome — `game.js` сам создаёт слот и добавляет его на стол.
- **`rebuildBattleEffectState`**: вызывается при загрузке сохранения или undo — пересчитывает все флаги состояния (forcedAttackSuit, forbiddenDefenseSuits и др.) из карт на столе.
- **Drag ghost**: `position: fixed`, позиционируется через `transform: translate3d`. `.is-drag-source` скрывает оригинал через `visibility: hidden` — без изменения `transform`, чтобы не запускать CSS-переходы при восстановлении.
- **Анимации возврата**: WAAPI, `fill: 'forwards'`, без `animation.cancel()` — элемент удаляется из DOM, что автоматически отменяет анимацию.

## Правила

- Игровая логика (`src/game/`) не должна знать о DOM или UI.
- Новый эффект карты требует: запись в `EFFECT_IDS`, объект в `EFFECT_DEFINITIONS`, функцию-аплайер в `EFFECT_APPLIERS`, обработку в `rebuildBattleEffectState` если эффект влияет на состояние боя, тест в `rules.test.js`.
- Сообщения событий (`recordEvent`) и подсказки UI должны использовать терминологию из таблицы выше.
- Тесты: `node --test tests/rules.test.js`. Все тесты должны проходить после любых изменений в `src/game/`.
- Без сборки: проект запускается напрямую через `index.html` — никаких bundler-зависимостей в рантайме.
