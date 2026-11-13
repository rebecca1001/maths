// Student usernames: per school, no domain (TT Rock Stars style). Same rules as the database
// (supabase/migrations/20261116000000_school_usernames.sql), so the review screen and the demo match the real thing.

// What a child types -> the stored form: " Franklin.Joshua@SD54.bc.ca " -> "franklin.joshua"; null if nothing usable
export function normUsername(s) {
  const x = String(s || '').replace(/\s/g, '').toLowerCase().split('@')[0].replace(/[^a-z0-9._'-]/g, '').slice(0, 40);
  return x || null;
}

// One name part for a username: "Zoë-Anne" -> "zoe-anne", "O'Brien" -> "obrien"
export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 's').replace(/[^a-z0-9-]/g, '');
}

// Username from a name: surname.firstname
export function usernameFromName(first, last) {
  return (slug(last).slice(0, 24) + '.' + slug(first).slice(0, 14)).replace(/^\.+|\.+$/g, '');
}

// "franklin.joshua" -> "Joshua Franklin" (BC school emails are surname.firstname); null for student numbers
export function nameFromUsername(u) {
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return /^[a-z'-]+\.[a-z'-]+$/.test(u || '') ? cap(u.split('.')[1]) + ' ' + cap(u.split('.')[0]) : null;
}


const EMAIL = /[^\s,;<>"]+@[^\s,;<>"]+/;

// A pasted class list -> rows for add_school_students. Accepts, one student per line:
//   franklin.joshua@sd54.bc.ca            (school email)
//   Franklin, Joshua                      (surname, first name)
//   Joshua Franklin                       (first name surname; middle names kept in the real name)
//   Joshua <tab> Franklin [<tab> email]   (straight from a spreadsheet: first name, surname)
// A header row ("First name, Surname, ...") is skipped and tells us the column order.
export function parseRoster(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200);
  let surnameFirst = false;
  const rows = [];
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    if (i === 0 && /first/.test(low) && /(last|surname|family)/.test(low)) {
      surnameFirst = low.search(/last|surname|family/) < low.search(/first/);
      return;
    }
    const m = line.match(EMAIL), email = m ? m[0].replace(/[.,;]+$/, '') : '';
    const rest = (m ? line.replace(m[0], ' ') : line);
    let first = '', last = '';
    const cells = rest.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      [first, last] = surnameFirst ? [cells[1], cells[0]] : [cells[0], cells[1]];
    } else {
      const one = (cells[0] || '').replace(/[,;]+$/, '').trim();
      if (one.includes(',')) { last = one.split(',')[0].trim(); first = one.split(',').slice(1).join(' ').trim(); }
      else if (one) { const w = one.split(/\s+/); last = w.length > 1 ? w.pop() : ''; first = w.join(' '); }
    }
    rows.push({ email, first: first.slice(0, 40), last: last.slice(0, 40), line });
  });
  return rows;
}

// Swap first name and surname on name rows (for a spreadsheet pasted the other way round)
export const swapNames = (rows) => rows.map((r) => ({ ...r, first: r.last, last: r.first }));
