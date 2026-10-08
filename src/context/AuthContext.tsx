import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GlpiClient } from '../api/glpiClient';
import type { ConnectionConfig } from '../types/glpi';
import { secureDelete, secureGet, secureSet, toSecureString } from '../secureStorage';
import { cache } from '../cache';
import { diag } from '../diagnostics';

type AuthState = {
  loading: boolean;
  /** True after one-time server URL + App-Token have been saved */
  serverConfigured: boolean;
  isAuthenticated: boolean;
  loginName: string | null;
  userId: number | null;
  userPicture: string | null;
  realName: string | null;
  client: GlpiClient | null;
  config: ConnectionConfig;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** One-time (or admin reset) server setup */
  saveServerConfig: (baseUrl: string, appToken: string) => Promise<void>;
  clearServerConfig: () => Promise<void>;
  updateConfig: (cfg: Partial<ConnectionConfig>) => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const KEYS = {
  session: 'mm_session_token',
  login: 'mm_login',
  baseUrl: 'mm_base_url',
  appToken: 'mm_app_token',
  configured: 'mm_server_configured',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loginName, setLoginName] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [userPicture, setUserPicture] = useState<string | null>(null);
  const [realName, setRealName] = useState<string | null>(null);
  const [config, setConfig] = useState<ConnectionConfig>({
    baseUrl: '',
    appToken: '',
  });

  const client = useMemo(() => {
    const c = new GlpiClient(config);
    if (sessionToken) c.setSessionToken(sessionToken);
    return c;
  }, [config, sessionToken]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const [token, login, baseUrl, appToken, configured] = await Promise.all([
          secureGet(KEYS.session),
          secureGet(KEYS.login),
          secureGet(KEYS.baseUrl),
          secureGet(KEYS.appToken),
          secureGet(KEYS.configured),
        ]);
        if (cancelled) return;
        const hasServer =
          configured === '1' &&
          !!baseUrl &&
          baseUrl.startsWith('http') &&
          !!appToken &&
          appToken.length > 8;
        if (hasServer) {
          setConfig({
            baseUrl: baseUrl!.replace(/\/+$/, ''),
            appToken: appToken || '',
          });
          setServerConfigured(true);
        }
        if (token && hasServer) {
          setSessionToken(token);
          setLoginName(login);
        }
      } catch {
        /* first launch / SecureStore unavailable */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void boot();
    // Absolute safety: never spin forever
    const force = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(force);
    };
  }, []);

  useEffect(() => {
    if (!loading && sessionToken && serverConfigured) {
      const c = new GlpiClient(config);
      c.setSessionToken(sessionToken);
      c.getCurrentUserProfile()
        .then((profile) => {
          if (profile.id) setUserId(profile.id);
          if (profile.realname) setRealName(profile.realname);
          if (profile.pictureDataUri) setUserPicture(profile.pictureDataUri);
        })
        .catch(() => undefined);
    }
  }, [loading, sessionToken, serverConfigured]);

  const saveServerConfig = useCallback(async (baseUrl: string, appToken: string) => {
    const url = baseUrl.trim().replace(/\/+$/, '');
    const token = appToken.trim();
    if (!url.startsWith('http')) {
      throw new Error('Server URL must start with https:// or http://');
    }
    if (!token || token.length < 8) {
      throw new Error('App-Token is required');
    }
    await secureSet(KEYS.baseUrl, url);
    await secureSet(KEYS.appToken, token);
    await secureSet(KEYS.configured, '1');
    setConfig({ baseUrl: url, appToken: token });
    setServerConfigured(true);
  }, []);

  const clearServerConfig = useCallback(async () => {
    try {
      await client.killSession();
    } catch {
      /* ignore */
    }
    setSessionToken(null);
    setLoginName(null);
    setUserId(null);
    setUserPicture(null);
    setRealName(null);
    setServerConfigured(false);
    cache.clear();
    diag.clear();
    setConfig({ baseUrl: '', appToken: '' });
    await secureDelete(KEYS.session);
    await secureDelete(KEYS.login);
    await secureDelete(KEYS.baseUrl);
    await secureDelete(KEYS.appToken);
    await secureDelete(KEYS.configured);
  }, [client]);

  const signIn = useCallback(
    async (login: string, password: string) => {
      const storedUrl =
        (await secureGet(KEYS.baseUrl)) || config.baseUrl;
      const storedApp =
        (await secureGet(KEYS.appToken)) ?? config.appToken;
      if (!storedUrl || !storedApp) {
        throw new Error('Server is not configured. Complete setup first.');
      }
      const liveConfig = {
        baseUrl: String(storedUrl).replace(/\/+$/, ''),
        appToken: String(storedApp || ''),
      };
      setConfig(liveConfig);
      const c = new GlpiClient(liveConfig);
      const session = await c.initSession(login, password);
      // session_token must be a plain string — some servers nest or return non-string
      const rawToken =
        (session as { session_token?: unknown })?.session_token ??
        (session as { sessionToken?: unknown })?.sessionToken ??
        (session as Record<string, unknown>)?.['session_token'];
      const tokenStr = toSecureString(rawToken);
      if (!tokenStr) {
        throw new Error(
          'Login succeeded but no session token was returned. Check App-Token and API URL on this server.'
        );
      }
      setSessionToken(tokenStr);
      setLoginName(login);
      await secureSet(KEYS.session, tokenStr);
      await secureSet(KEYS.login, login);
      try {
        const profile = await c.getCurrentUserProfile();
        setUserId(profile.id);
        setRealName(profile.realname || login);
        if (profile.pictureDataUri) setUserPicture(profile.pictureDataUri);
        else setUserPicture(null);
      } catch {
        setUserId(null);
        setRealName(login);
        setUserPicture(null);
      }
    },
    [config]
  );

  const signOut = useCallback(async () => {
    try {
      await client.killSession();
    } catch {
      /* ignore */
    }
    setSessionToken(null);
    setLoginName(null);
    setUserId(null);
    setUserPicture(null);
    setRealName(null);
    cache.clear(); // no ticket data stays on the phone after sign-out
    diag.clear();
    await secureDelete(KEYS.session);
  }, [client]);

  const updateConfig = useCallback(async (partial: Partial<ConnectionConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      void secureSet(KEYS.baseUrl, next.baseUrl);
      void secureSet(KEYS.appToken, next.appToken || '');
      return next;
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!sessionToken) return;
    const c = new GlpiClient(config);
    c.setSessionToken(sessionToken);
    try {
      const profile = await c.getCurrentUserProfile();
      setUserId(profile.id);
      if (profile.realname) setRealName(profile.realname);
      setUserPicture(profile.pictureDataUri || null);
    } catch {
      /* ignore */
    }
  }, [sessionToken, config]);

  const value: AuthState = {
    loading,
    serverConfigured,
    isAuthenticated: !!sessionToken,
    loginName,
    userId,
    userPicture,
    realName,
    client: sessionToken ? client : null,
    config,
    signIn,
    signOut,
    saveServerConfig,
    clearServerConfig,
    updateConfig,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
