export type Role =
  | "ceo"
  | "csco"
  | "procurement"
  | "vendor"
  | "qc"
  | "logistics"
  | "warehouse"
  | "finance";

export type Persona = {
  id: string;
  role: Role;
  name: string;
  title: string;
  vendorId?: string;
};

export const STAFF: Persona[] = [
  { id: "ceo", role: "ceo", name: "Sameer Kapoor", title: "Chief Executive Officer" },
  { id: "csco", role: "csco", name: "Meera Krishnan", title: "Chief Supply Chain Officer" },
  { id: "procurement", role: "procurement", name: "Ananya Iyer", title: "Procurement Manager" },
  { id: "qc", role: "qc", name: "Rohan Mehta", title: "QC Inspector, Shenzhen" },
  { id: "logistics", role: "logistics", name: "Vikram Desai", title: "Logistics Lead" },
  { id: "warehouse", role: "warehouse", name: "Suresh Patil", title: "Warehouse Supervisor, Bhiwandi" },
  { id: "finance", role: "finance", name: "Kavita Shah", title: "Finance Controller" },
];

export const ROLE_LABEL: Record<Role, string> = {
  ceo: "CEO",
  csco: "CSCO",
  procurement: "Procurement",
  vendor: "Vendor",
  qc: "QC",
  logistics: "Logistics",
  warehouse: "Warehouse",
  finance: "Finance",
};

export type NavItem = { href: string; label: string; icon: string };

const N = {
  dashboard: { href: "/dashboard", label: "Dashboard", icon: "gauge" },
  pos: { href: "/pos", label: "Purchase orders", icon: "file" },
  alerts: { href: "/alerts", label: "Alerts", icon: "bell" },
  qc: { href: "/qc", label: "QC inspections", icon: "check" },
  templates: { href: "/qc/templates", label: "QC checklists", icon: "list" },
  vendors: { href: "/vendors", label: "Vendors", icon: "factory" },
  shipments: { href: "/shipments", label: "Shipments", icon: "ship" },
  warehouse: { href: "/warehouse", label: "Receiving", icon: "warehouse" },
  payments: { href: "/payments", label: "Payments", icon: "wallet" },
} satisfies Record<string, NavItem>;

export const NAV: Record<Role, NavItem[]> = {
  ceo: [N.dashboard, N.alerts, N.pos, N.vendors, N.shipments, N.payments],
  csco: [N.dashboard, N.alerts, N.pos, N.vendors, N.qc, N.shipments, N.payments],
  procurement: [{ ...N.pos, label: "Control tower" }, N.alerts, N.qc, N.templates, N.vendors, N.shipments, N.dashboard],
  vendor: [{ ...N.pos, label: "My orders" }, { ...N.payments, label: "My payments" }],
  qc: [{ ...N.qc, label: "My inspections" }, N.templates],
  logistics: [N.shipments, N.alerts, N.pos],
  warehouse: [N.warehouse, N.shipments],
  finance: [N.payments, N.alerts, N.pos, N.vendors],
};

export const HOME: Record<Role, string> = {
  ceo: "/dashboard",
  csco: "/dashboard",
  procurement: "/pos",
  vendor: "/pos",
  qc: "/qc",
  logistics: "/shipments",
  warehouse: "/warehouse",
  finance: "/payments",
};

export const isExec = (r: Role) => r === "ceo" || r === "csco";
/** Roles that see every vendor's data. */
export const isInternal = (r: Role) => r !== "vendor";
