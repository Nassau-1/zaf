## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.
## 2026-06-03 - Add ARIA Labels to Icon-Only Buttons
**Learning:** Found several icon-only buttons (like modal close buttons and zoom controls) missing `aria-label` attributes, making them inaccessible to screen readers.
**Action:** Always ensure that any button without visible text (e.g., using just an icon like '✕' or '+') has a descriptive `aria-label` for screen reader users.
