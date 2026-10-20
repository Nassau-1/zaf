## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-20 - Semantic Button Conversion
**Learning:** When converting non-semantic elements (like `<span>`) acting as buttons to semantic `<button>` elements for accessibility, default browser button styles can break the layout if not explicitly reset.
**Action:** Always apply CSS resets (e.g., `background: transparent; border: none; font-family: inherit; font-size: inherit;`) when making these conversions, and ensure `aria-label` is added to icon-only buttons.
