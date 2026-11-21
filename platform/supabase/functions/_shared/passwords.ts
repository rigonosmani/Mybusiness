/** Password policy for accounts created/reset by administrators. */
export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "PASSWORD_REQUIRED";
  if (pw.length < 10 || pw.length > 72) return "PASSWORD_LENGTH";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "PASSWORD_COMPLEXITY";
  return null;
}

export function usernameToEmail(username: string, domain: string): string {
  return `${username.toLowerCase()}@${domain}`;
}
