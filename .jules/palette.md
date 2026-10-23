## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-18 - Missing ARIA Labels on Canvas Zoom Controls
**Learning:** Found that the structural org-chart zoom buttons (`org-zoom-out`, `org-zoom-in`, `org-zoom-reset`) were symbol-only (`−`, `+`, `⟲`) and lacked `aria-label` attributes, making them inaccessible to screen readers. In addition, the `.zaf-btn` class was missing from the global `:focus-visible` list, breaking keyboard accessibility for these buttons.
**Action:** Always add `aria-label` attributes to icon/symbol-only buttons, and ensure the base button class (e.g., `.zaf-btn`) includes `:focus-visible` styles for keyboard navigation.
