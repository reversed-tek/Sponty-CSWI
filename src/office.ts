/* Contextual Outlook actions. Never send email or create a calendar event silently. */
export type Mail = {
  id: string; subject: string; sender: string; preview: string;
  attachments: { id: string; name: string; size: number; attachmentType?: string }[];
};
const current = () => typeof Office !== 'undefined' ? Office.context?.mailbox?.item : undefined;
export const inOutlook = () => Boolean(current());
export async function readMail(): Promise<Mail | null> {
  const item = current() as Office.MessageRead | undefined;
  if (!item || !('subject' in item)) return null;
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
export function oauthDialog(target: string, onTokens: (access: string, refresh: string) => Promise<void>): Promise<void> {
  return new Promise((resolve,reject) => {
    if (typeof Office === 'undefined' || !Office.context?.ui?.displayDialogAsync) {
      window.location.assign(target); resolve(); return;
    }
    const url = window.location.origin + '/auth/start?target=' + encodeURIComponent(target);
    Office.context.ui.displayDialogAsync(url,{height:65,width:45},result => {
      if(result.status !== Office.AsyncResultStatus.Succeeded) {reject(new Error(result.error?.message || 'Unable to open login dialog'));return;}
      const dialog=result.value; let done=false;
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, async message => {
        try {
          if (!('message' in message)) throw new Error('Outlook did not return a login message');
          if (message.origin && message.origin !== window.location.origin) throw new Error('Unexpected sign-in origin');
          const parsed=JSON.parse(message.message);
          if(parsed.type!=='cswi-login' || !parsed.access_token || !parsed.refresh_token) throw new Error('Invalid sign-in response');
          await onTokens(parsed.access_token,parsed.refresh_token);
          done=true; dialog.close(); resolve();
        } catch(e) {dialog.close(); reject(e);}
      });
      dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {if(!done) reject(new Error('Login dialog was closed before authentication finished'));});
    });
  });
}
