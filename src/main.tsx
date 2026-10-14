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
    if (typeof Office !== 'undefined' && typeof Office.onReady === 'function') {
      try {
        await Office.onReady();
        if (typeof Office.context?.ui?.messageParent === 'function') {
          // The Office dialog has a separate session store: explicitly return the
          // Supabase session to the Outlook task pane on the same HTTPS origin.
          Office.context.ui.messageParent(JSON.stringify({
            type: 'cswi-login', access_token: data.session.access_token, refresh_token: data.session.refresh_token
          }));
          root.render(<p className="notice">Signed in. Returning to Outlook…</p>);
          return;
        }
      } catch {
        // Never silently replace a failed Office-dialog callback with the full
        // portal; the task pane would stay signed out with no indication why.
        root.render(<p className="notice">Microsoft sign-in succeeded, but Outlook could not receive the session. Close this window and retry from the Sponty CSWI task pane.</p>);
        return;
      }
    }
    // Only standalone browser sign-ins should go to the web portal.
    location.replace('/');
    return;
  }
  root.render(<React.StrictMode><App configured={configured}/></React.StrictMode>);
}
void boot();
