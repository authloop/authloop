/** Selectors that identify password fields */
export const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
];

/** Selectors that identify OTP/code fields */
export const OTP_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[name*="code" i]:not([name*="country"]):not([name*="zip"]):not([name*="postal"])',
  'input[name*="verification" i]',
  'input[name*="token" i]:not([type="hidden"])',
  'input[id*="otp" i]',
  'input[id*="code" i]:not([name*="country"])',
  'input[placeholder*="otp" i]',
  'input[placeholder*="code" i]',
  'input[placeholder*="verification" i]',
  // Numeric inputs on login pages (common OTP pattern)
  'input[type="tel"][maxlength="1"]',
  'input[type="number"][maxlength="1"]',
  'input[inputmode="numeric"][maxlength="6"]',
  'input[inputmode="numeric"][maxlength="4"]',
];

/** Selectors that identify visual challenges (-> viewport mode) */
export const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'div[id*="turnstile"]',
  'div[class*="captcha" i]',
  'div[id*="captcha" i]',
  'iframe[src*="captcha"]',
  'div[class*="challenge" i]',
];

/** Selectors for username/email fields (paired with password) */
export const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[name*="email" i]',
  'input[name*="username" i]',
  'input[name*="login" i]',
  'input[name*="user" i]:not([type="hidden"])',
  'input[id*="email" i]',
  'input[id*="username" i]',
];

/** Selectors for submit buttons */
export const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:not([type="button"]):not([type="reset"])',
];

/** Selectors for security question fields */
export const SECURITY_QUESTION_SELECTORS = [
  'input[name*="answer" i]',
  'input[name*="security" i]',
  'input[id*="answer" i]',
  'input[id*="security" i]',
];
