import { useState } from "react";
import { api, displayPhone } from "../api";
import { Empty, Modal, PageHeader, useAction, useLoad } from "../ui";

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  labels: string[];
  notes: string | null;
  optedIn: boolean;
  optedOut: boolean;
  listIds: string[];
}
interface List {
  id: string;
  name: string;
  members: number;
}

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const contacts = useLoad(() => api<Contact[]>(`/contacts?q=${encodeURIComponent(q)}`), [q]);
  const lists = useLoad(() => api<List[]>("/lists"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | "add" | "csv" | Contact>(null);
  const { busy, run } = useAction();

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const all = contacts.data ?? [];

  const addToList = async (listId: string) => {
    if (!listId) return;
    await run(() => api(`/lists/${listId}/members`, { body: { contactIds: [...selected] } }), `Added ${selected.size} to the list`);
    setSelected(new Set());
    void contacts.reload();
    void lists.reload();
  };

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Everyone who has chatted with you is saved here automatically."
        actions={
          <>
            <a className="btn-ghost" href="/api/contacts/export.csv">Export CSV</a>
            <button className="btn-ghost" onClick={() => setModal("csv")}>Import CSV</button>
            <button className="btn-primary" onClick={() => setModal("add")}>Add contact</button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {selected.size > 0 && (
          <select className="input w-auto" defaultValue="" onChange={(e) => addToList(e.target.value)} disabled={busy}>
            <option value="">Add {selected.size} selected to list…</option>
            {lists.data?.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
      </div>
      {all.length === 0 && !contacts.loading ? (
        <Empty title="No contacts yet">Connect WhatsApp or import a CSV. Customers who message you are added automatically.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 p-3">
                  <input type="checkbox" checked={all.length > 0 && selected.size === all.length} onChange={(e) => setSelected(e.target.checked ? new Set(all.map((c) => c.id)) : new Set())} />
                </th>
                <th className="p-3">Name</th>
                <th className="p-3">Number</th>
                <th className="p-3">Labels</th>
                <th className="p-3">Broadcasts</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {all.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="p-3 font-medium">{c.name ?? <span className="text-slate-400">No name</span>}</td>
                  <td className="p-3 whitespace-nowrap tabular-nums">{displayPhone(c.phone)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {c.labels.map((l) => (
                        <span key={l} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{l}</span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-xs">
                    {c.optedOut ? <span className="text-red-600">Opted out</span> : c.optedIn ? <span className="text-brand-700">Opted in</span> : <span className="text-slate-400">Not asked</span>}
                  </td>
                  <td className="p-3 text-right">
                    <button className="text-xs text-brand-700 hover:underline" onClick={() => setModal(c)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal === "add" && <ContactForm onClose={() => setModal(null)} onSaved={contacts.reload} />}
      {modal && typeof modal === "object" && <ContactForm contact={modal} onClose={() => setModal(null)} onSaved={contacts.reload} />}
      {modal === "csv" && <CsvImport onClose={() => setModal(null)} onDone={contacts.reload} />}
    </>
  );
}

function ContactForm({ contact, onClose, onSaved }: { contact?: Contact; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    phone: contact ? `+${contact.phone}` : "",
    labels: contact?.labels.join(", ") ?? "",
    notes: contact?.notes ?? "",
    optedIn: contact?.optedIn ?? false,
    optedOut: contact?.optedOut ?? false,
  });
  const { busy, run } = useAction();
  const save = async () => {
    const body = {
      name: form.name || null,
      phone: form.phone,
      labels: form.labels.split(",").map((s) => s.trim()).filter(Boolean),
      notes: form.notes || null,
      optedIn: form.optedIn,
      optedOut: form.optedOut,
    };
    const ok = await run(() => (contact ? api(`/contacts/${contact.id}`, { method: "PATCH", body }) : api("/contacts", { body })), "Saved");
    if (ok) (onSaved(), onClose());
  };
  const remove = async () => {
    if (!contact || !confirm("Delete this contact and their chat history?")) return;
    const ok = await run(() => api(`/contacts/${contact.id}`, { method: "DELETE" }), "Deleted");
    if (ok) (onSaved(), onClose());
  };
  return (
    <Modal title={contact ? "Edit contact" : "Add contact"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">WhatsApp number</label>
          <input className="input" value={form.phone} disabled={!!contact} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="024 123 4567" />
        </div>
        <div>
          <label className="label">Labels (comma separated)</label>
          <input className="input" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} placeholder="VIP, wholesale" />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.optedIn} onChange={(e) => setForm({ ...form, optedIn: e.target.checked, optedOut: e.target.checked ? false : form.optedOut })} />
          Agreed to receive broadcasts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.optedOut} onChange={(e) => setForm({ ...form, optedOut: e.target.checked, optedIn: e.target.checked ? false : form.optedIn })} />
          Opted out (never send broadcasts)
        </label>
        <div className="flex justify-between pt-2">
          {contact ? <button className="btn-danger" onClick={remove} disabled={busy}>Delete</button> : <span />}
          <button className="btn-primary" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function CsvImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [label, setLabel] = useState("");
  const { busy, run } = useAction();
  const submit = async () => {
    const r = await run(() => api<{ added: number; alreadyHad: number; invalid: number }>("/contacts/import", { body: { csv, label: label || undefined } }));
    if (!r) return;
    alert(`Added ${r.added}. ${r.alreadyHad} were already saved. ${r.invalid} rows had no valid number.`);
    onDone();
    onClose();
  };
  return (
    <Modal title="Import contacts from CSV" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">A spreadsheet saved as CSV with a <b>name</b> column and a <b>phone</b> column. Local numbers like 024 123 4567 are fine.</p>
      <input type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? "")} />
      <div className="mt-3">
        <label className="label">Label everyone in this file (optional)</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Instagram customers" />
      </div>
      <button className="btn-primary mt-4 w-full" disabled={!csv || busy} onClick={submit}>Import</button>
    </Modal>
  );
}
