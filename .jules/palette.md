## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2023-10-25 - Provide aria-labels for symbol-only utility buttons
**Learning:** The ZAF Control Plane uses unicode characters like "−", "+", and "⟲" for zoom controls. These symbols are often ignored or mispronounced by screen readers, rendering the controls inaccessible to users relying on assistive technologies.
**Action:** Always add explicit, descriptive `aria-label` attributes to symbol-only or icon-only buttons to guarantee screen reader accessibility.
