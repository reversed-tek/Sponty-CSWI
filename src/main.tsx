import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { configured, supabase } from './lib';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
async function boot() {
  if (location.pathname === '/auth/start') {
    const raw = new URLSearchParams(location.search).get('target');
    try {
      const url = new URL(raw || '');
      const allowed = new URL(import.meta.env.VITE_SUPABASE_URL);
      if (url.origin !== allowed.origin || !url.pathname.startsWith('/auth/v1/authorize')) throw new Error('Invalid authentication destination');
      location.replace(url.toString());
    } catch {root.render(<div className="notice">Invalid sign-in URL.</div>);}
    return;
  }
  if (location.pathname === '/auth/callback') {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {root.render(<p className="notice">Sign-in failed. Close this window and try again.</p>);return;}
    if (typeof Office !== 'undefined') {
      try {
        await Office.onReady();
        Office.context.ui.messageParent(JSON.stringify({
          type: 'cswi-login', access_token: data.session.access_token, refresh_token: data.session.refresh_token
        }));
        root.render(<p className="notice">Signed in. You can close this window.</p>);
        return;
      } catch { /* Browser fallback below. */ }
    }
    location.replace('/');
    return;
  }
  root.render(<React.StrictMode><App configured={configured}/></React.StrictMode>);
}
void boot();
