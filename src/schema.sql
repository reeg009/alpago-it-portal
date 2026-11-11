-- Alpago IT Portal schema (idempotent)

CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  employee_code TEXT UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role_id INT NOT NULL REFERENCES roles(id),
  entity_id INT REFERENCES entities(id) ON DELETE SET NULL,
  department TEXT,
  job_title TEXT,
  phone TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  can_login BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'In Stock',
  condition TEXT DEFAULT 'Good',
  entity_id INT REFERENCES entities(id) ON DELETE SET NULL,
  assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  location TEXT,
  purchase_date DATE,
  purchase_cost NUMERIC(12,2),
  supplier TEXT,
  warranty_expiry DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assets_entity ON assets(entity_id);

CREATE TABLE IF NOT EXISTS asset_history (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_user INT REFERENCES users(id) ON DELETE SET NULL,
  to_user INT REFERENCES users(id) ON DELETE SET NULL,
  from_entity INT REFERENCES entities(id) ON DELETE SET NULL,
  to_entity INT REFERENCES entities(id) ON DELETE SET NULL,
  performed_by INT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS ticket_no_seq START 1;

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  ticket_no TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'Incident',
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Open',
  requester_id INT REFERENCES users(id) ON DELETE SET NULL,
  assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
  entity_id INT REFERENCES entities(id) ON DELETE SET NULL,
  asset_id INT REFERENCES assets(id) ON DELETE SET NULL,
  approved_by INT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT,
  license_type TEXT DEFAULT 'Subscription',
  license_key TEXT,
  seats_total INT NOT NULL DEFAULT 1,
  cost NUMERIC(12,2),
  billing_cycle TEXT DEFAULT 'Annual',
  purchase_date DATE,
  renewal_date DATE,
  entity_id INT REFERENCES entities(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS license_assignments (
  license_id INT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (license_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Employee master (HR) fields ----------
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reporting_manager_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reporting_manager_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS visa_sponsor TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS grade TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_days INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_end_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS resign_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS resign_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS relieve_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_personal TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_extension TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_manager BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_off1 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_off2 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_start TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_end TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ess_created BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ess_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hr_synced_at TIMESTAMPTZ;
