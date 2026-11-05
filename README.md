# LT Agency

Сайт агентства. Документация — в [DOKUMENTACIJA.md](DOKUMENTACIJA.md).

**Сайт лежит и в корне, и в `docs/`** — чтобы работал при любой настройке
GitHub Pages (`/ (root)` или `/docs`), поэтому в корне есть `index.html`.

- Исходники: `src/` (markdown), генератор `build.mjs`, анализатор `tools/`
- Пересборка для хостинга: `node build.mjs`, залить `dist/`
