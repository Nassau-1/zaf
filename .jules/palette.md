## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-05-31 - Icon-only buttons accessibility
**Learning:** Some utility buttons in the dashboard (like zoom controls, kill process, console toggles) were missing accessible ARIA labels despite having titles, causing issues for screen reader users when icon content or single characters were used (e.g. `−`, `+`, `⟲`, `✕`, `⏻`).
**Action:** Consistently ensure that all buttons with non-text or symbol-only content have explicit `aria-label` attributes for accessibility.
