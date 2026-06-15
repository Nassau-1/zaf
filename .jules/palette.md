## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-05-31 - Missing focus states and ARIA labels on custom components
**Learning:** Custom UI components like `.zaf-btn` and `.zaf-launch-close` lacked `:focus-visible` styles, and icon-only zoom buttons lacked `aria-label` attributes, impacting keyboard and screen reader accessibility.
**Action:** Consistently include `:focus-visible` states for all new interactive classes, and explicitly add `aria-label` attributes to any icon-only buttons to support screen readers.
