import { sql, type SQL } from "drizzle-orm";

/** Partial unique index predicate for per-user Google data grants.
 *  Credential and Google sign-in rows stay outside it. Search Console and
 *  Analytics stay in the same predicate so their existing grants remain unique. */
export function googleDataGrantWhere(providerId: SQL) {
  return sql`${providerId} in ('google-search-console', 'google-analytics', 'youtube')`;
}
