## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2026-06-29 - Unlabeled Filter Selects
**Learning:** Filter dropdowns and search inputs in modals and sidebars relied solely on placeholders or nearby text, making them inaccessible for screen readers to identify their purpose.
**Action:** Always add aria-label attributes to <select> and <input> elements that lack explicit, associated <label> tags.
