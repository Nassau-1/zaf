## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2025-06-03 - Icon Button Accessibility
**Learning:** Dynamically generated icon-only buttons (like `✕` close buttons and `-`/`+` zoom buttons) often lack ARIA labels, making screen reader navigation difficult.
**Action:** Always ensure dynamically injected UI icon buttons include an `aria-label` matching their `title` or intent.
