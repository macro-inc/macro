/** Which store a phone browser installs the app from. iOS when unsure. */
export function phoneStorePlatform(userAgent: string): 'ios' | 'android' {
  return /\bAndroid\b/i.test(userAgent) ? 'android' : 'ios';
}
