# Android -> webOS Parity Audit

## Scope snapshot
- Android UI screen/component files under `android/java/com/nuvio/tv/ui/screens`: `109`
- webOS UI screen files under `js/ui/screens`: `22`
- Current webOS routes: `splash, home, player, account, authQrSignIn, authSignIn, syncCode, profileSelection, detail, library, search, settings, plugin`

## Parity status (high level)
- `Auth + QR login`: **Mostly aligned**
  - QR session auth, start/poll/exchange flow and back handling are present.
  - Remaining gap: Android has richer account status/stat cards and tighter transition polish.
- `Home`: **Partial**
  - Sidebar + hero + rows + continue watching exist.
  - Missing/partial versus Android:
    - Classic/Modern/Grid behavior parity and full focus rules.
    - Some motion/transition semantics and section-level restoration logic.
- `Detail (movie/series)`: **Partial**
  - Android-like hero/actions/cast/ratings shell exists.
  - Stream chooser overlay exists and no longer auto-plays on Play.
  - Remaining gap:
    - Exact Android spacing/typography/focus choreography.
    - Full "More Like This", company logos, and cast detail navigation parity.
- `Player`: **Partial**
  - Core playback and overlays exist.
  - Missing many Android modules (display mode overlays, richer track dialogs/panels, runtime heuristics parity).
- `Settings`: **Partial**
  - Main shell exists.
  - Android has many dedicated screens/sections not yet split 1:1 (about/debug/layout/tmdb/trakt/playback sections).
- `Plugins/Addons`: **Partial**
  - Addon/plugin screens and sync plumbing exist.
  - Android UX depth (repository manager flows and phone-driven management UX) is still ahead.

## Backend/sync parity status
- `Profiles sync`: **Good baseline**
  - RPC + legacy fallback paths present.
- `Addons sync`: **Improved in webOS**
  - Remote-empty preservation now enforced to avoid accidental local wipe.
- `Plugins sync`: **Improved in webOS**
  - Remote-empty preservation and deterministic merge.
  - Fallback push now deletes scoped old rows before upsert to match Android "full replace" behavior.
- `Saved library sync`: **Improved in webOS**
  - Pull now merges local+remote with timestamp preference instead of blind replace.
- `Watched items sync`: **Improved in webOS**
  - Pull now merges local+remote (content/season/episode key) with timestamp preference.
- `Watch progress sync`: **Already aligned directionally**
  - Merge-first pull and safer fallback push were already in place.

## UI parity fixes applied in this pass
- Home focus now uses controlled scroll:
  - Card rows scroll only when focused card exits visible row bounds.
  - Vertical visibility is adjusted without causing sidebar drift.
- Home profile pill is now dynamic (active profile name + initial), not hardcoded.
- Sidebar structure was hardened (sticky/fixed behavior, centered nav block, improved profile pill positioning).
- Home cards resized to enforce TV-friendly density (about 5 visible cards before horizontal scroll).
- Stream chooser popup focus model hardened:
  - Deterministic `filter/card` cursor state.
  - `UP` from stream cards moves to previous card; jumps to filters only from top card.
  - Focus is preserved on filter changes/rerender.
- Stream chooser layout constrained further:
  - Hidden scrollbar treatment improved.
  - Long stream title/description clamped to prevent card blowout.
- Focus accent defaults changed to Android-like white baseline (`--focus-color`), with multi-accent options kept in settings.

## Remaining prioritized work to reach 1:1
1. Port missing Android screens/modules:
   - `cast/CastDetail`, `stream/StreamScreen`, `search/Discover`, `CatalogSeeAll`, split settings screens.
2. Rebuild settings as Android-equivalent sections (Account, Profiles, Appearance, Layout, Plugins, Integration, Playback, Trakt, About, Debug).
3. Complete player parity:
   - source/episode side panels, subtitle style/delay parity, display mode overlays, next-episode rules parity.
4. Finalize detail parity:
   - exact Android episode card metrics/focus restore, cast detail routing, company logos, "more like this" behavior.
5. Final home parity:
   - Classic/Modern/Grid behavior parity and Android-equivalent transitions/focus restore in all edge cases.
