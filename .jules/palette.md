## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-09-08 - Org Builder Zoom Controls Accessibility
**Learning:** The Org Builder zoom controls (`+`, `-`, `⟲`) were icon-only and completely lacked `aria-label`s, rendering them opaque to screen readers. Furthermore, `.zaf-btn` elements were missing `:focus-visible` styles entirely across the application.
**Action:** Always verify that every icon-only interaction target has a descriptive `aria-label`, and ensure the primary button classes (like `.zaf-btn`) explicitly define focus indicators in the global stylesheet.
