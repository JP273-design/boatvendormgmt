import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { STAFF, type Persona } from "./personas";

export const COOKIE = "vms_persona";

/** Demo auth: the cookie just names a persona. Real auth (Supabase Auth / SSO) replaces this in the pilot. */
export const getPersona = cache(async (): Promise<Persona | null> => {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const staff = STAFF.find((p) => p.id === id);
  if (staff) return staff;
  if (id.startsWith("vendor:")) {
    const vendorId = id.slice("vendor:".length);
    const [v] = await db.select().from(schema.vendors).where(eq(schema.vendors.id, vendorId));
    if (v) return { id, role: "vendor", name: v.contactName, title: v.name, vendorId: v.id };
  }
  return null;
});

export async function requirePersona(): Promise<Persona> {
  const p = await getPersona();
  if (!p) redirect("/");
  return p;
}
