## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-13 - Modal Focus & ARIA Labels
**Learning:** Dynamically injected modal close buttons and custom `.zaf-btn` buttons in the dashboard lack both explicit `aria-label`s and `.focus-visible` outline styles, which breaks screen reader and keyboard accessibility.
**Action:** Always map `:focus-visible` to custom button classes and include `aria-label` explicitly on icon-only buttons like "✕", even when generated via JavaScript string templates.
