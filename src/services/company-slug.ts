export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "company";
}

// Top-level static routes in the frontend (frontend/app/<segment>) that a company slug must
// never collide with, since Next.js always matches a static folder before the [companySlug]
// dynamic segment at the same level.
const RESERVED_SLUGS = new Set(["autofinance", "dashboard", "portal", "api", "app"]);

/** Generates a slug from `name` and appends -2, -3, ... until unique (and not a reserved word). */
export async function ensureUniqueCompanySlug(
  tx: { company: { findUnique: (args: any) => Promise<{ id: string } | null> } },
  name: string
): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  while (RESERVED_SLUGS.has(candidate) || (await tx.company.findUnique({ where: { slug: candidate } }))) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}
