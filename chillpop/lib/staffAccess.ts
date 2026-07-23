// Single source of truth for which /admin/* page prefixes the "staff"
// role may reach — used by proxy.ts (the actual enforcement) and by
// AdminNav (which links to show). Keeping these in one place means
// the nav can never show a link staff would immediately get bounced
// from, and vice versa.
export const STAFF_ALLOWED_PREFIXES = [
  "/admin/pos",
  "/admin/production",
  "/admin/calendar",
  "/admin/inventory",
];

export function isStaffAllowedPage(pathname: string): boolean {
  return STAFF_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
