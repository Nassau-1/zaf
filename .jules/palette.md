## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-15 - Add explicit ARIA labels to symbol-only buttons
**Learning:** Symbol-only buttons that rely solely on `title` attributes may not be reliably announced by all screen readers. Explicit `aria-label` attributes are necessary for accessibility.
**Action:** Always add explicit, descriptive `aria-label` attributes to symbol-only or icon-only buttons to ensure screen reader accessibility.
