/* Contextual Outlook actions. Never send email or create a calendar event silently. */
export type Mail = {
  id: string; subject: string; sender: string; preview: string;
  attachments: { id: string; name: string; size: number; attachmentType?: string }[];
};
const current = () => typeof Office !== 'undefined' ? Office.context?.mailbox?.item : undefined;
export const inOutlook = () => Boolean(current());
export async function readMail(): Promise<Mail | null> {
  const item = current() as Office.MessageRead | undefined;
  if (!item || typeof item.subject !== 'string') return null;
  const preview = await new Promise<string>(resolve => {
    try { item.body.getAsync(Office.CoercionType.Text, result => resolve(result.status === Office.AsyncResultStatus.Succeeded ? String(result.value).slice(0, 2000) : '')); }
    catch { resolve(''); }
  });
  return {
    id: item.itemId || '', subject: item.subject || '', sender: item.from?.emailAddress || '',
    preview, attachments: (item.attachments || []).map(x => ({ id: x.id, name:x.name, size:x.size, attachmentType:String(x.attachmentType) }))
  };
}
export function emailReference(m: Mail | null): string | null {
  return m?.subject.match(/CSR-\d{4}-\d{6}/i)?.[0].toUpperCase() || m?.preview.match(/CSR-\d{4}-\d{6}/i)?.[0].toUpperCase() || null;
}
export async function readAttachment(id: string, name: string): Promise<File> {
  const item = current() as Office.MessageRead | undefined;
  if (!item?.getAttachmentContentAsync) throw new Error('Outlook attachment access is not available on this client.');
  const value = await new Promise<Office.AttachmentContent>((resolve, reject) => {
    item.getAttachmentContentAsync(id, result => result.status === Office.AsyncResultStatus.Succeeded ? resolve(result.value) : reject(new Error(result.error?.message || 'Could not read attachment')));
  });
  if (value.format !== Office.MailboxEnums.AttachmentContentFormat.Base64) throw new Error('Only regular file attachments can be imported.');
  const bytes = Uint8Array.from(atob(value.content), c => c.charCodeAt(0));
  return new File([bytes], name, { type: mimeFor(name) });
}
export function mimeFor(name: string) {
  const ext = name.toLowerCase().split('.').pop();
  return ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',
   docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} as Record<string,string>)[ext || ''] || '';
}
export function replyDraft(body: string) {
  const item = current() as Office.MessageRead | undefined;
  if (!item?.displayReplyFormAsync) throw new Error('Open an email in Outlook first.');
  item.displayReplyFormAsync(body.slice(0,32000));
}
export function calendarDraft(subject: string, start: string, end: string, location: string, description: string) {
  if (typeof Office === 'undefined' || !Office.context?.mailbox) throw new Error('Open in Outlook to create a calendar draft.');
  Office.context.mailbox.displayNewAppointmentForm({
    subject, start: new Date(start), end: new Date(end), location, body: description.slice(0,32000)
  });
}
export async function oauthDialog(target: string, onTokens: (access: string, refresh: string) => Promise<void>): Promise<void> {
  // Office.js also loads in a regular browser. Wait for the host to initialize before
  // deciding whether this is an Outlook task pane or the standalone CSWI portal.
  if (typeof Office === 'undefined' || typeof Office.onReady !== 'function') {
    window.location.assign(target);
    return;
  }
  const info = await Office.onReady();
  const inOutlookHost = info?.host === Office.HostType.Outlook || Boolean(Office.context?.mailbox);
  if (!inOutlookHost) {
    // Preserve the normal browser-portal OAuth redirect.
    window.location.assign(target);
    return;
  }
  // Never navigate an Outlook task pane to an identity provider. A browser
  // redirect signs in a DIFFERENT webview and strands the task pane signed out.
  const ui = Office.context?.ui;
  if (typeof ui?.displayDialogAsync !== 'function') {
    throw new Error('Outlook could not initialize its sign-in dialog. Reopen this add-in in an email and try again.');
  }
  const startUrl = window.location.origin + '/auth/start?target=' + encodeURIComponent(target);
  await new Promise<void>((resolve, reject) => {
    try {
      ui.displayDialogAsync(startUrl, { height: 65, width: 45, displayInIframe: false }, result => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error(result.error?.message || 'Outlook could not open the sign-in dialog'));
          return;
        }
        const dialog = result.value;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          dialog.close();
          reject(error);
        };
        dialog.addEventHandler(Office.EventType.DialogMessageReceived, async message => {
          if (settled) return;
          try {
            if (!('message' in message)) throw new Error('Outlook did not return a sign-in message');
            // Dialog communication is restricted to our HTTPS app origin.
            if (message.origin && message.origin !== window.location.origin) throw new Error('Unexpected sign-in origin');
            const parsed: unknown = JSON.parse(message.message);
            if (!parsed || typeof parsed !== 'object') throw new Error('Invalid sign-in response');
            const payload = parsed as Record<string, unknown>;
            if (payload.type !== 'cswi-login' || typeof payload.access_token !== 'string' ||
                typeof payload.refresh_token !== 'string' || !payload.access_token || !payload.refresh_token) {
              throw new Error('Invalid sign-in response');
            }
            settled = true;
            try {
              await onTokens(payload.access_token, payload.refresh_token);
              dialog.close();
              resolve();
            } catch (error) {
              dialog.close();
              reject(error);
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
        dialog.addEventHandler(Office.EventType.DialogEventReceived, event => {
          fail(new Error('Outlook sign-in dialog closed or lost its connection (' + String(event.error) + '). Please try again.'));
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

/** Outlook's selected item is either a read item or an active compose draft. */
export type OutlookSurface = 'read' | 'compose' | 'none';
export function outlookSurface(): OutlookSurface {
  const item = current();
  if (!item) return 'none';
  if (typeof (item as Office.MessageRead).subject === 'string') return 'read';
  const draft = item as Office.MessageCompose;
  return typeof draft.subject?.getAsync === 'function' ? 'compose' : 'none';
}
function requireCompose(): Office.MessageCompose {
  if (outlookSurface() !== 'compose') throw new Error('Open an Outlook message draft to use compose actions.');
  return current() as Office.MessageCompose;
}
export function composeSubject(): Promise<string> {
  const item = requireCompose();
  return new Promise((resolve, reject) =>
    item.subject.getAsync(result => result.status === Office.AsyncResultStatus.Succeeded
      ? resolve(result.value || '')
      : reject(new Error(result.error?.message || 'Could not read Outlook draft subject')))
  );
}
export function setComposeSubject(subject: string): Promise<void> {
  if (subject.length > 255) throw new Error('Outlook subjects must be 255 characters or less.');
  const item = requireCompose();
  return new Promise((resolve, reject) =>
    item.subject.setAsync(subject, result => result.status === Office.AsyncResultStatus.Succeeded
      ? resolve()
      : reject(new Error(result.error?.message || 'Could not update Outlook draft subject')))
  );
}
export function insertComposeBody(text: string): Promise<void> {
  const item = requireCompose();
  return new Promise((resolve, reject) => {
    item.body.getTypeAsync(format => {
      if (format.status !== Office.AsyncResultStatus.Succeeded) {
        reject(new Error(format.error?.message || 'Could not read draft body format'));
        return;
      }
      const isHtml = format.value === Office.CoercionType.Html;
      const content = isHtml
        ? '<p>' + text.split('\n').map(line => line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).join('<br>') + '</p>'
        : text;
      item.body.setSelectedDataAsync(content, { coercionType: format.value }, result =>
        result.status === Office.AsyncResultStatus.Succeeded
          ? resolve()
          : reject(new Error(result.error?.message || 'Could not insert request summary')));
    });
  });
}
