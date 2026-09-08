## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-06-04 - Zoom Controls Accessibility
**Learning:** Icon-only zoom controls (`+`, `-`, `⟲`) lacked explicit ARIA labels, which can cause screen readers to miss their function despite having `title` attributes.
**Action:** Always add explicit `aria-label` attributes to icon-only buttons to ensure clear semantic meaning for assistive technologies.
