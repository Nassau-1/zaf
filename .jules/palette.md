## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.
## 2025-02-12 - Converting Non-Semantic Elements to Buttons
**Learning:** Found elements acting as buttons (like `.tab-close`) implemented as `<span>` tags without `aria-label`s. Even when adding `focus-visible`, a screen reader won't read it out as an actionable item without the correct role.
**Action:** When adding focus states to interactive elements, check if they use semantic HTML (e.g. `<button>`). If not, convert them to `<button>` elements with proper CSS resets (`border: none`, `background: transparent`, `font-family: inherit`) and provide an `aria-label` for screen reader accessibility.
