import { app, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {
  OnzloadCapabilities,
  OnzloadLoginConfig,
  OnzloadSessionState,
  OnzloadUser,
} from '../../shared/types';

export interface StoredOnzloadSession {
  baseUrl: string;
  accessToken: string;
  expiresAt: string;
  user: OnzloadUser;
  capabilities: OnzloadCapabilities | null;
}

interface TokenResponse {
  accessToken: string;
  expiresAt: string;
  user: OnzloadUser;
}

interface MeResponse {
  user: OnzloadUser;
  capabilities: OnzloadCapabilities;
}

let loginActive = false;

function sessionPath() {
  return path.join(app.getPath('userData'), 'onzload-session.bin');
}

export function normalizeOnzloadBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Địa chỉ OnzLoad không hợp lệ.');
  }
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isLoopback && parsed.protocol === 'http:')) {
    throw new Error('OnzLoad phải dùng HTTPS; HTTP chỉ được phép cho localhost khi phát triển.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Địa chỉ OnzLoad không được chứa thông tin đăng nhập hoặc query.');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Hệ điều hành chưa sẵn sàng để mã hóa token OnzLoad.');
  }
}

export async function readOnzloadSession(): Promise<StoredOnzloadSession | null> {
  try {
    assertEncryptionAvailable();
    const encrypted = await readFile(sessionPath());
    const session = JSON.parse(safeStorage.decryptString(encrypted)) as StoredOnzloadSession;
    if (
      !session.accessToken ||
      !session.baseUrl ||
      !session.user?.id ||
      !session.expiresAt ||
      new Date(session.expiresAt) <= new Date()
    ) {
      await clearOnzloadSession();
      return null;
    }
    session.baseUrl = normalizeOnzloadBaseUrl(session.baseUrl);
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await clearOnzloadSession();
    }
    return null;
  }
}

async function saveOnzloadSession(session: StoredOnzloadSession) {
  assertEncryptionAvailable();
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  await writeFile(sessionPath(), encrypted, { mode: 0o600 });
}

export async function clearOnzloadSession() {
  await rm(sessionPath(), { force: true });
}

function stateFor(session: StoredOnzloadSession | null, message: string): OnzloadSessionState {
  return {
    connected: Boolean(session),
    baseUrl: session?.baseUrl ?? null,
    expiresAt: session?.expiresAt ?? null,
    user: session?.user ?? null,
    capabilities: session?.capabilities ?? null,
    message,
  };
}

async function apiRequest<T>(
  baseUrl: string,
  pathname: string,
  init: RequestInit,
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `OnzLoad trả về HTTP ${response.status}.`);
  return payload;
}

export async function getOnzloadSessionState(refresh = true): Promise<OnzloadSessionState> {
  const session = await readOnzloadSession();
  if (!session) return stateFor(null, 'Chưa liên kết tài khoản OnzLoad.');
  if (!refresh) return stateFor(session, 'Đã liên kết OnzLoad.');

  try {
    const me = await apiRequest<MeResponse>(session.baseUrl, '/api/desktop/v1/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const refreshed = { ...session, user: me.user, capabilities: me.capabilities };
    await saveOnzloadSession(refreshed);
    return stateFor(refreshed, 'OnzLoad đã sẵn sàng nhận HLS.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/phiên đăng nhập|đăng nhập ứng dụng|HTTP 401/i.test(message)) {
      await clearOnzloadSession();
      return stateFor(null, 'Phiên OnzLoad đã hết hạn. Vui lòng liên kết lại.');
    }
    return stateFor(session, `Đang dùng phiên đã lưu; chưa kiểm tra được máy chủ: ${message}`);
  }
}

function waitForLoopbackCallback(server: ReturnType<typeof createServer>, expectedState: string) {
  return new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Đăng nhập OnzLoad đã hết thời gian chờ.')), 5 * 60 * 1000);
    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== '/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      const code = requestUrl.searchParams.get('code') ?? '';
      const state = requestUrl.searchParams.get('state') ?? '';
      const authError = requestUrl.searchParams.get('error');
      response.writeHead(authError || !code || state !== expectedState ? 400 : 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(authError || !code || state !== expectedState
        ? '<!doctype html><title>OnzLoad</title><h2>Không thể liên kết ứng dụng.</h2>'
        : '<!doctype html><title>OnzLoad</title><h2>Đã liên kết OnzLoad Encoder.</h2><p>Bạn có thể đóng cửa sổ này và quay lại ứng dụng.</p>');
      clearTimeout(timer);
      if (authError || !code || state !== expectedState) {
        reject(new Error('Phản hồi đăng nhập OnzLoad không hợp lệ.'));
      } else {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Không xác định được callback đăng nhập.'));
          return;
        }
        resolve({ code, redirectUri: `http://127.0.0.1:${address.port}/callback` });
      }
    });
  });
}

export async function loginOnzload(config: OnzloadLoginConfig): Promise<OnzloadSessionState> {
  if (loginActive) throw new Error('Một cửa sổ đăng nhập OnzLoad đang mở.');
  loginActive = true;
  const server = createServer();
  try {
    const baseUrl = normalizeOnzloadBaseUrl(config.baseUrl);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Không thể mở callback đăng nhập.');
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const authorizeUrl = new URL(`${baseUrl}/desktop/authorize`);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('device_name', os.hostname().slice(0, 120));
    authorizeUrl.searchParams.set('platform', `${process.platform}-${process.arch}`);
    authorizeUrl.searchParams.set('app_version', app.getVersion());

    const callback = waitForLoopbackCallback(server, state);
    await shell.openExternal(authorizeUrl.toString());
    const result = await callback;
    const token = await apiRequest<TokenResponse>(baseUrl, '/api/desktop/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: result.code, codeVerifier: verifier, redirectUri: result.redirectUri }),
    });
    const session: StoredOnzloadSession = {
      baseUrl,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      user: token.user,
      capabilities: null,
    };
    await saveOnzloadSession(session);
    return getOnzloadSessionState(true);
  } finally {
    loginActive = false;
    server.close();
  }
}

export async function logoutOnzload(): Promise<OnzloadSessionState> {
  const session = await readOnzloadSession();
  if (session) {
    await apiRequest(session.baseUrl, '/api/desktop/v1/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }).catch(() => undefined);
  }
  await clearOnzloadSession();
  return stateFor(null, 'Đã ngắt liên kết OnzLoad trên máy này.');
}

export async function onzloadApiRequest<T>(pathname: string, init: RequestInit = {}) {
  const session = await readOnzloadSession();
  if (!session) throw new Error('Vui lòng liên kết tài khoản OnzLoad trước.');
  try {
    return await apiRequest<T>(session.baseUrl, pathname, {
      ...init,
      headers: { Authorization: `Bearer ${session.accessToken}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(2 * 60 * 1000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/phiên đăng nhập|đăng nhập ứng dụng|HTTP 401/i.test(message)) await clearOnzloadSession();
    throw error;
  }
}
