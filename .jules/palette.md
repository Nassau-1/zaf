## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2025-02-15 - Add aria-labels to zoom controls
**Learning:** Icon-only buttons with just a `title` attribute are not fully accessible to all screen readers. Providing an explicit `aria-label` ensures the action is properly announced to visually impaired users navigating via keyboard or assistive technologies.
**Action:** Always include an `aria-label` on icon-only buttons (like `+`, `-`, `⟲`) in addition to a visible `title` tooltip.
