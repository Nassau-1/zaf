## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-28 - Semantic Buttons for Accessibility
**Learning:** Found non-semantic `<span>` tags being used as clickable elements without keyboard accessibility or ARIA labels.
**Action:** Convert clickable `<span>` elements to semantic `<button>` elements with `aria-label` and `focus-visible` outline styles, using CSS resets (`background: transparent; border: none; font-family: inherit; font-size: inherit;`) to avoid layout changes.
