/**
 * Conservative extraction from the currently selected Outlook email.
 * Never save suggestions without explicit user confirmation.
 */
export type EmailSuggestion = {
  field: 'participant_count' | 'location' | 'starts_at' | 'ends_at';
  label: string;
  value: string | number;
};
export function proposeEmailFields(text: string): EmailSuggestion[] {
  const suggestions: EmailSuggestion[] = [];
  const count = text.match(/(?:participants|attendees|headcount|people)\s*[:=-]\s*(\d{1,4})\b/i);
  if (count && Number(count[1])>0) suggestions.push({field:'participant_count',label:'Expected participants',value:Number(count[1])});
  const location = text.match(/(?:location|venue|address)\s*[:=-]\s*([^\r\n]{3,130})/i);
  if (location) suggestions.push({field:'location',label:'Location',value:location[1].trim()});
  for (const [field,label,words] of [
    ['starts_at','Start time','start|starts|from'],
    ['ends_at','End time','end|ends|until|to']
  ] as const) {
    const match = text.match(new RegExp('(?:'+words+')\\s*[:=-]\\s*(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2})','i'));
    if (!match) continue;
    const local = match[1]+'T'+match[2];
    if (!Number.isNaN(new Date(local).getTime())) suggestions.push({field,label,value:local});
  }
  return suggestions;
}
