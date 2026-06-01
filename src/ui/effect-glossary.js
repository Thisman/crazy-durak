import { EFFECT_DEFINITIONS, isLegendaryEffect } from '../game/effects/index.js';

export function buildGlossary(listElement) {
  listElement.replaceChildren();

  const sorted = [...EFFECT_DEFINITIONS].sort((a, b) => {
    const la = isLegendaryEffect(a.id) ? 1 : 0;
    const lb = isLegendaryEffect(b.id) ? 1 : 0;
    if (lb !== la) return lb - la;
    return a.title.localeCompare(b.title, 'ru');
  });

  for (const effect of sorted) {
    const legendary = isLegendaryEffect(effect.id);
    const item = document.createElement('li');
    item.className = `glossary-item${legendary ? ' glossary-item-legendary' : ''}`;
    item.innerHTML = `
      <span class="glossary-icon"><i class="${effect.icon}" aria-hidden="true"></i></span>
      <div class="glossary-item-body">
        <strong class="glossary-item-title">${effect.title}</strong>
        <p class="glossary-item-desc">${effect.description}</p>
      </div>
    `;
    listElement.append(item);
  }
}
