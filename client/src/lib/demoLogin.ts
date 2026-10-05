/** Dev prefill. Production builds leave the login form blank and hide demo credentials. */
export function demoLoginFields(production: boolean) {
  if (production) return { username: '', password: '', showDemoCredentials: false };
  return { username: 'alice', password: 'demo1234', showDemoCredentials: true };
}
