import type { User } from '../types/trip';

const TOKEN_KEY = 'hokkaido_token';
const USER_KEY = 'hokkaido_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function saveAuth(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function postAuth(path: string, username: string, password: string, fallback: string) {
  let data: { error?: string; token?: string; user?: User } = {};
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error(fallback);
  }
  try {
    data = await res.json();
  } catch {
    throw new Error(data.error || fallback);
  }
  if (!res.ok || !data.token || !data.user) throw new Error(data.error || fallback);
  return { token: data.token, user: data.user };
}

export function loginRequest(username: string, password: string) {
  return postAuth('/api/login', username, password, '登入失敗，請稍後再試');
}

export function registerRequest(username: string, password: string) {
  return postAuth('/api/register', username, password, '註冊失敗，請稍後再試');
}
