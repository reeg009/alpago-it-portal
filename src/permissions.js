// Single source of truth for permission keys.
const PERMISSIONS = [
  ['dashboard.view', 'Dashboard', 'View dashboard'],
  ['assets.view', 'Assets', 'View all assets'],
  ['assets.manage', 'Assets', 'Add, edit and retire assets'],
  ['assets.assign', 'Assets', 'Assign and transfer assets'],
  ['tickets.view_all', 'Tickets', 'View all tickets'],
  ['tickets.manage', 'Tickets', 'Assign technicians and change ticket status'],
  ['tickets.internal_notes', 'Tickets', 'Read and write internal notes'],
  ['requests.approve', 'Tickets', 'Approve or reject IT requests'],
  ['employees.view', 'Employees', 'View employee directory'],
  ['employees.manage', 'Employees', 'Add and edit employees'],
  ['licenses.view', 'Licenses', 'View software licenses'],
  ['licenses.manage', 'Licenses', 'Add, edit and assign licenses'],
  ['isp.view', 'ISP & Telecom', 'View ISP lines and numbers'],
  ['isp.manage', 'ISP & Telecom', 'Add, edit and import ISP lines'],
  ['reports.view', 'Reports', 'View reports'],
  ['admin.users', 'Admin', 'Manage user accounts and roles assignment'],
  ['admin.entities', 'Admin', 'Manage company entities'],
  ['admin.roles', 'Admin', 'Manage roles and permissions'],
  ['admin.audit', 'Admin', 'View audit log'],
];

const ALL = PERMISSIONS.map((p) => p[0]);

const DEFAULT_ROLES = {
  Administrator: { description: 'Full access to the portal', perms: ALL },
  'IT Technician': {
    description: 'Handles tickets and manages assets',
    perms: [
      'dashboard.view', 'assets.view', 'assets.manage', 'assets.assign',
      'tickets.view_all', 'tickets.manage', 'tickets.internal_notes',
      'employees.view', 'licenses.view', 'licenses.manage', 'reports.view', 'isp.view', 'isp.manage',
    ],
  },
  Manager: {
    description: 'Approves IT requests for their team',
    perms: ['dashboard.view', 'requests.approve', 'employees.view', 'assets.view', 'licenses.view', 'reports.view', 'isp.view'],
  },
  Employee: {
    description: 'Self-service: own equipment and requests',
    perms: ['dashboard.view'],
  },
};

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES };
