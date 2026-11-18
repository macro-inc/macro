/** Keep the 24px property face while reserving a separate 44px touch target. */
export const contactPropertyTouchTarget =
  "touch:min-h-6 touch:min-w-11 touch:my-2.5 touch:before:absolute touch:before:-inset-x-px touch:before:top-1/2 touch:before:h-11 touch:before:-translate-y-1/2 touch:before:content-['']";

/** Icon-only navigation also reserves horizontal space for its touch target. */
export const contactPropertyIconTouchTarget =
  "touch:size-6 touch:min-h-6 touch:min-w-6 touch:m-2.5 touch:before:absolute touch:before:left-1/2 touch:before:top-1/2 touch:before:size-11 touch:before:-translate-x-1/2 touch:before:-translate-y-1/2 touch:before:content-['']";
