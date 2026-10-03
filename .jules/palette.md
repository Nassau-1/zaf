## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2023-10-27 - Icon-only buttons accessibility
**Learning:** Icon-only buttons with simple text nodes (like '+', '-', '⟲') often lack intrinsic meaning for screen readers. Using the 'title' attribute alone is sometimes insufficient for comprehensive accessibility support.
**Action:** Always ensure that icon-only buttons include an 'aria-label' attribute alongside any visual tooltips (like 'title') to explicitly declare their purpose to assistive technologies.
