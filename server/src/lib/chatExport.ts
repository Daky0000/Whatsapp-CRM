/**
 * Parses WhatsApp's "Export chat" text file, the fallback for sellers whose
 * number isn't on the Cloud API yet.
 *
 * Two layouts exist, and the date order follows the phone's locale:
 *   Android: 24/10/2026, 14:05 - Kofi Mensah: Is the red one available?
 *   iOS:     [24/10/2026, 14:05:33] Kofi Mensah: Is the red one available?
 * Times may be 24-hour or "2:05 pm". A line that doesn't start with a date
 * continues the previous message. Lines with no "Name:" are system notices
 * ("Messages and calls are end-to-end encrypted…") and are dropped.
 */
export interface ExportMessage {
  timestamp: Date;
  author: string;
  body: string;
  isMedia: boolean;
}

export interface ParsedExport {
  participants: string[];
  messages: ExportMessage[];
}

const LINE =
  /^‎?\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:-\s*)?(.*)$/i;

const MEDIA = /^‎?(<media omitted>|<attached: .*>|(image|video|audio|sticker|document|gif) omitted|.*\(file attached\))$/i;

interface Raw {
  a: number;
  b: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  rest: string;
}

export function parseChatExport(text: string): ParsedExport {
  const raws: Raw[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = LINE.exec(line);
    if (m) {
      let hour = Number(m[4]);
      const meridiem = m[7]?.toLowerCase().replace(/[.\s]/g, "");
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      const year = Number(m[3]);
      raws.push({
        a: Number(m[1]),
        b: Number(m[2]),
        year: year < 100 ? 2000 + year : year,
        hour,
        minute: Number(m[5]),
        second: Number(m[6] ?? 0),
        rest: m[8] ?? "",
      });
    } else if (raws.length && line.length) {
      raws[raws.length - 1]!.rest += `\n${line}`;
    }
  }

  // Day-first unless the file proves otherwise (Ghana phones are day-first).
  const monthFirst = !raws.some((r) => r.a > 12) && raws.some((r) => r.b > 12);

  const messages: ExportMessage[] = [];
  for (const r of raws) {
    const sep = r.rest.indexOf(": ");
    if (sep <= 0) continue; // system notice
    const author = r.rest.slice(0, sep).replace(/^‎/, "").trim();
    const body = r.rest.slice(sep + 2).replace(/‎/g, "").trim();
    const [day, month] = monthFirst ? [r.b, r.a] : [r.a, r.b];
    const timestamp = new Date(Date.UTC(r.year, month - 1, day, r.hour, r.minute, r.second));
    if (Number.isNaN(timestamp.getTime()) || month > 12 || day > 31) continue;
    messages.push({ timestamp, author, body, isMedia: MEDIA.test(body) });
  }

  return { participants: [...new Set(messages.map((m) => m.author))], messages };
}
