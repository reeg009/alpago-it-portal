// Optional demo data (SEED_DEMO=true). Runs once, only when the assets table is empty.
const bcrypt = require('bcryptjs');

let s = 42;
const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const daysAhead = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const FIRST = ['Omar', 'Sara', 'Rahul', 'Fatima', 'James', 'Aisha', 'Kiran', 'Layla', 'Daniel', 'Noura', 'Arjun', 'Maria', 'Yusuf', 'Hana', 'Vikram', 'Leila', 'Tom', 'Zainab', 'Ravi', 'Mona', 'Hassan', 'Priya', 'Karim', 'Elena'];
const LAST = ['Haddad', 'Menon', 'Khan', 'Ortiz', 'Nair', 'Farouk', 'Pillai', 'Saleh', 'Reyes', 'Iyer', 'Mansour', 'Thomas'];
const DEPTS = ['Finance', 'HR', 'Projects', 'Procurement', 'Engineering', 'Sales', 'Operations', 'Admin'];

const CATALOG = {
  Laptop: [['Dell', 'Latitude 5440'], ['Dell', 'Precision 3591'], ['Lenovo', 'ThinkPad T14'], ['HP', 'EliteBook 840 G10'], ['Apple', 'MacBook Pro 14']],
  Desktop: [['Dell', 'OptiPlex 7010'], ['HP', 'ProDesk 400 G9'], ['Lenovo', 'ThinkCentre M70q']],
  Monitor: [['Dell', 'U2722D'], ['Dell', 'P2423'], ['LG', '27UP850'], ['Samsung', 'S24C450']],
  Mobile: [['Apple', 'iPhone 15'], ['Samsung', 'Galaxy S24'], ['Apple', 'iPhone 14']],
  Printer: [['HP', 'LaserJet Pro M404'], ['Canon', 'imageRUNNER 2630'], ['Epson', 'EcoTank L6270']],
  Network: [['Fortinet', 'FortiGate 100F'], ['Aruba', '2930F Switch'], ['Ubiquiti', 'UniFi U6 Pro']],
};

module.exports = async function demoSeed(tx) {
  await tx(async (c) => {
    const ents = (await c.query('SELECT id FROM entities ORDER BY id')).rows.map((r) => r.id);
    const roles = Object.fromEntries((await c.query('SELECT id, name FROM roles')).rows.map((r) => [r.name, r.id]));
    const hash = await bcrypt.hash('Demo@2026', 10);

    const users = [];
    const techs = [];
    const add = async (name, email, role, dept, title, created) => {
      const { rows } = await c.query(
        `INSERT INTO users (employee_code, full_name, email, password_hash, role_id, entity_id, department, job_title, phone, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (email) DO NOTHING RETURNING id`,
        [`EMP-${String(users.length + 100).padStart(4, '0')}`, name, email, hash, roles[role], pick(ents), dept, title,
         `+971 5${Math.floor(rnd() * 10)} ${Math.floor(1000000 + rnd() * 8999999)}`, created]
      );
      if (rows[0]) users.push(rows[0].id);
      return rows[0]?.id;
    };
    techs.push(await add('Tech One', 'tech1@alpago.local', 'IT Technician', 'IT & Innovation', 'IT Support Engineer', daysAgo(400)));
    techs.push(await add('Tech Two', 'tech2@alpago.local', 'IT Technician', 'IT & Innovation', 'Systems Administrator', daysAgo(300)));
    await add('Demo Manager', 'manager@alpago.local', 'Manager', 'Projects', 'Projects Manager', daysAgo(500));
    await add('Demo Employee', 'employee@alpago.local', 'Employee', 'Finance', 'Accountant', daysAgo(200));
    for (let i = 0; i < 40; i++) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      await add(n, `${n.toLowerCase().replace(' ', '.')}${i}@alpago.local`, 'Employee', pick(DEPTS), 'Staff', daysAgo(Math.floor(rnd() * 600)));
    }
    const demoEmp = (await c.query("SELECT id FROM users WHERE email='employee@alpago.local'")).rows[0].id;

    // assets
    const counts = { Laptop: 46, Desktop: 22, Monitor: 30, Mobile: 14, Printer: 8, Network: 7 };
    const prefix = { Laptop: 'LT', Desktop: 'DT', Monitor: 'MN', Mobile: 'MB', Printer: 'PR', Network: 'NW' };
    const assetIds = [];
    let n = 1;
    for (const [cat, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i++) {
        const [brand, model] = pick(CATALOG[cat]);
        const r = rnd();
        const status = cat === 'Network' || cat === 'Printer' ? 'In Use' : r < 0.7 ? 'Assigned' : r < 0.88 ? 'In Stock' : r < 0.95 ? 'In Repair' : 'Retired';
        const owner = status === 'Assigned' ? pick(users) : null;
        const purchased = daysAgo(Math.floor(rnd() * 1000) + 30);
        const warranty = new Date(purchased.getTime() + 3 * 365 * 86400000);
        const { rows } = await c.query(
          `INSERT INTO assets (asset_tag, name, category, brand, model, serial_number, status, entity_id, assigned_to, assigned_at,
                               location, purchase_date, purchase_cost, supplier, warranty_expiry, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [`ALP-${prefix[cat]}-${String(n++).padStart(5, '0')}`, `${brand} ${model}`, cat, brand, model,
           Math.random().toString(36).slice(2, 12).toUpperCase(), status, pick(ents), owner, owner ? purchased : null,
           pick(['Head Office - Dubai', 'Site Office - Abu Dhabi', 'Warehouse - Jebel Ali', 'Factory - Sharjah']),
           purchased.toISOString().slice(0, 10), Math.round(500 + rnd() * 9000), pick(['Emitac', 'Dell UAE', 'Sharaf DG', 'Virgin Mega']),
           warranty.toISOString().slice(0, 10), purchased]
        );
        assetIds.push(rows[0].id);
        await c.query("INSERT INTO asset_history (asset_id, action, to_user, note, created_at) VALUES ($1,'Created',$2,'Imported',$3)", [rows[0].id, owner, purchased]);
      }
    }
    // guarantee the demo employee has equipment
    await c.query(
      `UPDATE assets SET assigned_to=$1, status='Assigned', assigned_at=now()
        WHERE id IN (SELECT id FROM assets WHERE category IN ('Laptop','Monitor','Mobile') AND status <> 'Retired' ORDER BY category, id LIMIT 3)`,
      [demoEmp]
    );

    // licenses
    const L = [
      ['Microsoft 365 Business Premium', 'Microsoft', 120, 95000, 25],
      ['Adobe Creative Cloud', 'Adobe', 10, 28000, 18],
      ['AutoCAD', 'Autodesk', 15, 72000, 140],
      ['Revit', 'Autodesk', 8, 64000, 140],
      ['Primavera P6', 'Oracle', 6, 41000, 210],
      ['Zoom Workplace', 'Zoom', 20, 9000, 9],
      ['FortiGate UTP Bundle', 'Fortinet', 2, 18000, 60],
      ['Veeam Backup & Replication', 'Veeam', 4, 12000, 27],
      ['Bluebeam Revu', 'Bluebeam', 12, 15000, 300],
    ];
    for (const [name, vendor, seats, cost, days] of L) {
      const { rows } = await c.query(
        `INSERT INTO licenses (name, vendor, seats_total, cost, renewal_date, entity_id, purchase_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [name, vendor, seats, cost, daysAhead(days), ents[0], daysAhead(days - 365)]
      );
      const used = Math.min(seats, Math.floor(seats * (0.5 + rnd() * 0.45)));
      const shuffled = [...users].sort(() => rnd() - 0.5).slice(0, used);
      for (const u of shuffled) await c.query('INSERT INTO license_assignments (license_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, u]);
    }

    // tickets
    const T = [
      ['Laptop running slow', 'Incident', 'Hardware'], ['Outlook not syncing', 'Incident', 'Email'],
      ['Printer not working - Level 5', 'Incident', 'Printer'], ['VPN access for site team', 'Incident', 'Network'],
      ['Request for Adobe license', 'Software Request', 'Software'], ['New employee setup', 'Onboarding', 'Accounts'],
      ['Wi-Fi drops in meeting room', 'Incident', 'Network'], ['Need second monitor', 'Asset Request', 'Hardware'],
      ['Password reset - ERP', 'Incident', 'Accounts'], ['Shared drive access', 'Incident', 'Access'],
      ['Transfer laptop to new hire', 'Asset Transfer', 'Hardware'], ['Teams camera not detected', 'Incident', 'Hardware'],
    ];
    const statuses = ['Open', 'Assigned', 'In Progress', 'Pending', 'Resolved', 'Closed'];
    for (let i = 0; i < 60; i++) {
      const [subject, type, category] = pick(T);
      const created = new Date(Date.now() - Math.floor(rnd() * 60 * 24 * 60) * 60000);
      let status = pick(statuses);
      if (type !== 'Incident' && rnd() < 0.3) status = 'Pending Approval';
      const priority = pick(['High', 'Medium', 'Medium', 'Low', 'Low', 'Critical'].slice(0, rnd() < 0.1 ? 6 : 5));
      const assignee = ['Open', 'Pending Approval'].includes(status) ? null : pick(techs);
      const no = (await c.query("SELECT nextval('ticket_no_seq') AS n")).rows[0].n;
      const { rows } = await c.query(
        `INSERT INTO tickets (ticket_no, subject, description, type, category, priority, status, requester_id, assignee_id, entity_id,
                              resolved_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [`IT-${created.getFullYear()}-${String(no).padStart(4, '0')}`, subject, `${subject}. Please assist.`, type, category, priority, status,
         i % 7 === 0 ? demoEmp : pick(users), assignee, pick(ents), ['Resolved', 'Closed'].includes(status) ? new Date(created.getTime() + (1 + rnd() * (priority === 'Low' ? 72 : priority === 'Medium' ? 30 : 8)) * 3600000) : null, created]
      );
      await c.query('INSERT INTO ticket_comments (ticket_id, user_id, body, is_system, created_at) VALUES ($1,NULL,$2,TRUE,$3)', [rows[0].id, 'Ticket created', created]);
      if (assignee) await c.query('INSERT INTO ticket_comments (ticket_id, user_id, body, created_at) VALUES ($1,$2,$3,$4)', [rows[0].id, assignee, 'Looking into this now.', new Date(created.getTime() + 600000)]);
    }
  });
  console.log('Demo data seeded');
};
